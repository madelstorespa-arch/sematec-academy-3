import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Tabs, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { roomOptions, teacherOptions } from '@/lib/options';
import { WEEKDAYS, fmtDateTime, fmtNum, fullName, label, tzOffset, fmtSlot } from '@/lib/format';
import {
  addSchedule, removeSchedule, registerStudent, dropStudent, createClassSession, saveAttendance,
  createAssessment, togglePublish, saveGrades, closeActa, amendGrade, updateSection,
} from '../actions';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; clase?: string }> }) {
  const { id } = await params;
  const { t = 'resumen', clase } = await searchParams;
  const ctx = await getContext();
  const sb = ctx.supabase;
  const { data: s } = await sb.from('sections')
    .select('*, courses(code, name), academic_periods(id, code, name), campuses(name, timezone), teachers(id, first_names, last_names), grade_scales(*)')
    .eq('id', id).maybeSingle();
  if (!s) notFound();
  const isTeacher = !!ctx.teacherId && s.teacher_id === ctx.teacherId;
  if (!isTeacher && !can(ctx, 'sections.view') && !can(ctx, 'grades.view')) notFound();
  const closed = !!s.grades_closed_at;
  const tz: string = s.campuses?.timezone ?? 'America/Santiago';

  const { data: roster } = await sb.from('section_enrollments')
    .select('id, status, student_id, students(id, student_code, first_names, last_names)').eq('section_id', id).neq('status', 'dropped');
  const students = (roster ?? []).map((r: any) => ({ ...r.students, enr: r.id, enrStatus: r.status }))
    .sort((a: any, b: any) => a.last_names.localeCompare(b.last_names));

  const tabs = [['resumen', 'Resumen e inscritos'], ['asistencia', 'Libro de clases y asistencia'], ['notas', 'Evaluaciones y notas']]
    .map(([key, l]) => ({ key, label: l, href: `/app/secciones/${id}?t=${key}` }));

  return (
    <>
      <PageHeader title={`${s.courses.code} · ${s.courses.name}`} subtitle={`Sección ${s.code} · ${s.academic_periods.name} · ${s.campuses.name} · Profesor: ${s.teachers ? fullName(s.teachers) : 'sin asignar'}`}
        actions={<>{closed ? <Badge color="gray">Acta cerrada</Badge> : <Badge color="green">Acta abierta</Badge>}<Link className="btn-secondary" href={isTeacher ? '/app/docencia' : '/app/secciones'}>Volver</Link></>} />
      <Tabs items={tabs} current={t} />
      {t === 'resumen' && <Resumen />}
      {t === 'asistencia' && <Asistencia />}
      {t === 'notas' && <Notas />}
    </>
  );

  async function Resumen() {
    const [{ data: sched }, rooms, teachers, { data: candidates }] = await Promise.all([
      sb.from('section_schedules').select('id, weekday, time_slot, rooms(code, name)').eq('section_id', id).order('weekday'),
      roomOptions(ctx), teacherOptions(ctx),
      can(ctx, 'enrollments.create')
        ? sb.from('enrollments').select('student_id, students(first_names, last_names, student_code)').eq('period_id', s.period_id).eq('status', 'active')
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const enrolledIds = new Set(students.map((x: any) => x.id));
    const options = (candidates ?? []).filter((c: any) => !enrolledIds.has(c.student_id))
      .map((c: any) => ({ value: c.student_id, label: `${c.students.last_names}, ${c.students.first_names} (${c.students.student_code})` }));
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Inscritos (${students.length} / ${s.capacity})`}>
          {students.length ? <table className="table"><thead><tr><th>Código</th><th>Estudiante</th><th>Estado</th><th></th></tr></thead>
            <tbody>{students.map((x: any) => <tr key={x.id}><td className="font-mono text-xs">{x.student_code}</td><td>{x.last_names}, {x.first_names}</td><td><StatusBadge status={x.enrStatus} /></td>
              <td className="text-right">{can(ctx, 'enrollments.edit') && !closed && (
                <ActionForm action={dropStudent} inline submitLabel="Dar de baja" submitClass="btn-secondary btn-sm" confirm={`¿Dar de baja a ${x.first_names} ${x.last_names}?`}>
                  <input type="hidden" name="id" value={x.enr} /><input type="hidden" name="section_id" value={id} />
                </ActionForm>)}</td></tr>)}</tbody></table> : <Empty>Sin estudiantes inscritos.</Empty>}
          {can(ctx, 'enrollments.create') && !closed && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <ActionForm action={registerStudent} inline submitLabel="Inscribir">
                <input type="hidden" name="section_id" value={id} />
                <SelectField label="Estudiante matriculado en el periodo" name="student_id" required options={options} className="min-w-72" />
                {can(ctx, 'enrollments.approve') && <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" name="override" /> Autorizar sin prerrequisitos</label>}
              </ActionForm>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Horario">
            {sched?.length ? <ul className="mb-4 divide-y divide-slate-100 text-sm">{sched.map((h: any) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span>{WEEKDAYS[h.weekday]} {fmtSlot(h.time_slot)} · {h.rooms ? `${h.rooms.code} ${h.rooms.name}` : 'Sin sala'}</span>
                {can(ctx, 'sections.edit') && <ActionForm action={removeSchedule} inline submitLabel="Quitar" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={h.id} /><input type="hidden" name="section_id" value={id} /></ActionForm>}
              </li>))}</ul> : <Empty>Sin horario asignado.</Empty>}
            {can(ctx, 'sections.create') && (
              <ActionForm action={addSchedule} inline submitLabel="Agregar bloque">
                <input type="hidden" name="section_id" value={id} />
                <SelectField label="Día" name="weekday" required options={WEEKDAYS.slice(1).map((d, i) => ({ value: String(i + 1), label: d }))} />
                <Field label="Desde" name="start" type="time" required /><Field label="Hasta" name="end" type="time" required />
                <SelectField label="Sala" name="room_id" options={rooms} placeholder="Sin sala" />
              </ActionForm>
            )}
          </Card>
          {can(ctx, 'sections.edit') && (
            <Card title="Datos de la sección">
              <ActionForm action={updateSection} submitLabel="Guardar" resetOnSuccess={false}>
                <input type="hidden" name="id" value={id} />
                <Grid cols={3}>
                  <SelectField label="Profesor" name="teacher_id" options={teachers} defaultValue={s.teacher_id} placeholder="Sin asignar" />
                  <Field label="Cupos" name="capacity" type="number" min={1} defaultValue={s.capacity} required />
                  <Field label="Asistencia mínima %" name="min_attendance_pct" type="number" min={0} max={100} defaultValue={s.min_attendance_pct} required />
                </Grid>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    );
  }

  async function Asistencia() {
    const { data: sessions } = await sb.from('class_sessions').select('id, starts_at, ends_at, topic, content_covered, attendance_records(student_id, status)')
      .eq('section_id', id).order('starts_at', { ascending: false });
    const canWrite = (isTeacher || can(ctx, 'attendance.create')) && !closed;
    const current = sessions?.find((x: any) => x.id === clase) ?? sessions?.[0];
    const statusOf = (stu: string) => current?.attendance_records?.find((a: any) => a.student_id === stu)?.status ?? 'present';
    const total = (sessions ?? []).length;
    const pct = (stu: string) => {
      let att = 0, den = 0;
      for (const ses of sessions ?? []) {
        const st = ses.attendance_records?.find((a: any) => a.student_id === stu)?.status;
        if (!st || st === 'excused') continue;
        den++; if (st === 'present' || st === 'late') att++;
      }
      return den ? Math.round((100 * att) / den) : null;
    };
    return (
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          {canWrite && (
            <Card title="Registrar clase">
              <ActionForm action={createClassSession} submitLabel="Registrar clase">
                <input type="hidden" name="section_id" value={id} /><input type="hidden" name="tz_offset" value={tzOffset(tz)} />
                <Field label="Fecha" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                <Grid><Field label="Inicio" name="start" type="time" required /><Field label="Término" name="end" type="time" required /></Grid>
                <Field label="Tema" name="topic" required />
                <TextArea label="Contenido tratado (avance curricular)" name="content_covered" />
              </ActionForm>
            </Card>
          )}
          <Card title={`Clases registradas (${total})`}>
            {sessions?.length ? <ul className="divide-y divide-slate-100 text-sm">{sessions.map((x: any) => (
              <li key={x.id} className="py-2"><Link className={x.id === current?.id ? 'font-bold text-brand-700' : 'link'} href={`/app/secciones/${id}?t=asistencia&clase=${x.id}`}>{fmtDateTime(x.starts_at, tz)}</Link>
                <p className="text-xs text-slate-500">{x.topic ?? 'Sin tema'} · {x.attendance_records?.length ?? 0} registros</p></li>))}</ul>
              : <Empty>Aún no hay clases registradas.</Empty>}
          </Card>
        </div>
        <Card title={current ? `Asistencia: ${fmtDateTime(current.starts_at, tz)} — ${current.topic ?? ''}` : 'Asistencia'} className="xl:col-span-2">
          {!current ? <Empty>Registre una clase para tomar asistencia.</Empty> : !students.length ? <Empty>Sin estudiantes inscritos.</Empty> : (
            <ActionForm action={saveAttendance} submitLabel="Guardar asistencia" resetOnSuccess={false} hideSubmit={!canWrite}>
              <input type="hidden" name="class_session_id" value={current.id} /><input type="hidden" name="section_id" value={id} />
              <table className="table"><thead><tr><th>Estudiante</th><th>Estado</th><th>% acumulado</th></tr></thead>
                <tbody>{students.map((x: any) => (
                  <tr key={x.id}><td>{x.last_names}, {x.first_names}</td>
                    <td><div className="flex flex-wrap gap-3 text-xs">{['present', 'late', 'absent', 'excused'].map((st) => (
                      <label key={st} className="flex items-center gap-1"><input type="radio" name={`att_${x.id}`} value={st} defaultChecked={statusOf(x.id) === st} disabled={!canWrite} />{label(st)}</label>))}</div></td>
                    <td className={(pct(x.id) ?? 100) < Number(s.min_attendance_pct) ? 'font-semibold text-red-600' : ''}>{pct(x.id) ?? '—'}{pct(x.id) != null && ' %'}</td></tr>))}</tbody></table>
            </ActionForm>
          )}
        </Card>
      </div>
    );
  }

  async function Notas() {
    const [{ data: assessments }, { data: grades }, { data: records }] = await Promise.all([
      sb.from('assessments').select('*').eq('section_id', id).order('created_at'),
      sb.from('grades').select('id, assessment_id, student_id, grade, assessments!inner(section_id)').eq('assessments.section_id', id),
      sb.from('academic_records').select('student_id, final_grade, attendance_pct, result').eq('section_id', id),
    ]);
    const gs = s.grade_scales;
    const canGrade = (isTeacher || can(ctx, 'grades.edit')) && !closed;
    const totalW = (assessments ?? []).reduce((a: number, x: any) => a + Number(x.weight_pct), 0);
    const g = (a: string, st: string) => grades?.find((x: any) => x.assessment_id === a && x.student_id === st);
    const avg = (st: string) => {
      let sum = 0, w = 0;
      for (const a of assessments ?? []) { const v = g(a.id, st); if (v) { sum += Number(v.grade) * Number(a.weight_pct); w += Number(a.weight_pct); } }
      return w ? sum / w : null;
    };
    const rec = (st: string) => records?.find((r: any) => r.student_id === st);
    return (
      <div className="space-y-6">
        <Card title={`Planilla de notas · escala ${gs.min_grade}–${gs.max_grade}, aprueba con ${gs.passing_grade} · ponderación total ${totalW} %`}>
          {!assessments?.length ? <Empty>Cree las evaluaciones de la sección.</Empty> : !students.length ? <Empty>Sin estudiantes inscritos.</Empty> : (
            <ActionForm action={saveGrades} submitLabel="Guardar notas" resetOnSuccess={false} hideSubmit={!canGrade}>
              <input type="hidden" name="section_id" value={id} />
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Estudiante</th>{assessments.map((a: any) => <th key={a.id} className="text-center">{a.name}<br /><span className="font-normal normal-case">{a.weight_pct} % {a.published ? '· visible' : '· oculta'}</span></th>)}
                  <th className="text-center">{closed ? 'Nota final' : 'Promedio parcial'}</th>{closed && <><th>Asist.</th><th>Resultado</th></>}</tr></thead>
                <tbody>{students.map((x: any) => (
                  <tr key={x.id}><td className="whitespace-nowrap">{x.last_names}, {x.first_names}</td>
                    {assessments.map((a: any) => (
                      <td key={a.id} className="text-center">
                        <input name={`g_${a.id}_${x.id}`} defaultValue={g(a.id, x.id)?.grade ?? ''} disabled={!canGrade} inputMode="decimal"
                          className="input w-20 text-center" aria-label={`Nota ${a.name} ${x.first_names}`} />
                      </td>))}
                    <td className="text-center font-bold">{closed ? fmtNum(rec(x.id)?.final_grade, gs.decimals) : avg(x.id) != null ? fmtNum(avg(x.id), gs.decimals) : '—'}</td>
                    {closed && <><td>{rec(x.id)?.attendance_pct != null ? `${fmtNum(rec(x.id)?.attendance_pct, 0)} %` : '—'}</td><td><StatusBadge status={rec(x.id)?.result} /></td></>}
                  </tr>))}</tbody></table></div>
              {!canGrade && <p className="text-xs text-slate-500">{closed ? 'El acta está cerrada. Las correcciones se hacen con «Rectificar nota».' : 'Solo lectura.'}</p>}
            </ActionForm>
          )}
        </Card>
        <div className="grid gap-6 xl:grid-cols-3">
          {canGrade && (
            <Card title="Nueva evaluación">
              <ActionForm action={createAssessment} submitLabel="Crear evaluación">
                <input type="hidden" name="section_id" value={id} />
                <Field label="Nombre" name="name" required placeholder="Prueba 1" />
                <Grid><Field label="Ponderación %" name="weight_pct" type="number" step="0.5" min={0.5} max={100} required /><Field label="Fecha" name="due_on" type="date" /></Grid>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="published" /> Visible para estudiantes</label>
              </ActionForm>
            </Card>
          )}
          {canGrade && !!assessments?.length && (
            <Card title="Visibilidad">
              <ul className="space-y-2 text-sm">{assessments.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between"><span>{a.name}</span>
                  <ActionForm action={togglePublish} inline submitLabel={a.published ? 'Ocultar' : 'Publicar'} submitClass="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="section_id" value={id} /><input type="hidden" name="published" value={String(!a.published)} />
                  </ActionForm></li>))}</ul>
            </Card>
          )}
          {!closed && (isTeacher || can(ctx, 'grades.approve')) && (
            <Card title="Cerrar acta">
              <p className="mb-3 text-sm text-slate-600">Calcula nota final y asistencia, determina aprobación y bloquea la planilla. Requiere que las ponderaciones sumen 100 % y que no falten notas.</p>
              <ActionForm action={closeActa} submitLabel="Cerrar acta" submitClass="btn-danger" confirm="Al cerrar el acta, las notas quedan bloqueadas. ¿Continuar?">
                <input type="hidden" name="section_id" value={id} />
              </ActionForm>
            </Card>
          )}
          {closed && can(ctx, 'grades.approve') && (
            <Card title="Rectificar nota (requiere MFA)">
              <ActionForm action={amendGrade} submitLabel="Rectificar">
                <input type="hidden" name="section_id" value={id} />
                <SelectField label="Nota" name="grade_id" required options={(grades ?? []).map((x: any) => {
                  const st = students.find((y: any) => y.id === x.student_id); const a = assessments?.find((y: any) => y.id === x.assessment_id);
                  return { value: x.id, label: `${st ? `${st.last_names}, ${st.first_names}` : '?'} · ${a?.name}: ${x.grade}` };
                })} />
                <Field label="Nueva nota" name="new_grade" type="number" step="0.1" required />
                <TextArea label="Motivo detallado" name="reason" required />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    );
  }
}
