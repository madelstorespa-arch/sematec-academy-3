import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { KINDS, methodLabel, qtyFmt } from '@/lib/store';
import { StoreTabs } from './tabs';

export const metadata = { title: 'Tienda' };

export default async function Page({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? '') ? sp.desde! : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta ?? '') ? sp.hasta! : today;
  const [{ data: r }, { data: day }, { data: org }] = await Promise.all([
    ctx.supabase.rpc('store_report', { p_org: orgId, p_from: from, p_to: to }),
    ctx.supabase.rpc('store_report', { p_org: orgId, p_from: today, p_to: today }),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
  ]);
  const cur = org?.base_currency ?? 'CLP';
  const m = (n: number) => fmtMoney(n, cur);
  const rep = (r ?? {}) as any, d = (day ?? {}) as any;
  const maxDay = Math.max(1, ...(rep.by_day ?? []).map((x: any) => Number(x.total)));

  return (
    <>
      <PageHeader title="Tienda" subtitle="Aseo, comestibles, bebestibles, electrónica y más: caja, tienda web e inventario"
        actions={can(ctx, 'store.create') ? <Link className="btn-primary" href="/app/tienda/caja">🧾 Abrir caja</Link> : undefined} />
      <StoreTabs current="resumen" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card card-pad"><p className="label">Ventas de hoy</p><p className="text-2xl font-bold" data-testid="ventas-hoy">{m(d.total ?? 0)}</p><p className="text-xs text-slate-500">{d.sales ?? 0} venta(s)</p></div>
        <div className="card card-pad"><p className="label">Ganancia de hoy</p><p className="text-2xl font-bold text-emerald-700">{m(d.profit ?? 0)}</p><p className="text-xs text-slate-500">Venta − costo de lo vendido</p></div>
        <div className="card card-pad"><p className="label">Pedidos web por atender</p><p className="text-2xl font-bold">{rep.pending_orders ?? 0}</p><Link className="link text-xs" href="/app/tienda/pedidos">Ver pedidos →</Link></div>
        <div className="card card-pad"><p className="label">Valor del inventario</p><p className="text-2xl font-bold">{m(rep.stock_value ?? 0)}</p><p className="text-xs text-slate-500">A precio de costo</p></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {(rep.low_stock?.length > 0 || rep.expiring?.length > 0) && (
          <Card title="⚠ Alertas" className="lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div><p className="mb-2 text-sm font-semibold">Stock bajo ({rep.low_stock?.length ?? 0})</p>
                <ul className="space-y-1 text-sm" data-testid="stock-bajo">{(rep.low_stock ?? []).slice(0, 12).map((x: any) => (
                  <li key={x.id} className="flex justify-between"><Link className="link" href={`/app/tienda/productos/${x.id}`}>{x.name}</Link><Badge color={Number(x.stock) <= 0 ? 'red' : 'amber'}>{qtyFmt(x.stock, x.unit)}</Badge></li>))}</ul></div>
              <div><p className="mb-2 text-sm font-semibold">Vence en 30 días o vencido ({rep.expiring?.length ?? 0})</p>
                <ul className="space-y-1 text-sm" data-testid="por-vencer">{(rep.expiring ?? []).slice(0, 12).map((x: any, i: number) => (
                  <li key={i} className="flex justify-between gap-2"><Link className="link" href={`/app/tienda/productos/${x.id}`}>{x.product}{x.lot ? ` · lote ${x.lot}` : ''}</Link>
                    <Badge color={x.expires < today ? 'red' : 'amber'}>{x.expires < today ? 'Vencido' : 'Vence'} {fmtDate(x.expires)} · {Number(x.qty)}</Badge></li>))}</ul></div>
            </div>
          </Card>)}

        <Card title="Periodo" actions={
          <form className="flex items-center gap-1 text-xs"><input type="date" name="desde" defaultValue={from} className="input py-1 text-xs" /><input type="date" name="hasta" defaultValue={to} className="input py-1 text-xs" /><button className="btn-secondary btn-sm">Ver</button></form>}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="label">Ventas</dt><dd className="text-xl font-bold">{m(rep.total ?? 0)}</dd><dd className="text-xs text-slate-500">{rep.sales ?? 0} venta(s)</dd></div>
            <div><dt className="label">Ganancia</dt><dd className="text-xl font-bold text-emerald-700">{m(rep.profit ?? 0)}</dd><dd className="text-xs text-slate-500">Costo: {m(rep.cost ?? 0)}</dd></div>
            <div><dt className="label">IVA incluido</dt><dd className="font-semibold">{m(rep.tax ?? 0)}</dd></div>
            <div><dt className="label">Por canal</dt><dd className="text-xs">Caja {m(rep.by_channel?.caja ?? 0)} · Web {m(rep.by_channel?.web ?? 0)}</dd></div>
          </dl>
          <p className="mb-1 mt-4 text-xs font-semibold text-slate-500">Por tipo de producto</p>
          <ul className="space-y-1 text-sm">{KINDS.filter(([k]) => rep.by_kind?.[k]).map(([k, l, i]) => <li key={k} className="flex justify-between"><span>{i} {l}</span><b>{m(rep.by_kind[k])}</b></li>)}</ul>
          <p className="mb-1 mt-4 text-xs font-semibold text-slate-500">Por medio de pago</p>
          <ul className="space-y-1 text-sm">{Object.entries(rep.by_method ?? {}).map(([k, v]) => <li key={k} className="flex justify-between"><span>{methodLabel(k)}</span><b>{m(v as number)}</b></li>)}</ul>
        </Card>

        <Card title="Ventas por día">
          {rep.by_day?.length ? <ul className="space-y-1 text-xs">{rep.by_day.map((x: any) => (
            <li key={x.d} className="flex items-center gap-2"><span className="w-20 shrink-0">{fmtDate(x.d)}</span>
              <span className="h-3 rounded bg-brand-600" style={{ width: `${(Number(x.total) / maxDay) * 60}%` }} /><span className="shrink-0">{m(x.total)} ({x.n})</span></li>))}</ul>
            : <Empty>Sin ventas en el periodo.</Empty>}
        </Card>

        <Card title="🏆 Más vendidos" className="lg:col-span-2">
          {rep.top?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Producto</th><th className="text-right">Cantidad</th><th className="text-right">Ventas</th><th className="text-right">Ganancia</th></tr></thead>
            <tbody>{rep.top.map((x: any) => <tr key={x.name}><td>{x.name}</td><td className="text-right">{Number(x.qty)}</td><td className="text-right">{m(x.total)}</td><td className="text-right text-emerald-700">{m(x.profit)}</td></tr>)}</tbody></table></div>
            : <Empty>Aún no hay ventas.</Empty>}
        </Card>
      </div>
    </>
  );
}
