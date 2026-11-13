'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, str, type ActionResult } from '@/lib/actions';
import { fixSummary, type FixResult } from '@/lib/aula-access';

/** 🩺 Repara el acceso al Aula: de todos los estudiantes o de uno. */
export async function fixAulaAccess(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Elija una institución.');
    if (!can(ctx, 'students.edit') || !can(ctx, 'enrollments.create')) return fail('Necesita permiso para editar estudiantes y matricular.');
    const student = str(fd, 'student_id');
    if (student && !/^[0-9a-f-]{36}$/i.test(student)) return fail('Estudiante no válido.');
    const { data, error } = await ctx.supabase.rpc('aula_fix_access', { p_org: ctx.orgId, p_student: student });
    if (error) return fail(/aula_fix_access/.test(error.message) ? 'Falta instalar la actualización «Aula acceso» en Actualizar base de datos.' : error.message);
    revalidatePath('/app/aula', 'layout'); revalidatePath('/app/estudiantes');
    return ok(fixSummary(data as FixResult, !!student));
  });
}

/** 📢 Publica de una vez los exámenes en borrador de un curso para que los estudiantes los vean. */
export async function publishDraftQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = str(fd, 'id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return fail('Examen no válido.');
    const { count } = await ctx.supabase.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('quiz_id', id);
    if (!count) return fail('Ese examen todavía no tiene preguntas: agréguelas antes de publicarlo.');
    const { error, count: n } = await ctx.supabase.from('quizzes').update({ published: true }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error); if (!n) return fail('No autorizado.');
    revalidatePath('/app/aula', 'layout');
    return ok('Examen publicado: los estudiantes del curso ya lo ven.');
  });
}
