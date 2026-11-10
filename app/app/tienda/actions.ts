'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { checkDocument } from '@/lib/identity';
import { fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { saveImage } from '@/lib/media';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { fmtMoney } from '@/lib/format';
import { loadSale, salePdf, saleFilename } from '@/lib/sale-receipt';

const refresh = () => revalidatePath('/app/tienda', 'layout');

function productRow(fd: FormData) {
  const price = num(fd, 'price');
  if (price === null || price < 0) throw new ValidationError('Ingrese el precio de venta.');
  const kind = reqStr(fd, 'kind', 'Tipo');
  const barcode = (str(fd, 'barcode') ?? '').replace(/\s+/g, '');
  return {
    sku: reqStr(fd, 'sku', 'Código interno').toUpperCase().slice(0, 40), barcode: barcode || null, name: reqStr(fd, 'name', 'Nombre'),
    description: str(fd, 'description'), kind, category: str(fd, 'category'), brand: str(fd, 'brand'), unit: str(fd, 'unit') ?? 'unidad',
    price, cost: num(fd, 'cost') ?? 0, tax_rate: fd.get('exento') === 'on' ? 0 : 19, min_stock: num(fd, 'min_stock') ?? 0,
    track_stock: fd.get('track_stock') !== 'off', track_expiry: fd.get('track_expiry') === 'on',
    warranty_months: num(fd, 'warranty_months') || null, requires_serial: fd.get('requires_serial') === 'on',
    online: fd.get('online') === 'on', active: fd.get('active') !== 'off',
  };
}

async function maybeImage(fd: FormData, orgId: string, userId: string) {
  const f = fd.get('image');
  if (!(f instanceof File) || f.size === 0) return undefined;
  const r = await saveImage(f, { kind: 'product', organizationId: orgId, userId, isPublic: true });
  if ('error' in r) throw new ValidationError(r.error ?? 'Imagen inválida');
  return r.id;
}

/** ➕ Crea un producto (y opcionalmente su stock inicial). */
export async function createProduct(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId || !can(ctx, 'store.edit')) return fail('No tiene permiso para crear productos.');
    const row = productRow(fd);
    const image = await maybeImage(fd, ctx.orgId, ctx.user.id);
    const { data: org } = await ctx.supabase.from('organizations').select('base_currency').eq('id', ctx.orgId).single();
    const { data, error } = await ctx.supabase.from('products').insert({ ...row, organization_id: ctx.orgId, currency: org?.base_currency ?? 'CLP', image_asset_id: image ?? null }).select('id').single();
    if (error) return fail(error);
    const initial = num(fd, 'initial_stock');
    if (initial && initial > 0) {
      const { error: e2 } = await ctx.supabase.rpc('store_adjust', { p_product: data.id, p_qty: initial, p_kind: 'inicial', p_note: 'Stock inicial', p_lot: str(fd, 'lot'), p_expires: str(fd, 'expires') });
      if (e2) { refresh(); return fail(`El producto se creó, pero el stock inicial no: ${e2.message}`); }
    }
    refresh();
    return ok(`Producto «${row.name}» creado.`, { id: data.id });
  });
}

export async function updateProduct(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const id = reqStr(fd, 'id', 'id');
    const image = await maybeImage(fd, ctx.orgId, ctx.user.id);
    const { error, count } = await ctx.supabase.from('products').update({ ...productRow(fd), ...(image ? { image_asset_id: image } : {}) }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso para editar productos.');
    refresh();
    return ok('Producto actualizado.');
  });
}

/** Elimina el producto si nunca se vendió ni compró; si tiene historial, solo lo desactiva. */
export async function deleteProduct(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { count: used } = await ctx.supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('product_id', id);
    if (used) {
      const { error, count } = await ctx.supabase.from('products').update({ active: false, online: false }, { count: 'exact' }).eq('id', id);
      if (error) return fail(error);
      if (!count) return fail('No tiene permiso.');
      refresh(); return ok('El producto tiene movimientos: quedó desactivado (se conserva su historial).');
    }
    const { error, count } = await ctx.supabase.from('products').delete({ count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso para eliminar productos.');
    refresh();
    return ok('Producto eliminado (puede deshacerlo con «↶ Deshacer»).');
  });
}

