import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader, Card, Empty, Badge, Stat } from '@/components/ui';
import { fmtDateTime, fmtMoney, PAY_METHODS } from '@/lib/format';
import { myStudents } from '@/lib/receipt-access';

export const metadata = { title: 'Mis boletas' };

/** 🧾 Todas las boletas de cada pago del estudiante (o de los pupilos del apoderado), con descarga en PDF. */
export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string; anio?: string }> }) {
  const { e, anio } = await searchParams;
  const ctx = await getContext();
  const studs = await myStudents(ctx.supabase, ctx.user.id);
  if (!studs.length) redirect('/app');
  const pick = studs.find((s) => s.id === e) ?? null;
  const ids = pick ? [pick.id] : studs.map((s) => s.id);
  let q = createAdminClient().from('payments')
    .select('id, receipt_number, kind, status, amount, currency, method, paid_at, student_id').in('student_id', ids).order('paid_at', { ascending: false }).limit(500);
  if (anio && /^\d{4}$/.test(anio)) q = q.gte('paid_at', `${anio}-01-01`).lt('paid_at', `${Number(anio) + 1}-01-01`);
  const { data } = await q;
  const pays = (data ?? []) as any[];
  const name = new Map(studs.map((s) => [s.id, s.name]));
  const total = pays.filter((p) => p.status === 'confirmed' && p.kind !== 'refund').reduce((a, p) => a + Number(p.amount), 0);
  const years = [...new Set([new Date().getFullYear(), ...pays.map((p) => new Date(p.paid_at).getFullYear())])].sort((a, b) => b - a);
  const cur = pays[0]?.currency ?? 'CLP';
  return (
    <>
      <PageHeader title="🧾 Mis boletas" subtitle="Una boleta por cada pago. Puede verla, descargarla en PDF, imprimirla o enviársela por correo." />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        {studs.length > 1 && <label className="block"><span className="label">Estudiante</span>
          <select name="e" defaultValue={e ?? ''} className="input"><option value="">Todos</option>{studs.map((s) => <option key={s.id} value={s.id}>{s.name}{s.mine ? ' (yo)' : ''}</option>)}</select></label>}
        <label className="block"><span className="label">Año</span>
          <select name="anio" defaultValue={anio ?? ''} className="input"><option value="">Todos</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button className="btn-secondary">Filtrar</button>
      </form>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Boletas" value={pays.length} />
        <Stat label="Total pagado" value={fmtMoney(total, cur)} />
        <Stat label="Último pago" value={pays[0] ? fmtDateTime(pays[0].paid_at) : '—'} />
      </div>
      <Card>
        {pays.length ? (
          <div className="overflow-x-auto"><table className="table" data-testid="mis-boletas">
            <thead><tr><th>Boleta</th><th>Fecha</th>{studs.length > 1 && <th>Estudiante</th>}<th>Medio</th><th className="text-right">Monto</th><th>Estado</th><th /></tr></thead>
            <tbody>{pays.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs"><Link className="link" href={`/app/finanzas/boleta/${p.id}`}>🧾 {p.kind === 'refund' ? 'R-' : ''}{p.receipt_number}</Link></td>
                <td>{fmtDateTime(p.paid_at)}</td>
                {studs.length > 1 && <td>{name.get(p.student_id)}</td>}
                <td>{PAY_METHODS.find((m) => m.value === p.method)?.label ?? p.method}</td>
                <td className="text-right">{p.kind === 'refund' ? '−' : ''}{fmtMoney(p.amount, p.currency)}</td>
                <td>{p.status === 'confirmed' ? <Badge color="green">Pagado</Badge> : <Badge color="red">Anulado</Badge>}</td>
                <td className="whitespace-nowrap"><a className="btn-secondary btn-sm" href={`/app/finanzas/boleta/${p.id}/pdf`} data-testid="descargar-mi-boleta">⬇ PDF</a></td>
              </tr>))}</tbody>
          </table></div>) : <Empty>Aún no hay pagos registrados.</Empty>}
      </Card>
    </>
  );
}
