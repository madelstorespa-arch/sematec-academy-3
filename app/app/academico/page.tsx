import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, StatusBadge, Empty, Tabs } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { courseOptions, gradeScaleOptions } from '@/lib/options';
import { fmtDate, label } from '@/lib/format';
import { OwnerActions } from '@/components/owner-actions';
import { updateProgram, updateCourse } from './actions';
import { addPrerequisite, createCourse, createGradeScale, createPeriod, createProgram, setPeriodStatus } from './actions';

export const metadata = { title: 'Oferta académica' };
const o = (pairs: string[][]) => pairs.map(([value, l]) => ({ value, label: l }));

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'academic.view');
  const orgId = requireOrg(ctx);
  const t = (await searchParams).t ?? 'programas';
  const sb = ctx.supabase;
  const tabs = [['programas', 'Carreras y programas'], ['cursos', 'Asignaturas'], ['periodos', 'Periodos'], ['escalas', 'Escalas de notas']]
    .map(([key, l]) => ({ key, label: l, href: `/app/academico?t=${key}` }));

  return (
    <>
      <PageHeader title="Oferta académica" subtitle="Carreras, programas, mallas, asignaturas y periodos" />
      <Tabs items={tabs} current={t} />
      {t === 'programas' && <Programs />}
      {t === 'cursos' && <Courses />}
      {t === 'periodos' && <Periods />}
      {t === 'escalas' && <Scales />}
    </>
  );

  async function Programs() {
    const [{ data }, scales] = await Promise.all([
      sb.from('programs').select('id, code, name, level, modality, duration_terms, status, curricula(id, version)').eq('organization_id', orgId).order('code'),
      gradeScaleOptions(ctx),
    ]);
    return (
      <div className="space-y-6">
        {can(ctx, 'academic.create') && (
          <Card title="➕ Nueva carrera o programa">
            {scales.length === 0 ? <Empty>Primero cree una escala de notas.</Empty> : (
              <ActionForm action={createProgram} submitLabel="Crear carrera">
                <Grid cols={3}>
                  <Field label="Código" name="code" required /><Field label="Nombre" name="name" required className="md:col-span-2" />
                  <SelectField label="Nivel" name="level" required options={o([['course', 'Curso'], ['technical', 'Técnico'], ['undergraduate', 'Pregrado'], ['postgraduate', 'Postgrado'], ['diploma', 'Diplomado'], ['continuing', 'Educación continua']])} />
                  <SelectField label="Modalidad" name="modality" required defaultValue="in_person" options={o([['in_person', 'Presencial'], ['online', 'En línea'], ['hybrid', 'Híbrida']])} />
                  <Field label="Duración (periodos)" name="duration_terms" type="number" min={1} max={20} required />
                  <SelectField label="Escala de notas" name="grade_scale_id" required options={scales} />
                  <Field label="Versión de malla" name="version" required defaultValue={String(new Date().getFullYear())} />
                  <Field label="Vigente desde" name="valid_from" type="date" required />
                  <Field label="Asistencia mínima %" name="min_attendance_pct" type="number" defaultValue={75} min={0} max={100} />
                </Grid>
              </ActionForm>
            )}
          </Card>
        )}
        <Card title="Carreras y programas">{data?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Código</th><th>Carrera o programa</th><th>Nivel</th><th>Duración</th><th>Mallas</th><th>Estado</th>{(can(ctx, 'academic.edit') || ctx.isOwner) && <th></th>}</tr></thead>
          <tbody>{data.map((p: any) => <tr key={p.id}><td className="font-mono text-xs">{p.code}</td><td>{p.name}</td><td>{label(p.level)}</td><td>{p.duration_terms}</td>
            <td><Link className="link" href={`/app/academico/programas/${p.id}`}>{p.curricula?.map((c: any) => c.version).join(', ') || 'Ver'}</Link></td><td><StatusBadge status={p.status} /></td>
            {(can(ctx, 'academic.edit') || ctx.isOwner) && <td className="space-y-1">
              {can(ctx, 'academic.edit') && <details><summary className="cursor-pointer text-xs font-semibold text-brand-700">✏️ Editar</summary>
                <div className="mt-2 w-72"><ActionForm action={updateProgram} submitLabel="Guardar" resetOnSuccess={false}>
                  <input type="hidden" name="id" value={p.id} />
                  <Field label="Nombre" name="name" required defaultValue={p.name} />
                  <SelectField label="Modalidad" name="modality" required defaultValue={p.modality} options={o([['in_person', 'Presencial'], ['online', 'En línea'], ['hybrid', 'Híbrida']])} />
                  <Field label="Duración (periodos)" name="duration_terms" type="number" min={1} max={20} required defaultValue={p.duration_terms} />
                </ActionForm></div></details>}
              {ctx.isOwner && <OwnerActions table="programs" id={p.id} active={p.status === 'active'} path="/app/academico" name={`la carrera ${p.name}`} />}
            </td>}</tr>)}</tbody></table></div>
          : <Empty>Aún no hay carreras. Cree la primera arriba.</Empty>}</Card>
      </div>
    );
  }

  async function Courses() {
    const [{ data }, courses] = await Promise.all([
      sb.from('courses').select('id, code, name, credits, weekly_hours, status, course_prerequisites!course_prerequisites_course_id_fkey(prerequisite:courses!course_prerequisites_prerequisite_id_fkey(code))').eq('organization_id', orgId).order('code'),
      courseOptions(ctx),
    ]);
    return (
      <div className="space-y-6">
        {can(ctx, 'academic.create') && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Nueva asignatura">
              <ActionForm action={createCourse} submitLabel="Crear asignatura">
                <Grid><Field label="Código" name="code" required /><Field label="Nombre" name="name" required />
                  <Field label="Créditos" name="credits" type="number" step="0.5" required /><Field label="Horas semanales" name="weekly_hours" type="number" step="0.5" required /></Grid>
              </ActionForm>
            </Card>
            <Card title="Agregar prerrequisito">
              <ActionForm action={addPrerequisite} submitLabel="Agregar">
                <SelectField label="Asignatura" name="course_id" required options={courses} />
                <SelectField label="Requiere aprobar" name="prerequisite_id" required options={courses} />
              </ActionForm>
            </Card>
          </div>
        )}
        <Card>{data?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Código</th><th>Asignatura</th><th>Créditos</th><th>Hrs/sem</th><th>Prerrequisitos</th><th>Estado</th>{(can(ctx, 'academic.edit') || ctx.isOwner) && <th></th>}</tr></thead>
          <tbody>{data.map((c: any) => <tr key={c.id}><td className="font-mono text-xs">{c.code}</td><td>{c.name}</td><td>{c.credits}</td><td>{c.weekly_hours}</td>
            <td>{c.course_prerequisites?.map((p: any) => p.prerequisite?.code).join(', ') || '—'}</td><td><StatusBadge status={c.status} /></td>
            {(can(ctx, 'academic.edit') || ctx.isOwner) && <td className="space-y-1">
              {can(ctx, 'academic.edit') && <details><summary className="cursor-pointer text-xs font-semibold text-brand-700">✏️ Editar</summary>
                <div className="mt-2 w-64"><ActionForm action={updateCourse} submitLabel="Guardar" resetOnSuccess={false}>
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Nombre" name="name" required defaultValue={c.name} />
                  <Field label="Créditos" name="credits" type="number" step="0.5" required defaultValue={c.credits} />
                  <Field label="Horas semanales" name="weekly_hours" type="number" step="0.5" required defaultValue={c.weekly_hours} />
                </ActionForm></div></details>}
              {ctx.isOwner && <OwnerActions table="courses" id={c.id} active={c.status === 'active'} path="/app/academico?t=cursos" name={`la asignatura ${c.name}`} />}
            </td>}</tr>)}</tbody></table></div> : <Empty>Sin asignaturas.</Empty>}</Card>
      </div>
    );
  }

  async function Periods() {
    const { data } = await sb.from('academic_periods').select('*').eq('organization_id', orgId).order('starts_on', { ascending: false });
    const statusOpts = o([['planned', 'Planificado'], ['open', 'Abierto'], ['closed', 'Cerrado']]);
    return (
      <div className="space-y-6">
        {can(ctx, 'academic.create') && (
          <Card title="Nuevo periodo">
            <ActionForm action={createPeriod} submitLabel="Crear periodo">
              <Grid cols={4}>
                <Field label="Código" name="code" required placeholder="2027-1" /><Field label="Nombre" name="name" required className="md:col-span-2" />
                <SelectField label="Estado" name="status" required defaultValue="planned" options={statusOpts} />
                <Field label="Inicio de clases" name="starts_on" type="date" required /><Field label="Término" name="ends_on" type="date" required />
                <Field label="Abre inscripción" name="enrollment_opens_on" type="date" /><Field label="Cierra inscripción" name="enrollment_closes_on" type="date" />
              </Grid>
            </ActionForm>
          </Card>
        )}
        <Card>{data?.length ? <table className="table"><thead><tr><th>Código</th><th>Nombre</th><th>Clases</th><th>Inscripción</th><th>Estado</th>{ctx.isOwner && <th></th>}</tr></thead>
          <tbody>{data.map((p: any) => <tr key={p.id}><td className="font-mono text-xs">{p.code}</td><td>{p.name}</td><td>{fmtDate(p.starts_on)} – {fmtDate(p.ends_on)}</td>
            <td>{fmtDate(p.enrollment_opens_on)} – {fmtDate(p.enrollment_closes_on)}</td>
            <td>{can(ctx, 'academic.edit') ? (
              <ActionForm action={setPeriodStatus} inline submitLabel="✓" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                <input type="hidden" name="id" value={p.id} />
                <select name="status" defaultValue={p.status} className="input py-1 text-xs">{statusOpts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              </ActionForm>) : <StatusBadge status={p.status} />}</td>
            {ctx.isOwner && <td><OwnerActions table="academic_periods" id={p.id} path="/app/academico?t=periodos" name={`el periodo ${p.code}`} /></td>}</tr>)}</tbody></table> : <Empty>Sin periodos.</Empty>}</Card>
      </div>
    );
  }

  async function Scales() {
    const { data } = await sb.from('grade_scales').select('*').eq('organization_id', orgId).order('name');
    return (
      <div className="space-y-6">
        {can(ctx, 'academic.admin') && (
          <Card title="Nueva escala de calificación">
            <ActionForm action={createGradeScale} submitLabel="Crear escala">
              <Grid cols={4}>
                <Field label="Nombre" name="name" required placeholder="Chile 1.0 – 7.0" className="md:col-span-4" />
                <Field label="Nota mínima" name="min_grade" type="number" step="0.1" required defaultValue={1} />
                <Field label="Nota máxima" name="max_grade" type="number" step="0.1" required defaultValue={7} />
                <Field label="Nota de aprobación" name="passing_grade" type="number" step="0.1" required defaultValue={4} />
                <Field label="Decimales" name="decimals" type="number" min={0} max={2} defaultValue={1} />
              </Grid>
            </ActionForm>
          </Card>
        )}
        <Card>{data?.length ? <table className="table"><thead><tr><th>Escala</th><th>Rango</th><th>Aprobación</th><th>Decimales</th></tr></thead>
          <tbody>{data.map((s: any) => <tr key={s.id}><td>{s.name}</td><td>{s.min_grade} – {s.max_grade}</td><td>{s.passing_grade}</td><td>{s.decimals}</td></tr>)}</tbody></table> : <Empty>Sin escalas.</Empty>}</Card>
      </div>
    );
  }
}
