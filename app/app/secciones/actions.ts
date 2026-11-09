'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

const refresh = (id?: string | null) => { revalidatePath('/app/secciones', 'layout'); if (id) revalidatePath(`/app/secciones/${id}`); };

export async function createSection(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('sections').insert({
      organization_id: ctx.orgId, campus_id: reqStr(fd, 'campus_id', 'Sede'), course_id: reqStr(fd, 'course_id', 'Asignatura'),
      period_id: reqStr(fd, 'period_id', 'Periodo'), code: reqStr(fd, 'code', 'Código de sección').toUpperCase(),
      teacher_id: str(fd, 'teacher_id'), grade_scale_id: reqStr(fd, 'grade_scale_id', 'Escala'), capacity: num(fd, 'capacity'),
      min_attendance_pct: num(fd, 'min_attendance_pct') ?? 75, modality: reqStr(fd, 'modality', 'Modalidad'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Sección creada.');
  });
}

export async function updateSection(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error, count } = await ctx.supabase.from('sections').update({
      teacher_id: str(fd, 'teacher_id'), capacity: num(fd, 'capacity'), min_attendance_pct: num(fd, 'min_attendance_pct'),
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    refresh(id);
    return ok('Sección actualizada.');
  });
}

export async function addSchedule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'section_id', 'Sección');
    const start = reqStr(fd, 'start', 'Hora inicio'); const end = reqStr(fd, 'end', 'Hora término');
    if (end <= start) return fail('La hora de término debe ser posterior al inicio.');
    const { error } = await ctx.supabase.from('section_schedules').insert({
      organization_id: ctx.orgId, section_id: id, weekday: num(fd, 'weekday'), time_slot: `[${start},${end})`, room_id: str(fd, 'room_id'),
    });
    if (error) return fail(error);
    refresh(id);
    return ok('Bloque horario agregado.');
  });
}

export async function removeSchedule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('section_schedules').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    refresh(str(fd, 'section_id'));
    return ok('Bloque eliminado.');
  });
}

export async function registerStudent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = reqStr(fd, 'section_id', 'Sección');
    const { error } = await ctx.supabase.rpc('register_section', {
      p_student: reqStr(fd, 'student_id', 'Estudiante'), p_section: section, p_override_prerequisites: fd.get('override') === 'on',
    });
    if (error) return fail(error);
    refresh(section);
    return ok('Estudiante inscrito en la sección.');
  });
}

export async function dropStudent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('drop_section', { p_section_enrollment: reqStr(fd, 'id', 'id'), p_reason: str(fd, 'reason') ?? 'Baja de asignatura' });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    return ok('Inscripción dada de baja.');
  });
}

export async function createClassSession(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = reqStr(fd, 'section_id', 'Sección');
    const date = reqStr(fd, 'date', 'Fecha'); const tz = str(fd, 'tz_offset') ?? '-03:00';
    const { error } = await ctx.supabase.from('class_sessions').insert({
      organization_id: ctx.orgId, section_id: section,
      starts_at: `${date}T${reqStr(fd, 'start', 'Inicio')}:00${tz}`, ends_at: `${date}T${reqStr(fd, 'end', 'Término')}:00${tz}`,
      topic: str(fd, 'topic'), content_covered: str(fd, 'content_covered'),
    });
    if (error) return fail(error);
    refresh(section);
    return ok('Clase registrada en el libro de clases.');
  });
}

export async function saveAttendance(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const session = reqStr(fd, 'class_session_id', 'Clase');
    const rows = [...fd.entries()].filter(([k]) => k.startsWith('att_')).map(([k, v]) => ({
      organization_id: ctx.orgId, class_session_id: session, student_id: k.slice(4), status: String(v),
    }));
    if (!rows.length) return fail('No hay estudiantes para registrar.');
    const { error } = await ctx.supabase.from('attendance_records').upsert(rows, { onConflict: 'class_session_id,student_id' });
    if (error) return fail(error);
    await ctx.supabase.rpc('teacher_class_mark', { p_session: session, p_action: 'held' }); // la clase queda como dictada
    refresh(str(fd, 'section_id'));
    return ok(`Asistencia guardada (${rows.length} estudiantes).`);
  });
}

export async function createAssessment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = reqStr(fd, 'section_id', 'Sección');
    const { error } = await ctx.supabase.from('assessments').insert({
      organization_id: ctx.orgId, section_id: section, name: reqStr(fd, 'name', 'Nombre'), weight_pct: num(fd, 'weight_pct'),
      due_on: str(fd, 'due_on'), published: fd.get('published') === 'on',
    });
    if (error) return fail(error);
    refresh(section);
    return ok('Evaluación creada.');
  });
}

export async function togglePublish(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('assessments').update({ published: fd.get('published') === 'true' }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    refresh(str(fd, 'section_id'));
    return ok('Visibilidad actualizada.');
  });
}

export async function saveGrades(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const rows: { organization_id: string | null; assessment_id: string; student_id: string; grade: number }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('g_') || String(v).trim() === '') continue;
      const [, assessment_id, student_id] = k.split('_');
      const grade = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(grade)) return fail(`Nota inválida: «${v}»`);
      rows.push({ organization_id: ctx.orgId, assessment_id, student_id, grade });
    }
    if (!rows.length) return fail('No hay notas para guardar.');
    const { error } = await ctx.supabase.from('grades').upsert(rows, { onConflict: 'assessment_id,student_id' });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    return ok(`${rows.length} notas guardadas.`);
  });
}

export async function closeActa(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = reqStr(fd, 'section_id', 'Sección');
    const { error } = await ctx.supabase.rpc('close_section_grades', { p_section: section });
    if (error) return fail(error);
    refresh(section);
    return ok('Acta cerrada: notas finales, asistencia y resultados registrados.');
  });
}

export async function amendGrade(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('amend_grade', {
      p_grade: reqStr(fd, 'grade_id', 'Nota'), p_new_grade: num(fd, 'new_grade'), p_reason: reqStr(fd, 'reason', 'Motivo'),
    });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    return ok('Nota rectificada; el resultado final fue recalculado y queda en el historial.');
  });
}

/** 📱 Abre (o renueva) el código QR de asistencia de una clase. */
export async function openCheckin(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('open_checkin', { p_session: reqStr(fd, 'class_session_id', 'Clase'), p_minutes: num(fd, 'minutes') ?? 15 });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    return ok(`Código de asistencia: ${(data as { code: string }).code}. Muéstrelo o proyecte el QR.`);
  });
}

export async function closeCheckin(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('close_checkin', { p_session: reqStr(fd, 'class_session_id', 'Clase') });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    return ok('Se cerró el código de asistencia.');
  });
}

/** 👨‍🏫 Inicio / término / suspensión de la clase por el profesor. */
export async function teacherMark(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const action = reqStr(fd, 'action', 'acción');
    if (!['start', 'end', 'cancel', 'held'].includes(action)) return fail('Acción inválida.');
    const { data, error } = await ctx.supabase.rpc('teacher_class_mark', { p_session: reqStr(fd, 'class_session_id', 'Clase'), p_action: action });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    revalidatePath('/app/docencia');
    return ok(`${data}.`);
  });
}

/** 🎥 Asistencia automática según quién entró al aula virtual. */
export async function attendanceFromVirtual(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('attendance_from_conference', { p_session: reqStr(fd, 'class_session_id', 'Clase') });
    if (error) return fail(error);
    refresh(str(fd, 'section_id'));
    return ok(`Asistencia tomada desde el aula virtual (${data} estudiantes actualizados).`);
  });
}
