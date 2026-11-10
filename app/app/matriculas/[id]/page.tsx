import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { campusOptions, periodOptions, programOptions } from '@/lib/options';
import { fmtDate, fmtMoney } from '@/lib/format';
import { DOC_TYPES } from '@/lib/identity';
import { changeStatus, enrollmentCharge, enrollmentSection, updateEnrollment, updateEnrollmentDocument } from '../actions';

export const metadata = { title: 'Editar matrícula' };
const STATUS = [['active', 'Activa'], ['suspended', 'Suspendida'], ['withdrawn', 'Retiro'], ['completed', 'Egreso'], ['cancelled', 'Anulada']];
const CONCEPTS = [['tuition', 'Arancel'], ['enrollment_fee', 'Matrícula'], ['exam_fee', 'Derecho de examen'], ['certificate_fee', 'Certificado'], ['other', 'Otro']];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  requirePerm(ctx, 'enrollments.view');
  const orgId = requireOrg(ctx);
  const { data: e } = await ctx.supabase.from('enrollments')
    .select('*, students(id, first_names, last_names, student_code, id_document_type, id_document_number, email), programs(id, code, name), academic_periods(name)')
    .eq('id', id).eq('organization_id', orgId).maybeSingle();
  if (!e) notFound();
  const st = e.students as any;
  const [programs, periods, campuses, { data: curricula }, { data: secs }, { data: openSecs }, { data: charges }, { data: org }, { data: benefits }] = await Promise.all([
    programOptions(ctx), periodOptions(ctx), campusOptions(ctx),
    ctx.supabase.from('curricula').select('id, version, status, programs(name)').eq('organization_id', orgId).eq('program_id', e.program_id),
    ctx.supabase.from('section_enrollments').select('id, status, enrolled_at, sections(id, code, courses(name, code))').eq('enrollment_id', id).order('enrolled_at'),
    ctx.supabase.from('sections').select('id, code, courses(name, code)').eq('organization_id', orgId).eq('period_id', e.period_id).eq('status', 'active').order('code').limit(300),
    ctx.supabase.from('charges').select('id, concept, description, net_amount, currency, status, created_at').eq('enrollment_id', id).order('created_at'),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
    ctx.supabase.from('benefits').select('id, name').eq('organization_id', orgId).eq('status', 'active'),
  ]);
  const canEdit = can(ctx, 'enrollments.edit') || can(ctx, 'enrollments.create') || can(ctx, 'enrollments.admin');
  const taken = new Set((secs ?? []).filter((s: any) => s.status !== 'dropped').map((s: any) => s.sections?.id));
  const notes = (e.financial_terms as any)?.notes ?? '';

  return (
    <>
      <PageHeader title={`Matrícula · ${st?.last_names}, ${st?.first_names}`}
        subtitle={`${(e.programs as any)?.name} · ${(e.academic_periods as any)?.name ?? ''} · matriculado el ${fmtDate(e.enrolled_at)}`}
        actions={<>
          {ctx.isOwner && <Link className="btn-secondary" href={`/app/historial/enrollments/${id}`}>🕘 Historial de cambios</Link>}
          <Link className="btn-secondary" href="/app/matriculas">← Volver</Link>
        </>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="✏ Datos de la matrícula">
          {canEdit ? (
            <ActionForm action={updateEnrollment} submitLabel="Guardar cambios" resetOnSuccess={false}>
              <input type="hidden" name="id" value={id} />
              <Grid cols={2}>
                <SelectField label="Programa / carrera / curso" name="program_id" required options={programs} defaultValue={e.program_id} />
                <SelectField label="Periodo" name="period_id" required options={periods} defaultValue={e.period_id} />
                <SelectField label="Sede" name="campus_id" options={campuses} defaultValue={e.campus_id} placeholder="— Sin cambio —" />
                <SelectField label="Malla" name="curriculum_id" options={(curricula ?? []).map((c: any) => ({ value: c.id, label: `Versión ${c.version}${c.status === 'active' ? ' (vigente)' : ''}` }))}
                  defaultValue={e.curriculum_id} placeholder="Automática (la vigente)" />
              </Grid>
              <TextArea label="Observaciones" name="notes" defaultValue={notes} placeholder="Acuerdos, convenios, condiciones especiales…" />
              <p className="text-xs text-slate-500">Si cambia el programa, la malla vigente del nuevo programa se asigna automáticamente. Cada cambio queda en el historial y se puede deshacer.</p>
            </ActionForm>
          ) : <p className="text-sm text-slate-600">Programa: {(e.programs as any)?.name}. No tiene permiso para editar matrículas.</p>}
        </Card>

        <Card title="Estado">
          <p className="mb-3 text-sm">Estado actual: <StatusBadge status={e.status} />{e.status_reason && <span className="ml-2 text-slate-500">({e.status_reason})</span>}</p>
          {can(ctx, 'enrollments.approve') && (
            <ActionForm action={changeStatus} submitLabel="Cambiar estado" confirm="¿Confirmar el cambio de estado de la matrícula?">
              <input type="hidden" name="id" value={id} />
              <Grid cols={2}>
                <SelectField label="Nuevo estado" name="status" required options={STATUS.map(([value, label]) => ({ value, label }))} defaultValue={e.status} />
                <Field label="Motivo" name="reason" required placeholder="Ej.: retiro voluntario" />
              </Grid>
            </ActionForm>)}
        </Card>

        <Card title="🪪 Identificación del estudiante">
          <p className="mb-3 text-sm text-slate-600">{st?.student_code} · {st?.email ?? 'sin correo'}</p>
          {can(ctx, 'students.edit') ? (
            <ActionForm action={updateEnrollmentDocument} submitLabel="Guardar documento" resetOnSuccess={false}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="student_id" value={st?.id} />
              <Grid cols={2}>
                <SelectField label="Documento" name="id_document_type" required defaultValue={st?.id_document_type ?? 'RUN'} options={DOC_TYPES.map(([value, label]) => ({ value, label }))} />
                <Field label="N° (RUT, pasaporte…)" name="id_document_number" required defaultValue={st?.id_document_number} placeholder="12.345.678-5" />
              </Grid>
            </ActionForm>
          ) : <p className="text-sm">{st?.id_document_number ?? 'Sin documento registrado'}</p>}
          <p className="mt-2 text-xs"><Link className="link" href={`/app/estudiantes/${st?.id}`}>Ver o editar la ficha completa del estudiante →</Link></p>
        </Card>

        <Card title="📝 Secciones / asignaturas inscritas">
          {secs?.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {secs.map((s: any) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link className="link" href={`/app/secciones/${s.sections?.id}`}>{s.sections?.courses?.name} · {s.sections?.code}</Link> <StatusBadge status={s.status} /></span>
                  {canEdit && s.status === 'enrolled' && (
                    <ActionForm action={enrollmentSection} inline submitLabel="Dar de baja" submitClass="btn-secondary btn-sm" confirm="¿Dar de baja esta asignatura?">
                      <input type="hidden" name="id" value={id} /><input type="hidden" name="drop" value={s.id} />
                    </ActionForm>)}
                </li>))}
            </ul>) : <Empty>Sin secciones inscritas.</Empty>}
          {canEdit && (
            <ActionForm action={enrollmentSection} submitLabel="Inscribir en la sección" className="mt-4">
              <input type="hidden" name="id" value={id} /><input type="hidden" name="student_id" value={st?.id} />
              <SelectField label="Agregar sección del periodo" name="section_id" required
                options={(openSecs ?? []).filter((s: any) => !taken.has(s.id)).map((s: any) => ({ value: s.id, label: `${s.courses?.name} · ${s.code}` }))} />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="override" /> Omitir requisitos previos (autorización académica)</label>
            </ActionForm>)}
        </Card>

        <Card title="💳 Aranceles de esta matrícula" className="lg:col-span-2">
          {charges?.length ? <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th className="text-right">Monto</th><th>Estado</th></tr></thead>
            <tbody>{charges.map((c: any) => (
              <tr key={c.id}><td>{fmtDate(c.created_at)}</td><td>{CONCEPTS.find(([k]) => k === c.concept)?.[1] ?? c.concept}{c.description ? ` · ${c.description}` : ''}</td>
                <td className="text-right">{fmtMoney(c.net_amount, c.currency)}</td><td><StatusBadge status={c.status} /></td></tr>))}</tbody></table></div>
            : <Empty>Esta matrícula no tiene aranceles.</Empty>}
          <p className="mt-2 text-xs"><Link className="link" href={`/app/finanzas/cuenta/${st?.id}`}>Ver estado de cuenta, pagos y boletas →</Link></p>
          {can(ctx, 'finance.create') && (
            <ActionForm action={enrollmentCharge} submitLabel="Agregar arancel" className="mt-4">
              <input type="hidden" name="id" value={id} /><input type="hidden" name="student_id" value={st?.id} />
              <Grid cols={4}>
                <SelectField label="Concepto" name="concept" required options={CONCEPTS.map(([value, label]) => ({ value, label }))} />
                <Field label="Monto total" name="amount" type="number" min={1} step="0.01" required />
                <Field label="Moneda" name="currency" required defaultValue={org?.base_currency ?? 'CLP'} />
                <Field label="N° de cuotas" name="installments" type="number" min={1} max={36} defaultValue={1} />
                <Field label="Primer vencimiento" name="first_due" type="date" required />
                <SelectField label="Beca / descuento" name="benefit_id" options={(benefits ?? []).map((b: any) => ({ value: b.id, label: b.name }))} placeholder="Ninguno" />
                <Field label="Descripción" name="description" className="md:col-span-2" />
              </Grid>
            </ActionForm>)}
        </Card>
      </div>
    </>
  );
}
