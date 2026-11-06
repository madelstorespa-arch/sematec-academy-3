import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions, courseOptions, gradeScaleOptions, periodOptions, teacherOptions } from '@/lib/options';
import { WEEKDAYS, fmtSlot } from '@/lib/format';
import { createSection } from './actions';

export const metadata = { title: 'Secciones' };

export default async function Page({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'sections.view', 'grades.view');
  const orgId = requireOrg(ctx);
  const [periods, campuses, courses, teachers, scales] = await Promise.all([periodOptions(ctx), campusOptions(ctx), courseOptions(ctx), teacherOptions(ctx), gradeScaleOptions(ctx)]);
  const periodo = (await searchParams).periodo ?? periods[0]?.value;
  const { data: sections } = periodo ? await ctx.supabase.from('sections')
    .select('id, code, capacity, grades_closed_at, courses(code, name), teachers(first_names, last_names), campuses(name), section_schedules(weekday, time_slot), section_enrollments(count)')
    .eq('organization_id', orgId).eq('period_id', periodo).eq('section_enrollments.status', 'enrolled').order('code') : { data: [] as any[] };

  return (
    <>
      <PageHeader title="Secciones" subtitle="Cursos dictados por periodo: horarios, inscritos, asistencia y notas" />
      {can(ctx, 'sections.create') && (
        <details className="card mb-6">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nueva sección</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createSection} submitLabel="Crear sección">
              <Grid cols={3}>
                <SelectField label="Asignatura" name="course_id" required options={courses} />
                <SelectField label="Periodo" name="period_id" required options={periods} defaultValue={periodo} />
                <SelectField label="Sede" name="campus_id" required options={campuses} />
                <Field label="Código de sección" name="code" required placeholder="S1" />
                <SelectField label="Profesor" name="teacher_id" options={teachers} placeholder="Sin asignar" />
                <SelectField label="Escala de notas" name="grade_scale_id" required options={scales} />
                <Field label="Cupos" name="capacity" type="number" min={1} required defaultValue={30} />
                <Field label="Asistencia mínima %" name="min_attendance_pct" type="number" min={0} max={100} defaultValue={75} />
                <SelectField label="Modalidad" name="modality" required defaultValue="in_person" options={[{ value: 'in_person', label: 'Presencial' }, { value: 'online', label: 'En línea' }, { value: 'hybrid', label: 'Híbrida' }]} />
              </Grid>
            </ActionForm>
          </div>
        </details>
      )}
      <Card>
        <form className="mb-4 flex gap-2">
          <select name="periodo" defaultValue={periodo} className="input max-w-xs">{periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          <button className="btn-secondary">Ver</button>
        </form>
        {sections?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Asignatura</th><th>Sección</th><th>Profesor</th><th>Sede</th><th>Horario</th><th>Inscritos</th><th>Acta</th></tr></thead>
          <tbody>{sections.map((s: any) => (
            <tr key={s.id}>
              <td><Link className="link" href={`/app/secciones/${s.id}`}>{s.courses?.code} · {s.courses?.name}</Link></td>
              <td>{s.code}</td><td>{s.teachers ? `${s.teachers.first_names} ${s.teachers.last_names}` : '—'}</td><td>{s.campuses?.name}</td>
              <td className="text-xs">{s.section_schedules?.map((h: any) => `${WEEKDAYS[h.weekday].slice(0, 3)} ${fmtSlot(h.time_slot)}`).join(' · ') || '—'}</td>
              <td>{s.section_enrollments?.[0]?.count ?? 0} / {s.capacity}</td>
              <td>{s.grades_closed_at ? 'Cerrada' : 'Abierta'}</td>
            </tr>))}</tbody></table></div> : <Empty>No hay secciones en este periodo.</Empty>}
      </Card>
    </>
  );
}
