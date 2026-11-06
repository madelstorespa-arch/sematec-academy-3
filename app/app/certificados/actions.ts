'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function issueCertificate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const template = reqStr(fd, 'template_id', 'Plantilla');
    const student = reqStr(fd, 'student_id', 'Estudiante');
    const { data: t } = await ctx.supabase.from('certificate_templates').select('certificate_type').eq('id', template).single();
    let enrollment: string | null = null;
    if (t && ['enrollment', 'program_completion'].includes(t.certificate_type)) {
      const { data: e } = await ctx.supabase.from('enrollments').select('id').eq('student_id', student)
        .in('status', t.certificate_type === 'enrollment' ? ['active'] : ['active', 'completed']).order('enrolled_at', { ascending: false }).limit(1).maybeSingle();
      if (!e) return fail('El estudiante no tiene una matrícula válida para este certificado.');
      enrollment = e.id;
    }
    const { data, error } = await ctx.supabase.rpc('issue_certificate', {
      p_template: template, p_student: student, p_course: str(fd, 'course_id'), p_enrollment: enrollment,
    });
    if (error) return fail(error);
    revalidatePath('/app/certificados');
    return ok('Certificado emitido.', data);
  });
}

export async function revokeCertificate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error } = await ctx.supabase.rpc('revoke_certificate', { p_certificate: id, p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    revalidatePath('/app/certificados', 'layout');
    return ok('Certificado revocado. La verificación pública mostrará su estado.');
  });
}

export async function createTemplate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('certificate_templates').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      certificate_type: reqStr(fd, 'certificate_type', 'Tipo'), title_template: reqStr(fd, 'title_template', 'Título'),
      body_template: str(fd, 'body_template') ?? '',
    });
    if (error) return fail(error);
    revalidatePath('/app/certificados');
    return ok('Plantilla creada.');
  });
}
