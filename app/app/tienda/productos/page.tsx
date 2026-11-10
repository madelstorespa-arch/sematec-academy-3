import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtMoney } from '@/lib/format';
import { KINDS, kindIcon, kindLabel, qtyFmt } from '@/lib/store';
import { StoreTabs } from '../tabs';
import { ProductFields } from '../product-form';
import { createProduct } from '../actions';

export const metadata = { title: 'Productos' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; ver?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  let q = ctx.supabase.from('products').select('id, sku, barcode, name, kind, category, brand, unit, price, cost, stock, min_stock, track_stock, online, active, image_asset_id')
    .eq('organization_id', orgId).order('name').limit(1000);
  if (ctx.campusId) q = q.or(`campus_id.eq.${ctx.campusId},campus_id.is.null`); // 🏢 sucursal elegida + catálogo general
  if (sp.tipo) q = q.eq('kind', sp.tipo);
  if (sp.ver !== 'todos') q = q.eq('active', true);
  if (sp.ver === 'bajo') q = q.eq('track_stock', true);
  if (sp.q) { const t = sp.q.replace(/[%,()]/g, ''); q = q.or(`name.ilike.%${t}%,sku.ilike.%${t}%,barcode.eq.${t},brand.ilike.%${t}%,category.ilike.%${t}%`); }
  const { data: all } = await q;
  const rows = sp.ver === 'bajo' ? (all ?? []).filter((p: any) => Number(p.stock) <= Number(p.min_stock)) : all ?? [];
  const categories = [...new Set((all ?? []).map((p: any) => p.category).filter(Boolean))] as string[];
  const edit = can(ctx, 'store.edit');

  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle="Productos, precios, stock y publicación en la tienda web"
        actions={<a className="btn-secondary" href="/app/tienda/productos/csv">⬇ Inventario (Excel)</a>} />
      <StoreTabs current="productos" />
      {edit && (
        <details className="card mb-6" open={!rows.length}>
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold uppercase tracking-wide text-slate-600">➕ Nuevo producto</summary>
          <div className="card-pad pt-0"><ActionForm action={createProduct} submitLabel="Crear producto"><ProductFields isNew categories={categories} /></ActionForm></div>
        </details>)}
      <Card>
        <form className="mb-4 flex flex-wrap gap-2 text-sm">
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Buscar por nombre, código o código de barras" className="input max-w-xs" />
          <select name="tipo" defaultValue={sp.tipo ?? ''} className="input max-w-[12rem]"><option value="">Todos los tipos</option>{KINDS.map(([k, l, i]) => <option key={k} value={k}>{i} {l}</option>)}</select>
          <select name="ver" defaultValue={sp.ver ?? ''} className="input max-w-[12rem]"><option value="">Activos</option><option value="bajo">Con stock bajo</option><option value="todos">Todos (incluye desactivados)</option></select>
          <button className="btn-secondary">Filtrar</button>
        </form>
        {rows.length ? <div className="overflow-x-auto"><table className="table" data-testid="tabla-productos">
          <thead><tr><th></th><th>Producto</th><th>Tipo</th><th className="text-right">Precio</th><th className="text-right">Costo</th><th className="text-right">Margen</th><th className="text-right">Stock</th><th>Web</th></tr></thead>
          <tbody>{rows.map((p: any) => {
            const low = p.track_stock && Number(p.stock) <= Number(p.min_stock);
            const margin = Number(p.price) > 0 ? Math.round(((Number(p.price) / (1 + 0.19) - Number(p.cost)) / (Number(p.price) / 1.19)) * 100) : 0;
            return (
              <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                <td className="w-12">{p.image_asset_id
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/media/${p.image_asset_id}`} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded bg-slate-100 text-lg">{kindIcon(p.kind)}</span>}</td>
                <td><Link className="link font-medium" href={`/app/tienda/productos/${p.id}`}>{p.name}</Link>
                  <span className="block text-xs text-slate-500">{[p.sku, p.brand, p.category, p.barcode].filter(Boolean).join(' · ')}</span></td>
                <td className="text-xs">{kindLabel(p.kind)}</td>
                <td className="text-right font-semibold">{fmtMoney(p.price)}</td><td className="text-right text-xs">{fmtMoney(p.cost)}</td>
                <td className={`text-right text-xs ${margin < 10 ? 'text-red-600' : 'text-emerald-700'}`}>{margin}%</td>
                <td className="text-right">{p.track_stock ? <Badge color={Number(p.stock) <= 0 ? 'red' : low ? 'amber' : 'green'}>{qtyFmt(p.stock, p.unit)}</Badge> : '—'}</td>
                <td>{p.online ? '🌐' : ''}</td>
              </tr>);
          })}</tbody></table></div> : <Empty>{sp.q || sp.tipo || sp.ver ? 'Sin productos con ese filtro.' : 'Aún no hay productos. Cree el primero arriba.'}</Empty>}
      </Card>
    </>
  );
}
