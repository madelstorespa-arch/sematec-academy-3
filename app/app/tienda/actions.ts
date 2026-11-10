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
    sku: (str(fd, 'sku') ?? '').toUpperCase().replace(/\s+/g, '').slice(0, 40) || null, barcode: barcode || null, name: reqStr(fd, 'name', 'Nombre'),
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
    const { sku, ...rest } = productRow(fd);
    const { error, count } = await ctx.supabase.from('products').update({ ...rest, ...(sku ? { sku } : {}), ...(image ? { image_asset_id: image } : {}) }, { count: 'exact' }).eq('id', id);
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
export async function sell(input: { items: CartLine[]; method: string; discount: number; cash: number | null; customer: Record<string, string>; notes?: string; coupon?: string }): Promise<ActionResult> {
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
      p_discount: Math.max(0, Number(input.discount) || 0), p_cash: input.cash, p_notes: input.notes ?? null, p_coupon: input.coupon?.trim() || null,
    });
    if (error) return fail(error);
    refresh();
    return ok(`Boleta ${(data as any).code} registrada.`, data);
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
      await sendMail(to, `${s.org.name}: boleta ${s.code}`,
        mailLayout(s.org.name, `Boleta ${s.code}`, `<p>Gracias por su compra.</p><p>Total: <b>${fmtMoney(s.total, s.currency)}</b>. Adjuntamos el comprobante en PDF.</p>`),
        `Boleta ${s.code} por ${fmtMoney(s.total, s.currency)}.${s.tracking ? ` ${url}` : ''}`,
        [{ filename: saleFilename(s), content: await salePdf(s), contentType: 'application/pdf' }]);
    } catch (e) { return fail((e as Error).message); }
    return ok(`Comprobante enviado a ${to}.`);
  });
}

function promoRow(fd: FormData) {
  const kind = reqStr(fd, 'kind', 'Tipo de oferta');
  const scope = reqStr(fd, 'scope', 'Aplica a');
  const value = num(fd, 'value') ?? 0;
  if (kind !== 'nxm' && value <= 0) throw new ValidationError('Ingrese el valor de la oferta.');
  if (kind === 'percent' && value > 100) throw new ValidationError('El porcentaje no puede superar 100.');
  const products = fd.getAll('product_ids').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (scope === 'products' && !products.length) throw new ValidationError('Elija al menos un producto.');
  return {
    name: reqStr(fd, 'name', 'Nombre'), kind, value: kind === 'nxm' ? 0 : value,
    buy_qty: kind === 'nxm' ? num(fd, 'buy_qty') : null, pay_qty: kind === 'nxm' ? num(fd, 'pay_qty') : null,
    scope, scope_kind: scope === 'kind' ? str(fd, 'scope_kind') : null, scope_category: scope === 'category' ? str(fd, 'scope_category') : null,
    product_ids: scope === 'products' ? products : [], channel: str(fd, 'channel') ?? 'ambos',
    starts_at: str(fd, 'starts_at') ? new Date(`${str(fd, 'starts_at')}T00:00:00-03:00`).toISOString() : null,
    ends_at: str(fd, 'ends_at') ? new Date(`${str(fd, 'ends_at')}T23:59:59-03:00`).toISOString() : null,
    badge: str(fd, 'badge'), active: fd.get('active') !== 'off',
  };
}

/** 🏷 Crea o edita una oferta / promoción. */
export async function savePromotion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const id = str(fd, 'id');
    const row = promoRow(fd);
    const { error, count } = id
      ? await ctx.supabase.from('store_promotions').update(row, { count: 'exact' }).eq('id', id)
      : await ctx.supabase.from('store_promotions').insert({ ...row, organization_id: ctx.orgId }, { count: 'exact' });
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso para administrar ofertas.');
    refresh();
    return ok(id ? 'Oferta actualizada.' : `Oferta «${row.name}» creada: ya se aplica en la caja y en la tienda web.`);
  });
}

export async function deletePromotion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('store_promotions').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso.');
    refresh(); return ok('Oferta eliminada.');
  });
}

