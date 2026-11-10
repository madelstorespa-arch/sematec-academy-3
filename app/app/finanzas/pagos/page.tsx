import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { studentOptions } from '@/lib/options';
import { fmtDateTime, fmtMoney, PAY_METHODS } from '@/lib/format';
import { FinanceTabs } from '../tabs';
import { registerPayment } from '../actions';

export const metadata = { title: 'Pagos' };

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const [students, { data: org }, { data: payments }] = await Promise.all([
    studentOptions(ctx),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
    ctx.supabase.from('payments').select('id, kind, receipt_number, amount, currency, method, external_reference, paid_at, status, students(id, first_names, last_names)')
      .eq('organization_id', orgId).order('paid_at', { ascending: false }).limit(200),
  ]);
  return (
    <>
      <PageHeader title="Finanzas" subtitle="Registro de pagos y abonos" />
      <FinanceTabs current="pagos" />
      {can(ctx, 'finance.create') && (
        <Card title="Registrar pago" className="mb-6">
          <ActionForm action={registerPayment} submitLabel="Registrar pago">
            <Grid cols={4}>
              <SelectField label="Estudiante" name="student_id" required options={students} className="md:col-span-2" />
              <Field label="Monto" name="amount" type="number" step="0.01" min={0.01} required />
              <Field label="Moneda" name="currency" required defaultValue={org?.base_currency ?? 'CLP'} />
              <SelectField label="Medio de pago" name="method" required options={PAY_METHODS} />
              <Field label="Banco / proveedor" name="provider" />
              <Field label="N° de operación" name="external_reference" placeholder="Evita registrar dos veces" />
              <Field label="Observación" name="notes" />
            </Grid>
            <p className="text-xs text-slate-500">El pago se imputa automáticamente a las cuotas con vencimiento más antiguo. No se aceptan montos mayores a la deuda.</p>
          </ActionForm>
        </Card>
      )}
      <Card title="Últimos movimientos">
        {payments?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Recibo</th><th>Fecha</th><th>Estudiante</th><th>Tipo</th><th>Medio</th><th>Operación</th><th className="text-right">Monto</th><th>Estado</th></tr></thead>
          <tbody>{payments.map((p: any) => (
            <tr key={p.id}><td className="font-mono text-xs"><Link className="link" href={`/app/finanzas/boleta/${p.id}`} data-testid="ver-boleta">🧾 {p.kind === 'refund' ? 'R-' : ''}{p.receipt_number}</Link></td><td>{fmtDateTime(p.paid_at)}</td>
              <td><Link className="link" href={`/app/finanzas/cuenta/${p.students?.id}`}>{p.students?.last_names}, {p.students?.first_names}</Link></td>
              <td>{p.kind === 'refund' ? 'Reembolso' : 'Pago'}</td><td>{PAY_METHODS.find((m) => m.value === p.method)?.label}</td><td>{p.external_reference ?? '—'}</td>
              <td className={`text-right font-semibold ${p.kind === 'refund' ? 'text-red-600' : ''}`}>{p.kind === 'refund' ? '−' : ''}{fmtMoney(p.amount, p.currency)}</td>
              <td><StatusBadge status={p.status} /></td></tr>))}</tbody></table></div> : <Empty>Sin pagos registrados.</Empty>}
      </Card>
    </>
  );
}
