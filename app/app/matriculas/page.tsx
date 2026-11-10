import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { periodOptions, programOptions, studentOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { enroll, changeStatus } from './actions';

export const metadata = { title: 'Matrículas' };

export default async function Page({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'enrollments.view');
  const orgId = requireOrg(ctx);
  const [students, programs, periods, { data: org }, { data: benefits }] = await Promise.all([
    studentOptions(ctx), programOptions(ctx), periodOptions(ctx),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
    ctx.supabase.from('benefits').select('id, name').eq('organization_id', orgId).eq('status', 'active'),
  ]);
  const periodo = (await searchParams).periodo ?? periods[0]?.value;
  const { data: rows } = periodo ? await ctx.supabase.from('enrollments')
    .select('id, status, enrolled_at, students(id, first_names, last_names, student_code), programs(code, name), campuses(name)')
    .eq('organization_id', orgId).eq('period_id', periodo).order('enrolled_at', { ascending: false }).limit(500) : { data: [] as any[] };

  return (
    <>
      <PageHeader title="Matrículas" subtitle="Matrícula en programas con compromiso económico" />
      {can(ctx, 'enrollments.create') && (
        <Card title="Nueva matrícula" className="mb-6">
          <ActionForm action={enroll} submitLabel="Matricular">
            <Grid cols={3}>
              <SelectField label="Estudiante" name="student_id" required options={students} />
              <SelectField label="Programa" name="program_id" required options={programs} />
              <SelectField label="Periodo" name="period_id" required options={periods} defaultValue={periodo} />
            </Grid>
            {can(ctx, 'finance.create') && (
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-xs font-bold uppercase text-slate-500">Arancel (opcional)</legend>
                <Grid cols={4}>
                  <Field label="Monto total" name="amount" type="number" min={0} step="0.01" />
                  <Field label="Moneda" name="currency" defaultValue={org?.base_currency ?? 'CLP'} />
                  <Field label="N° de cuotas" name="installments" type="number" min={1} max={36} defaultValue={10} />
                  <Field label="Primer vencimiento" name="first_due" type="date" />
                  <SelectField label="Beca / descuento" name="benefit_id" options={(benefits ?? []).map((b: any) => ({ value: b.id, label: b.name }))} placeholder="Ninguno" />
                </Grid>
              </fieldset>
            )}
          </ActionForm>
        </Card>
      )}
      <Card>
        <form className="mb-4 flex gap-2">
          <select name="periodo" defaultValue={periodo} className="input max-w-xs">{periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          <button className="btn-secondary">Ver</button>
        </form>
        {rows?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Estudiante</th><th>Programa</th><th>Sede</th><th>Fecha</th><th>Estado</th>{can(ctx, 'enrollments.approve') && <th>Cambiar estado</th>}</tr></thead>
          <tbody>{rows.map((e: any) => (
            <tr key={e.id}>
              <td><Link className="link" href={`/app/estudiantes/${e.students?.id}`}>{e.students?.last_names}, {e.students?.first_names}</Link></td>
              <td>{e.programs?.code} · {e.programs?.name}<Link className="link ml-2 text-xs" href={`/app/matriculas/${e.id}`} data-testid="editar-matricula">✏ Editar</Link></td><td>{e.campuses?.name}</td><td>{fmtDate(e.enrolled_at)}</td><td><StatusBadge status={e.status} /></td>
              {can(ctx, 'enrollments.approve') && <td>
                <ActionForm action={changeStatus} inline submitLabel="Aplicar" submitClass="btn-secondary btn-sm" confirm="¿Confirmar el cambio de estado de la matrícula?">
                  <input type="hidden" name="id" value={e.id} />
                  <select name="status" className="input py-1 text-xs" defaultValue={e.status}>
                    {['active', 'suspended', 'withdrawn', 'completed', 'cancelled'].map((x) => <option key={x} value={x}>{x === 'active' ? 'Activa' : x === 'suspended' ? 'Suspendida' : x === 'withdrawn' ? 'Retiro' : x === 'completed' ? 'Egreso' : 'Anulada'}</option>)}
                  </select>
                  <input name="reason" required placeholder="Motivo" className="input w-40 py-1 text-xs" />
                </ActionForm></td>}
            </tr>))}</tbody></table></div> : <Empty>No hay matrículas en este periodo.</Empty>}
      </Card>
    </>
  );
}
