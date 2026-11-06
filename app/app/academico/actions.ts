'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

const done = (m: string) => { revalidatePath('/app/academico', 'layout'); return ok(m); };

export async function createGradeScale(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('grade_scales').insert({
      organization_id: ctx.orgId, name: reqStr(fd, 'name', 'Nombre'),
      min_grade: num(fd, 'min_grade'), max_grade: num(fd, 'max_grade'), passing_grade: num(fd, 'passing_grade'), decimals: num(fd, 'decimals') ?? 1,
    });
    return error ? fail(error) : done('Escala creada.');
  });
}

export async function createProgram(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('programs').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      level: reqStr(fd, 'level', 'Nivel'), modality: reqStr(fd, 'modality', 'Modalidad'),
      duration_terms: num(fd, 'duration_terms'), grade_scale_id: reqStr(fd, 'grade_scale_id', 'Escala de notas'),
    }).select('id').single();
    if (error) return fail(error);
    const { error: e2 } = await ctx.supabase.from('curricula').insert({
      organization_id: ctx.orgId, program_id: data.id, version: reqStr(fd, 'version', 'Versión de malla'),
      valid_from: reqStr(fd, 'valid_from', 'Vigente desde'), min_attendance_pct: num(fd, 'min_attendance_pct') ?? 75,
    });
    return e2 ? fail(e2) : done('Programa y malla creados.');
  });
}

export async function createCourse(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('courses').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      credits: num(fd, 'credits') ?? 0, weekly_hours: num(fd, 'weekly_hours') ?? 0, description: str(fd, 'description'),
    });
    return error ? fail(error) : done('Asignatura creada.');
  });
}

export async function addPrerequisite(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('course_prerequisites').insert({
      course_id: reqStr(fd, 'course_id', 'Asignatura'), prerequisite_id: reqStr(fd, 'prerequisite_id', 'Prerrequisito'),
    });
    return error ? fail(error) : done('Prerrequisito agregado.');
  });
}

export async function createPeriod(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('academic_periods').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código'), name: reqStr(fd, 'name', 'Nombre'),
      starts_on: reqStr(fd, 'starts_on', 'Inicio'), ends_on: reqStr(fd, 'ends_on', 'Término'),
      enrollment_opens_on: str(fd, 'enrollment_opens_on'), enrollment_closes_on: str(fd, 'enrollment_closes_on'),
      status: reqStr(fd, 'status', 'Estado'),
    });
    return error ? fail(error) : done('Periodo creado.');
  });
}

export async function setPeriodStatus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('academic_periods').update({ status: reqStr(fd, 'status', 'Estado') }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    return count ? done('Estado del periodo actualizado.') : fail('No tiene permisos.');
  });
}

export async function addCurriculumCourse(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('curriculum_courses').insert({
      curriculum_id: reqStr(fd, 'curriculum_id', 'Malla'), course_id: reqStr(fd, 'course_id', 'Asignatura'),
      term_number: num(fd, 'term_number'), is_mandatory: fd.get('is_mandatory') === 'on',
    });
    return error ? fail(error) : done('Asignatura agregada a la malla.');
  });
}

export async function removeCurriculumCourse(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('curriculum_courses').delete({ count: 'exact' })
      .eq('curriculum_id', reqStr(fd, 'curriculum_id', 'Malla')).eq('course_id', reqStr(fd, 'course_id', 'Asignatura'));
    if (error) return fail(error);
    return count ? done('Asignatura quitada de la malla.') : fail('No tiene permisos (requiere administración académica).');
  });
}
