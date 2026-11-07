'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function saveAlumniProfile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const student = str(fd, 'student_id') ?? ctx.studentId;
    if (!student) return fail('No se encontró la ficha de estudiante.');
    if (student !== ctx.studentId && !can(ctx, 'alumni.edit')) return fail('No tiene permisos.');
    const linkedin = str(fd, 'linkedin_url');
    if (linkedin && !/^https:\/\//i.test(linkedin)) return fail('El enlace de LinkedIn debe empezar con https://');
    const { data: enr } = await ctx.supabase.from('enrollments').select('programs(name)').eq('student_id', student).order('created_at', { ascending: false }).limit(1);
    const { error } = await ctx.supabase.from('alumni_profiles').upsert({
      student_id: student, organization_id: ctx.orgId, graduation_year: num(fd, 'graduation_year'),
      program_name: (enr?.[0] as any)?.programs?.name ?? null, employment: reqStr(fd, 'employment', 'Situación laboral'),
      employer: str(fd, 'employer'), job_title: str(fd, 'job_title'), linkedin_url: linkedin, consent_contact: !!fd.get('consent_contact'),
    });
    if (error) return fail(error);
    revalidatePath('/app/egresados');
    return ok('Perfil de egresado guardado.');
  });
}
