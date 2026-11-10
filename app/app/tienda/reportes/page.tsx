import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Stat } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { methodLabel } from '@/lib/store';
import { StoreTabs } from '../tabs';

export const metadata = { title: 'Reportes de ventas' };
type Row = { n: number; t: number } & Record<string, any>;
type R = { count: number; total: number; cost: number; avg: number; by_day: Row[]; by_hour: Row[]; by_method: Row[]; by_channel: Row[]; by_seller: Row[]; by_campus: Row[]; top: Row[] };

const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

function Bars({ rows, label, testid }: { rows: Row[]; label: (r: Row) => string; testid?: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.t)));
  if (!rows.length) return <Empty>Sin ventas en el período.</Empty>;
  return (
    <ul className="space-y-1.5 text-sm" data-testid={testid}>{rows.map((r, i) => (
      <li key={i}>
        <div className="flex justify-between gap-2"><span className="truncate">{label(r)}</span><span className="shrink-0 font-semibold">{fmtMoney(r.t)} <span className="text-xs font-normal text-slate-500">· {r.n ?? r.q}</span></span></div>
        <div className="mt-0.5 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-600" style={{ width: `${Math.max(2, (Number(r.t) / max) * 100)}%` }} /></div>
      </li>))}</ul>);
}

/** 📈 Reportes de ventas: por día, hora, medio de pago, vendedor, sucursal y productos más vendidos. */
export default async function Page({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, 'store.view')) redirect('/app/tienda');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const today = new Date();
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const hasta = ok(sp.hasta) ?? iso(today);
  const desde = ok(sp.desde) ?? iso(new Date(today.getTime() - 29 * 86400000));
  const [from, to] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  const { data, error } = await ctx.supabase.rpc('store_sales_report', { p_org: orgId, p_from: from, p_to: to, p_campus: ctx.campusId });
  const r = (data ?? { count: 0, total: 0, cost: 0, avg: 0, by_day: [], by_hour: [], by_method: [], by_channel: [], by_seller: [], by_campus: [], top: [] }) as R;
  const quick: [string, string, string][] = [
    ['Hoy', iso(today), iso(today)], ['7 días', iso(new Date(today.getTime() - 6 * 86400000)), iso(today)],
    ['30 días', iso(new Date(today.getTime() - 29 * 86400000)), iso(today)],
    ['Este mes', `${iso(today).slice(0, 8)}01`, iso(today)], ['Este año', `${iso(today).slice(0, 4)}-01-01`, iso(today)],
  ];
  const margin = Number(r.total) - Number(r.cost);
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle={`Reportes de ventas${ctx.campusName ? ` · Sucursal ${ctx.campusName}` : ''}`} />
      <StoreTabs current="reportes" />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="block"><span className="label">Desde</span><input type="date" name="desde" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">Hasta</span><input type="date" name="hasta" defaultValue={to} className="input" /></label>
        <button className="btn-secondary">Ver</button>
        <span className="flex flex-wrap gap-1">{quick.map(([l, a, b]) => <Link key={l} className="rounded-full bg-slate-100 px-3 py-1 text-sm hover:bg-slate-200" href={`?desde=${a}&hasta=${b}`}>{l}</Link>)}</span>
      </form>
      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpi-ventas">
        <Stat label="Ventas" value={String(r.count)} />
        <Stat label="Total vendido" value={fmtMoney(r.total)} />
        <Stat label="Ticket promedio" value={fmtMoney(r.avg)} />
        <Stat label="Margen (venta − costo)" value={fmtMoney(margin)} hint={Number(r.total) ? `${Math.round((margin / Number(r.total)) * 100)}%` : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="📅 Por día"><Bars rows={r.by_day} label={(x) => new Date(`${x.d}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit' })} testid="ventas-dia" /></Card>
        <Card title="🏆 Productos más vendidos"><Bars rows={r.top} label={(x) => `${x.name} (${Number(x.q)} u.)`} testid="top-productos" /></Card>
        <Card title="🕐 Por hora del día"><Bars rows={r.by_hour} label={(x) => `${String(x.h).padStart(2, '0')}:00 – ${String(x.h).padStart(2, '0')}:59`} /></Card>
        <Card title="💳 Por medio de pago"><Bars rows={r.by_method} label={(x) => methodLabel(x.m)} /></Card>
        <Card title="🧑‍💼 Por vendedor(a)"><Bars rows={r.by_seller} label={(x) => x.name} /></Card>
        <Card title="🏢 Por sucursal y canal">
          <Bars rows={r.by_campus} label={(x) => x.name} testid="ventas-sucursal" />
          <div className="mt-4"><Bars rows={r.by_channel} label={(x) => (x.c === 'web' ? '🛍 Tienda web' : '🧾 Caja')} /></div>
        </Card>
      </div>
    </>
  );
}
