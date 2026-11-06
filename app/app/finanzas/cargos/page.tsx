import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { studentOptions } from '@/lib/options';
import { fmtDate, fmtMoney } from '@/lib/format';
import { FinanceTabs } from '../tabs';
import { createCharge, cancelCharge } from '../actions';

export const metadata = { title: 'Cargos' };
const CONCEPTS = [['tuition', 'Arancel'], ['enrollment_fee', 'Matrícula'], ['exam_fee', 'Derecho de examen'], ['certificate_fee', 'Certificado'], ['other', 'Otro']];

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'finance.view');
  const orgId = requireOrg(ctx);
  const [students, { data: org }, { data: benefits }, { data: charges }] = await Promise.all([
    studentOptions(ctx),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
    ctx.supabase.from('benefits').select('id, name').eq('organization_id', orgId).eq('status', 'active'),
    ctx.supabase.from('charges').select('id, concept, description, gross_amount, discount_amount, net_amount, currency, status, created_at, students(id, first_names, last_names), installments(count)')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200),
  ]);
  return (
    <>
      <PageHeader title="Finanzas" subtitle="Cargos, aranceles y generación de cuotas" />
      <FinanceTabs current="cargos" />
      {can(ctx, 'finance.create') && (
        <Card title="Nuevo cargo" className="mb-6">
          <ActionForm action={createCharge} submitLabel="Generar cargo y cuotas">
            <Grid cols={4}>
              <SelectField label="Estudiante" name="student_id" required options={students} className="md:col-span-2" />
              <SelectField label="Concepto" name="concept" required options={CONCEPTS.map(([value, label]) => ({ value, label }))} />
              <Field label="Descripción" name="description" />
              <Field label="Monto bruto" name="amount" type="number" step="0.01" min={0.01} required />
              <Field label="Moneda" name="currency" required defaultValue={org?.base_currency ?? 'CLP'} />
              <Field label="N° de cuotas" name="installments" type="number" min={1} max={36} defaultValue={1} required />
              <Field label="Primer vencimiento" name="first_due" type="date" required />
              <SelectField label="Beca / descuento" name="benefit_id" options={(benefits ?? []).map((b: any) => ({ value: b.id, label: b.name }))} placeholder="Ninguno" />
            </Grid>
          </ActionForm>
        </Card>
      )}
      <Card title="Cargos recientes">
        {charges?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Fecha</th><th>Estudiante</th><th>Concepto</th><th className="text-right">Bruto</th><th className="text-right">Descuento</th><th className="text-right">Neto</th><th>Cuotas</th><th>Estado</th><th></th></tr></thead>
          <tbody>{charges.map((c: any) => (
            <tr key={c.id}><td>{fmtDate(c.created_at)}</td><td><Link className="link" href={`/app/finanzas/cuenta/${c.students?.id}`}>{c.students?.last_names}, {c.students?.first_names}</Link></td>
              <td>{CONCEPTS.find(([k]) => k === c.concept)?.[1] ?? c.concept}{c.description ? ` · ${c.description}` : ''}</td>
              <td className="text-right">{fmtMoney(c.gross_amount, c.currency)}</td><td className="text-right">{fmtMoney(c.discount_amount, c.currency)}</td>
              <td className="text-right font-semibold">{fmtMoney(c.net_amount, c.currency)}</td><td>{c.installments?.[0]?.count}</td><td><StatusBadge status={c.status} /></td>
              <td>{can(ctx, 'finance.void') && c.status === 'pending' && (
                <ActionForm action={cancelCharge} inline submitLabel="Anular" submitClass="btn-secondary btn-sm" confirm="¿Anular este cargo?">
                  <input type="hidden" name="id" value={c.id} /><input name="reason" required placeholder="Motivo" className="input w-32 py-1 text-xs" />
                </ActionForm>)}</td></tr>))}</tbody></table></div> : <Empty>Sin cargos.</Empty>}
      </Card>
    </>
  );
}
