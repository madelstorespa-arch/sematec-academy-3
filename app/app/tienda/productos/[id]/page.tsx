import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { MOVE_LABEL, kindIcon, kindLabel, qtyFmt } from '@/lib/store';
import { StoreTabs } from '../../tabs';
import { createAdminClient } from '@/lib/supabase/admin';
import { ProductFields } from '../../product-form';
import { adjustStock, deleteProduct, updateProduct } from '../../actions';

export const metadata = { title: 'Producto' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const { data: p } = await ctx.supabase.from('products').select('*').eq('id', id).eq('organization_id', orgId).maybeSingle();
  if (!p) notFound();
  const [{ data: lots }, { data: moves }, { data: cats }] = await Promise.all([
    ctx.supabase.from('product_lots').select('*').eq('product_id', id).gt('qty_remaining', 0).order('expires_on', { nullsFirst: false }),
    ctx.supabase.from('stock_movements').select('kind, qty, unit_cost, note, created_at, created_by, sale_id, purchase_id, sales(number, code)').eq('product_id', id).order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('products').select('category').eq('organization_id', orgId).not('category', 'is', null),
  ]);
  const edit = can(ctx, 'store.edit');
  const uids = [...new Set((moves ?? []).map((m: any) => m.created_by).filter(Boolean))];
  const { data: who } = uids.length ? await createAdminClient().from('profiles').select('id, full_name, id_document_number').in('id', uids) : { data: [] };
  const whoOf = new Map((who ?? []).map((p: any) => [p.id, `${p.full_name ?? ''}${p.id_document_number ? ` · ${p.id_document_number}` : ''}`]));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title={`${kindIcon(p.kind)} ${p.name}`} subtitle={`${kindLabel(p.kind)} · ${p.sku}${p.barcode ? ` · ${p.barcode}` : ''} · ${fmtMoney(p.price, p.currency)}`}
        actions={<Link className="btn-secondary" href="/app/tienda/productos">← Productos</Link>} />
      <StoreTabs current="productos" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Stock" className="lg:col-span-1">
          <p className="text-3xl font-bold" data-testid="stock-actual">{p.track_stock ? qtyFmt(p.stock, p.unit) : 'Sin control de stock'}</p>
          {p.track_stock && Number(p.stock) <= Number(p.min_stock) && <Badge color="amber">Bajo el mínimo ({Number(p.min_stock)})</Badge>}
          <p className="mt-2 text-xs text-slate-500">Valor a costo: {fmtMoney(Math.max(0, Number(p.stock)) * Number(p.cost), p.currency)}</p>
          {lots?.length ? (
            <ul className="mt-4 space-y-1 text-sm" data-testid="lotes">{lots.map((l: any) => (
              <li key={l.id} className="flex justify-between gap-2"><span>{l.lot_code ? `Lote ${l.lot_code}` : 'Sin lote'}{l.expires_on && <> · vence {fmtDate(l.expires_on)}</>}</span>
                <Badge color={l.expires_on && l.expires_on < today ? 'red' : 'gray'}>{Number(l.qty_remaining)}</Badge></li>))}</ul>) : null}
          {edit && (
            <ActionForm action={adjustStock} submitLabel="Aplicar ajuste" className="mt-5">
              <input type="hidden" name="id" value={p.id} />
              <SelectField label="Tipo de ajuste" name="kind" required defaultValue="ajuste" options={[
                { value: 'ajuste', label: 'Ajuste por conteo (+ o −)' }, { value: 'merma', label: 'Merma: vencido, dañado o perdido (resta)' },
                { value: 'devolucion', label: 'Devolución de cliente (suma)' }, { value: 'inicial', label: 'Stock inicial (suma)' }]} />
              <Grid cols={2}>
                <Field label="Cantidad" name="qty" type="number" step="any" required placeholder="Ej.: 5 o -2" />
                <Field label="Motivo" name="note" placeholder="Ej.: conteo mensual" />
                {p.track_expiry && <><Field label="Vence el (si suma)" name="expires" type="date" /><Field label="Lote" name="lot" /></>}
              </Grid>
              <p className="text-xs text-slate-500">Para mercadería comprada use «📥 Compras»: además registra el gasto.</p>
            </ActionForm>)}
        </Card>
        <Card title="✏ Datos del producto" className="lg:col-span-2">
          {edit ? (<>
            {p.image_asset_id && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/media/${p.image_asset_id}`} alt="" className="mb-3 h-28 rounded-lg object-cover" />}
            <ActionForm action={updateProduct} submitLabel="Guardar cambios" resetOnSuccess={false}>
              <input type="hidden" name="id" value={p.id} />
              <ProductFields d={p} categories={[...new Set((cats ?? []).map((c: any) => c.category))] as string[]} />
            </ActionForm>
            <ActionForm action={deleteProduct} submitLabel="🗑 Eliminar producto" submitClass="mt-4 text-sm text-red-600 hover:underline" confirm={`¿Eliminar «${p.name}»? Si ya tiene ventas o compras, solo se desactivará.`}>
              <input type="hidden" name="id" value={p.id} />
            </ActionForm>
          </>) : <p className="text-sm text-slate-600">{p.description ?? 'Sin descripción.'}</p>}
        </Card>
        <Card title="Movimientos de inventario" className="lg:col-span-3">
          {moves?.length ? <div className="overflow-x-auto"><table className="table" data-testid="movimientos">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th className="text-right">Cantidad</th><th>Detalle</th><th>Quién (nombre · RUT)</th></tr></thead>
            <tbody>{moves.map((m: any, i: number) => (
              <tr key={i}><td className="text-xs">{fmtDateTime(m.created_at)}</td><td>{MOVE_LABEL[m.kind] ?? m.kind}</td>
                <td className={`text-right font-semibold ${Number(m.qty) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{Number(m.qty) > 0 ? '+' : ''}{Number(m.qty)}</td>
                <td className="text-xs">{m.sale_id ? <Link className="link" href={`/app/tienda/ventas/${m.sale_id}`}>Boleta {m.sales?.code}</Link> : m.note ?? ''}</td>
                <td className="text-xs">{whoOf.get(m.created_by) ?? 'Tienda web'}</td></tr>))}</tbody></table></div>
            : <Empty>Sin movimientos.</Empty>}
        </Card>
      </div>
    </>
  );
}