/** 🎟 Cupón de descuento (código que el cliente escribe en la caja o en la web). */
export async function saveCoupon(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const code = reqStr(fd, 'code', 'Código').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) return fail('El código debe tener entre 4 y 20 letras o números (sin espacios).');
    const value = num(fd, 'value') ?? 0;
    const row = {
      code, kind: reqStr(fd, 'kind', 'Tipo'), value, min_total: num(fd, 'min_total') ?? 0, max_uses: num(fd, 'max_uses') || null, channel: str(fd, 'channel') ?? 'ambos',
      ends_at: str(fd, 'ends_at') ? new Date(`${str(fd, 'ends_at')}T23:59:59-03:00`).toISOString() : null, active: fd.get('active') !== 'off',
    };
    const id = str(fd, 'id');
    const { error, count } = id ? await ctx.supabase.from('store_coupons').update(row, { count: 'exact' }).eq('id', id)
      : await ctx.supabase.from('store_coupons').insert({ ...row, organization_id: ctx.orgId }, { count: 'exact' });
    if (error) return fail(error.code === '23505' ? 'Ya existe un cupón con ese código.' : error);
    if (!count) return fail('No tiene permiso.');
    refresh(); return ok(`Cupón ${code} guardado.`);
  });
}

export async function deleteCoupon(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('store_coupons').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso.');
    refresh(); return ok('Cupón eliminado.');
  });
}

/** Nombre de la tienda (por defecto SEMATEC VENTA). */
export async function saveStoreName(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId || !can(ctx, 'store.admin')) return fail('Solo el propietario puede cambiar el nombre de la tienda.');
    const { error } = await ctx.supabase.from('site_settings').update({ store_name: reqStr(fd, 'store_name', 'Nombre').slice(0, 60) }).eq('organization_id', ctx.orgId);
    if (error) return fail(error);
    refresh(); revalidatePath('/', 'layout');
    return ok('Nombre de la tienda actualizado.');
  });
}

/** Vista previa de un cupón en la caja. */
export async function checkCoupon(code: string, total: number): Promise<{ valid: boolean; discount?: number; code?: string }> {
  const ctx = await getContext();
  if (!ctx.orgId) return { valid: false };
  const { data } = await ctx.supabase.rpc('store_coupon_check', { p_org: ctx.orgId, p_code: code, p_total: total, p_channel: 'caja' });
  return (data ?? { valid: false }) as { valid: boolean; discount?: number; code?: string };
}

// ---------- 💵 Apertura y cierre de caja ----------
export async function openCash(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const amount = num(fd, 'amount');
    if (amount === null || amount < 0) throw new ValidationError('Indique el dinero con que abre la caja (0 o más).');
    const { error } = await ctx.supabase.rpc('cash_open', { p_org: ctx.orgId, p_amount: amount, p_notes: str(fd, 'notes') });
    if (error) return fail(error);
    refresh();
    return ok(`Caja abierta con ${fmtMoney(amount)}${ctx.campusName ? ` en ${ctx.campusName}` : ''}.`);
  });
}

export async function closeCash(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const counted = num(fd, 'counted');
    if (counted === null || counted < 0) throw new ValidationError('Cuente el dinero de la caja e ingréselo (0 o más).');
    const { data, error } = await ctx.supabase.rpc('cash_close', { p_session: reqStr(fd, 'id', 'caja'), p_counted: counted, p_notes: str(fd, 'notes') });
    if (error) return fail(error);
    const r = data as { expected: number; counted: number; difference: number; count: number; total: number };
    refresh();
    const diff = Number(r.difference);
    return ok(`Caja cerrada: ${r.count} venta(s) por ${fmtMoney(r.total)}. Esperado en efectivo ${fmtMoney(r.expected)}, contado ${fmtMoney(r.counted)}: ${diff === 0 ? 'cuadra perfecto ✓' : diff > 0 ? `sobran ${fmtMoney(diff)}` : `faltan ${fmtMoney(-diff)}`}.`);
  });
}

/** 🔁 Traslado de stock a otra sucursal. */
export async function transferStock(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const qty = num(fd, 'qty');
    if (qty === null || qty <= 0) throw new ValidationError('Indique cuántas unidades traslada.');
    const { error } = await ctx.supabase.rpc('store_transfer', { p_product: reqStr(fd, 'id', 'producto'), p_to_campus: reqStr(fd, 'to', 'Sucursal de destino'), p_qty: qty, p_note: str(fd, 'note') });
    if (error) return fail(error);
    refresh();
    return ok(`Trasladadas ${qty} unidad(es) a ${ctx.campuses.find((c) => c.id === fd.get('to'))?.name ?? 'la otra sucursal'}.`);
  });
}
