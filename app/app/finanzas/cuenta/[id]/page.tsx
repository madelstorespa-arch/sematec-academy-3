import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Badge } from '@/components/ui';
import { ActionForm, Field, SelectField } from '@/components/forms';
import { fmtDate, fmtDateTime, fmtMoney, fullName, PAY_METHODS } from '@/lib/format';
import { voidPayment, refundPayment } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!can(ctx, 'finance.view') && ctx.studentId !== id) notFound();
  const sb = ctx.supabase;
  const { data: s } = await sb.from('students').select('id, first_names, last_names, student_code').eq('id', id).maybeSingle();
  if (!s) notFound();
  const [{ data: inst }, { data: pays }] = await Promise.all([
    sb.from('installment_balances').select('*').eq('student_id', id).order('due_on'),
    sb.from('payments').select('*').eq('student_id', id).order('paid_at', { ascending: false }),
  ]);
  const staff = can(ctx, 'finance.view');
  return (
    <>
      <PageHeader title={`Estado de cuenta · ${fullName(s)}`} subtitle={s.student_code} actions={staff ? <Link className="btn-secondary" href="/app/finanzas">Volver</Link> : undefined} />
      <div className="space-y-6">
        <Card title="Cuotas">
          {inst?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Concepto</th><th>Cuota</th><th>Vencimiento</th><th className="text-right">Monto</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th><th>Estado</th></tr></thead>
            <tbody>{inst.map((i: any) => (
              <tr key={i.installment_id} className={i.cancelled ? 'text-slate-400 line-through' : ''}><td>{i.concept}</td><td>{i.number}</td><td>{fmtDate(i.due_on)}</td>
                <td className="text-right">{fmtMoney(i.amount, i.currency)}</td><td className="text-right">{fmtMoney(i.paid, i.currency)}</td><td className="text-right font-semibold">{fmtMoney(i.outstanding, i.currency)}</td>
                <td>{i.cancelled ? <Badge>Anulada</Badge> : Number(i.outstanding) <= 0 ? <Badge color="green">Pagada</Badge> : i.days_overdue > 0 ? <Badge color="red">Vencida {i.days_overdue} d</Badge> : <Badge color="amber">Pendiente</Badge>}</td></tr>))}</tbody></table></div>
            : <Empty>Sin cuotas.</Empty>}
        </Card>
        <Card title="Pagos y reembolsos">
          {pays?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Recibo</th><th>Fecha</th><th>Medio</th><th className="text-right">Monto</th><th>Estado</th>{can(ctx, 'finance.void') && <th>Acciones (requiere MFA)</th>}</tr></thead>
            <tbody>{pays.map((p: any) => (
              <tr key={p.id}><td className="font-mono text-xs"><Link className="link" href={`/app/finanzas/boleta/${p.id}`} data-testid="ver-boleta">🧾 {p.kind === 'refund' ? 'R-' : ''}{p.receipt_number}</Link></td><td>{fmtDateTime(p.paid_at)}</td><td>{PAY_METHODS.find((m) => m.value === p.method)?.label}</td>
                <td className="text-right font-semibold">{p.kind === 'refund' ? '−' : ''}{fmtMoney(p.amount, p.currency)}</td>
                <td><StatusBadge status={p.status} />{p.void_reason && <p className="text-xs text-slate-500">{p.void_reason}</p>}</td>
                {can(ctx, 'finance.void') && <td>{p.status === 'confirmed' && p.kind === 'payment' && (
                  <div className="flex flex-col gap-2">
                    <ActionForm action={voidPayment} inline submitLabel="Anular" submitClass="btn-secondary btn-sm" confirm="La anulación genera un reverso y no puede deshacerse. ¿Continuar?">
                      <input type="hidden" name="id" value={p.id} /><input name="reason" required placeholder="Motivo de anulación" className="input w-44 py-1 text-xs" />
                    </ActionForm>
                    <ActionForm action={refundPayment} inline submitLabel="Reembolsar" submitClass="btn-secondary btn-sm" confirm="¿Registrar el reembolso?">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="amount" type="number" step="0.01" min="0.01" required placeholder="Monto" className="input w-24 py-1 text-xs" />
                      <select name="method" className="input w-28 py-1 text-xs">{PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
                      <input name="reason" required placeholder="Motivo" className="input w-32 py-1 text-xs" />
                    </ActionForm>
                  </div>)}</td>}
              </tr>))}</tbody></table></div> : <Empty>Sin pagos.</Empty>}
        </Card>
      </div>
    </>
  );
}
