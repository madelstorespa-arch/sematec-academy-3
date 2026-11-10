import Link from 'next/link';
import { getContext, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { expenseLabel, monthName, monthRange } from '@/lib/finance';
import { FinanceTabs } from '../tabs';

export const metadata = { title: 'Ingresos y gastos' };

type Row = { id: string; code: string; name: string; students: number; income: number; expenses: number; months: Record<string, number> };
type Report = {
  currency: string; income: number; expenses: number; months: { m: string; income: number; expenses: number }[];
  programs: Row[]; sections: Row[]; unassigned_income: number; general_expenses: number; categories: Record<string, number>;
  tuition_income?: number; store_income?: number; store_cost?: number;
};

function ym(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

export default async function Page({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; moneda?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const r = monthRange(sp.desde, sp.hasta);
  const { data, error } = await ctx.supabase.rpc('finance_report', { p_org: orgId, p_from: r.start, p_to: r.end, p_currency: sp.moneda || null });
  const rep = data as Report | null;
  const cur = rep?.currency ?? 'CLP';
  const money = (n: number) => fmtMoney(n, cur);
  const net = (rep?.income ?? 0) - (rep?.expenses ?? 0);
  const multi = (rep?.months.length ?? 0) > 1;
  const maxBar = Math.max(1, ...(rep?.months ?? []).flatMap((m) => [m.income, m.expenses]));
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const quick = [
    ['Este mes', ym(now), ym(now)], ['Mes anterior', ym(prev), ym(prev)],
    ['Últimos 6 meses', ym(new Date(now.getFullYear(), now.getMonth() - 5, 1)), ym(now)], ['Este año', `${now.getFullYear()}-01`, ym(now)],
  ];
  const csv = `/app/finanzas/balance/csv?desde=${r.from}&hasta=${r.to}${sp.moneda ? `&moneda=${sp.moneda}` : ''}`;

  const Table = ({ rows, kind }: { rows: Row[]; kind: 'program' | 'section' }) => (
    <div className="overflow-x-auto"><table className="table" data-testid={kind === 'program' ? 'balance-programas' : 'balance-secciones'}>
      <thead><tr>
        <th>{kind === 'program' ? 'Programa' : 'Sección'}</th><th className="text-right">Alumnos</th>
        {multi && rep!.months.map((m) => <th key={m.m} className="text-right">{monthName(m.m, true)}</th>)}
        <th className="text-right">Ingresos</th><th className="text-right">Gastos</th><th className="text-right">Saldo</th>
      </tr></thead>
      <tbody>{rows.map((x) => {
        const s = x.income - x.expenses;
        return (
          <tr key={x.id}>
            <td>{kind === 'program' ? <Link className="link" href={`/app/academico/programas/${x.id}`}>{x.name}</Link> : <Link className="link" href={`/app/secciones/${x.id}`}>{x.name} · {x.code}</Link>}</td>
            <td className="text-right">{x.students}</td>
            {multi && rep!.months.map((m) => <td key={m.m} className="text-right text-xs">{x.months?.[m.m] ? money(x.months[m.m]) : '—'}</td>)}
            <td className="text-right font-semibold text-emerald-700">{money(x.income)}</td>
            <td className="text-right text-red-600">{x.expenses ? money(x.expenses) : '—'}</td>
            <td className={`text-right font-bold ${s < 0 ? 'text-red-600' : ''}`}>{money(s)}</td>
          </tr>);
      })}</tbody></table></div>
  );

  return (
    <>
      <PageHeader title="Finanzas" subtitle="Ingresos, gastos y lo que queda cada mes, por programa y por sección" />
      <FinanceTabs current="balance" />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label><span className="label">Desde</span><input type="month" name="desde" defaultValue={r.from} className="input py-1.5" /></label>
          <label><span className="label">Hasta</span><input type="month" name="hasta" defaultValue={r.to} className="input py-1.5" /></label>
          <label><span className="label">Moneda</span><input name="moneda" defaultValue={sp.moneda ?? cur} className="input w-20 py-1.5" maxLength={3} /></label>
          <button className="btn-primary">Calcular</button>
        </form>
        <div className="flex flex-wrap gap-1">{quick.map(([l, a, b]) => <Link key={l} className="btn-secondary btn-sm" href={`/app/finanzas/balance?desde=${a}&hasta=${b}`}>{l}</Link>)}</div>
        <a className="btn-secondary btn-sm ml-auto" href={csv}>⬇ Descargar Excel (CSV)</a>
      </div>
      {error || !rep ? <Card><Empty>{error?.message ?? 'No se pudo calcular.'}</Empty></Card> : (
        <>
          <p className="mb-3 text-sm text-slate-500">{r.from === r.to ? monthName(r.from) : `${monthName(r.from)} a ${monthName(r.to)}`} · {cur}</p>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card card-pad"><p className="label">💰 Ingresos</p><p className="text-2xl font-bold text-emerald-700" data-testid="kpi-ingresos">{money(rep.income)}</p><p className="text-xs text-slate-500">{rep.store_income ? <>Educación {money(rep.tuition_income ?? 0)} · <span data-testid="kpi-tienda">🛒 Tienda {money(rep.store_income)}</span></> : 'Pagos recibidos menos reembolsos'}</p></div>
            <div className="card card-pad"><p className="label">💸 Gastos</p><p className="text-2xl font-bold text-red-600" data-testid="kpi-gastos">{money(rep.expenses)}</p><p className="text-xs text-slate-500"><Link className="link" href={`/app/finanzas/gastos?mes=${r.to}`}>Registrar o ver gastos</Link></p></div>
            <div className={`card card-pad ${net < 0 ? 'ring-2 ring-red-200' : 'ring-2 ring-emerald-200'}`}><p className="label">🏦 Queda (saldo)</p><p className={`text-2xl font-bold ${net < 0 ? 'text-red-600' : ''}`} data-testid="kpi-saldo">{money(net)}</p><p className="text-xs text-slate-500">Ingresos − gastos</p></div>
            <div className="card card-pad"><p className="label">📈 Margen</p><p className="text-2xl font-bold">{rep.income > 0 ? `${Math.round((net / rep.income) * 100)}%` : '—'}</p><p className="text-xs text-slate-500">Del ingreso que queda</p></div>
          </div>

          <Card title="Mes a mes" className="mb-6">
            <div className="overflow-x-auto"><table className="table" data-testid="balance-meses">
              <thead><tr><th>Mes</th><th className="text-right">Ingresos</th><th className="text-right">Gastos</th><th className="text-right">Queda</th><th className="w-1/3">Comparación</th></tr></thead>
              <tbody>{rep.months.map((m) => (
                <tr key={m.m}>
                  <td className="font-medium">{monthName(m.m)}</td>
                  <td className="text-right text-emerald-700">{money(m.income)}</td><td className="text-right text-red-600">{money(m.expenses)}</td>
                  <td className={`text-right font-bold ${m.income - m.expenses < 0 ? 'text-red-600' : ''}`}>{money(m.income - m.expenses)}</td>
                  <td><div className="space-y-1" aria-hidden>
                    <div className="h-2 rounded bg-emerald-500" style={{ width: `${(Math.max(0, m.income) / maxBar) * 100}%` }} />
                    <div className="h-2 rounded bg-red-400" style={{ width: `${(m.expenses / maxBar) * 100}%` }} />
                  </div></td>
                </tr>))}</tbody></table></div>
            <p className="mt-2 text-xs text-slate-500"><span className="inline-block h-2 w-4 rounded bg-emerald-500" /> Ingresos <span className="ml-3 inline-block h-2 w-4 rounded bg-red-400" /> Gastos</p>
          </Card>

          <Card title="Por programa / carrera / curso" className="mb-6">
            {rep.programs.length ? <Table rows={rep.programs} kind="program" /> : <Empty>Sin ingresos asociados a programas en este rango.</Empty>}
            <p className="mt-2 text-xs text-slate-500">El ingreso se asigna al programa de la matrícula de cada cuota pagada. {rep.unassigned_income ? `Pagos sin matrícula asociada: ${money(rep.unassigned_income)}.` : ''}</p>
          </Card>

          <Card title="Por sección" className="mb-6">
            {rep.sections.length ? <Table rows={rep.sections} kind="section" /> : <Empty>Sin ingresos asociados a secciones en este rango.</Empty>}
            <p className="mt-2 text-xs text-slate-500">Si una matrícula tiene varias secciones, su pago se reparte en partes iguales entre ellas.</p>
          </Card>

          <Card title="Gastos por categoría">
            {Object.keys(rep.categories).length ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(rep.categories).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <li key={k} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{expenseLabel(k)}</span><b>{money(v)}</b></li>))}
              </ul>) : <Empty>Sin gastos en este rango.</Empty>}
            {rep.general_expenses > 0 && <p className="mt-2 text-xs text-slate-500">Gastos generales (no asociados a un programa o sección): {money(rep.general_expenses)}.</p>}
          </Card>
        </>
      )}
    </>
  );
}