/** Ajuste de inventario: conteo, merma, producto vencido o dañado, devolución. */
export async function adjustStock(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const qty = num(fd, 'qty');
    if (!qty) return fail('Ingrese una cantidad distinta de cero.');
    const { error } = await ctx.supabase.rpc('store_adjust', {
      p_product: reqStr(fd, 'id', 'id'), p_qty: qty, p_kind: reqStr(fd, 'kind', 'Tipo'), p_note: str(fd, 'note') ?? '', p_lot: str(fd, 'lot'), p_expires: str(fd, 'expires'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Inventario actualizado.');
  });
}

/** 📥 Compra a proveedor: suma stock (con lote y vencimiento) y registra el gasto de mercadería. */
export async function registerPurchase(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const products = fd.getAll('product').map(String), qtys = fd.getAll('qty').map(String), costs = fd.getAll('cost').map(String);
    const lots = fd.getAll('lot').map(String), exps = fd.getAll('expires').map(String);
    const items = products.map((p, i) => ({ product: p, qty: Number(qtys[i]), cost: Number(costs[i]), lot: lots[i] || null, expires: exps[i] || null }))
      .filter((x) => /^[0-9a-f-]{36}$/.test(x.product) && x.qty > 0);
    if (!items.length) return fail('Agregue al menos un producto con cantidad.');
    const { error } = await ctx.supabase.rpc('store_purchase', {
      p_org: ctx.orgId, p_supplier: str(fd, 'supplier'), p_document: str(fd, 'document_number'), p_date: str(fd, 'purchased_on'),
      p_items: items, p_expense: fd.get('expense') === 'on', p_notes: str(fd, 'notes'),
    });
    if (error) return fail(error);
    refresh(); revalidatePath('/app/finanzas', 'layout');
    return ok(`Compra registrada: ${items.length} producto(s) ingresados al inventario.`);
  });
}

export type CartLine = { product: string; qty: number; discount?: number; serial?: string };

/** 🧾 Cobra una venta en caja. */
export async function sell(input: { items: CartLine[]; method: string; discount: number; cash: number | null; customer: Record<string, string>; notes?: string }): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const c = input.customer ?? {};
    if (c.doc_number) {
      const d = checkDocument(c.doc_type || 'RUN', c.doc_number, false);
      if (!d.ok) return fail(d.error);
      c.doc_type = d.type ?? ''; c.doc_number = d.number ?? '';
    }
    const { data, error } = await ctx.supabase.rpc('store_sell', {
      p_org: ctx.orgId, p_items: (input.items ?? []).slice(0, 200), p_payment_method: input.method, p_customer: c,
      p_discount: Math.max(0, Number(input.discount) || 0), p_cash: input.cash, p_notes: input.notes ?? null,
    });
    if (error) return fail(error);
    refresh();
    return ok(`Venta N° ${(data as any).number} registrada.`, data);
  });
}

export async function cancelSale(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('store_cancel_sale', { p_sale: reqStr(fd, 'id', 'id'), p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    refresh();
    return ok('Venta anulada: los productos volvieron al inventario.');
  });
}

export async function setOrderStatus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const status = reqStr(fd, 'status', 'Estado');
    const { error } = await ctx.supabase.rpc('store_set_order_status', { p_sale: reqStr(fd, 'id', 'id'), p_status: status, p_payment: str(fd, 'method') });
    if (error) return fail(error);
    refresh();
    return ok(status === 'pagada' ? 'Pago registrado.' : status === 'lista' ? 'Pedido listo para retiro o despacho.' : 'Pedido entregado.');
  });
}

/** ✉ Envía el comprobante de venta en PDF por correo. */
export async function sendSaleReceipt(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    if (!mailEnabled()) return fail('El envío de correos no está configurado (SMTP_* en Vercel). Descargue el PDF o use WhatsApp.');
    const ctx = await getContext();
    const s = await loadSale(ctx.supabase, reqStr(fd, 'id', 'id'));
    if (!s) return fail('Venta no encontrada.');
    const to = (str(fd, 'email') ?? s.customer.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail('Ingrese un correo válido.');
    const url = `${env.siteUrl()}/tienda/pedido/${s.tracking ?? ''}`;
    try {
      await sendMail(to, `${s.org.name}: comprobante de compra N° ${s.number}`,
        mailLayout(s.org.name, `Comprobante de compra N° ${s.number}`, `<p>Gracias por su compra.</p><p>Total: <b>${fmtMoney(s.total, s.currency)}</b>. Adjuntamos el comprobante en PDF.</p>`),
        `Comprobante de compra N° ${s.number} por ${fmtMoney(s.total, s.currency)}.${s.tracking ? ` ${url}` : ''}`,
        [{ filename: saleFilename(s), content: await salePdf(s), contentType: 'application/pdf' }]);
    } catch (e) { return fail((e as Error).message); }
    return ok(`Comprobante enviado a ${to}.`);
  });
}
