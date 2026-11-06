import Link from 'next/link';
import { getContext, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { FinanceTabs } from './tabs';

export const metadata = { title: 'Finanzas' };

export default async function Page({ searchParams }: { searchParams: Promise<{ morosos?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const { morosos } = await searchParams;
  let q = ctx.supabase.from('account_balances').select('*').eq('organization_id', orgId);
  if (morosos) q = q.gt('overdue', 0);
  const { data: balances } = await q.order('overdue', { ascending: false, nullsFirst: false }).limit(500);
  const ids = [...new Set((balances ?? []).map((b: any) => b.student_id))];
  const { data: students } = ids.length ? await ctx.supabase.from('students').select('id, first_names, last_names, student_code').in('id', ids) : { data: [] as any[] };
  const name = (id: string) => { const s = students?.find((x: any) => x.id === id); return s ? `${s.last_names}, ${s.first_names} (${s.student_code})` : id; };
  type T = { billed: number; paid: number; out: number; over: number };
  const totals: Record<string, T> = (balances ?? []).reduce((a: Record<string, T>, b: any) => {
    a[b.currency] ??= { billed: 0, paid: 0, out: 0, over: 0 };
    a[b.currency].billed += Number(b.total_billed ?? 0); a[b.currency].paid += Number(b.total_paid ?? 0);
    a[b.currency].out += Number(b.outstanding ?? 0); a[b.currency].over += Number(b.overdue ?? 0); return a;
  }, {} as Record<string, T>);

  return (
    <>
      <PageHeader title="Finanzas" subtitle="Aranceles, cuotas, pagos y cobranza" />
      <FinanceTabs current="cuentas" />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {Object.entries(totals).map(([cur, t]) => (
          <div key={cur} className="contents">
            <div className="card card-pad"><p className="label">Facturado {cur}</p><p className="text-xl font-bold">{fmtMoney(t.billed, cur)}</p></div>
            <div className="card card-pad"><p className="label">Recaudado</p><p className="text-xl font-bold">{fmtMoney(t.paid, cur)}</p></div>
            <div className="card card-pad"><p className="label">Por cobrar</p><p className="text-xl font-bold">{fmtMoney(t.out, cur)}</p></div>
            <div className="card card-pad"><p className="label">Vencido</p><p className="text-xl font-bold text-red-600">{fmtMoney(t.over, cur)}</p></div>
          </div>))}
      </div>
      <Card actions={<Link className="link text-sm" href={morosos ? '/app/finanzas' : '/app/finanzas?morosos=1'}>{morosos ? 'Ver todos' : 'Ver solo morosos'}</Link>} title="Cuentas de estudiantes">
        {balances?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Estudiante</th><th>Facturado</th><th>Pagado</th><th>Saldo</th><th>Vencido</th><th>Días de mora</th></tr></thead>
          <tbody>{balances.map((b: any) => (
            <tr key={b.account_id}><td><Link className="link" href={`/app/finanzas/cuenta/${b.student_id}`}>{name(b.student_id)}</Link></td>
              <td>{fmtMoney(b.total_billed, b.currency)}</td><td>{fmtMoney(b.total_paid, b.currency)}</td><td>{fmtMoney(b.outstanding, b.currency)}</td>
              <td className={Number(b.overdue) > 0 ? 'font-semibold text-red-600' : ''}>{fmtMoney(b.overdue ?? 0, b.currency)}</td>
              <td>{Number(b.max_days_overdue) > 0 ? <Badge color="red">{b.max_days_overdue} días</Badge> : '—'}</td></tr>))}</tbody></table></div>
          : <Empty>{morosos ? 'No hay cuentas con deuda vencida.' : 'Aún no hay cargos registrados.'}</Empty>}
      </Card>
    </>
  );
}
