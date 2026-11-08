'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
      p_template: template, p_student: student, p_course: str(fd, 'course_id'), p_enrollment: enrollment, p_extra: str(fd, 'extra'),
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
      body_template: str(fd, 'body_template') ?? '', ...templateExtras(fd),
    });
    if (error) return fail(error);
    revalidatePath('/app/certificados');
    return ok('Plantilla creada.');
  });
}

function templateExtras(fd: FormData) {
  return {
    subtitle: str(fd, 'subtitle'), footer_text: str(fd, 'footer_text'), city: str(fd, 'city'),
    signer1_name: str(fd, 'signer1_name'), signer1_title: str(fd, 'signer1_title'),
    signer2_name: str(fd, 'signer2_name'), signer2_title: str(fd, 'signer2_title'),
  };
}

/** Editar el texto de una plantilla (aplica a los certificados que se emitan desde ahora). */
export async function updateTemplate(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('certificate_templates').update({
      name: reqStr(fd, 'name', 'Nombre'), title_template: reqStr(fd, 'title_template', 'Título'),
      body_template: str(fd, 'body_template') ?? '', ...templateExtras(fd),
    }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos para editar plantillas.');
    revalidatePath('/app/certificados');
    return ok('Plantilla actualizada. Los próximos certificados usarán este texto.');
  });
}

/** Editar un certificado emitido: se emite la versión corregida y la anterior queda revocada como reemplazada. */
export async function amendCertificate(fd: FormData): Promise<ActionResult> {
  const r = await guard(async () => {
    const ctx = await getContext();
    const changes = {
      title: str(fd, 'title'), recipient: str(fd, 'recipient'), subtitle: str(fd, 'subtitle'), body: str(fd, 'body'),
      extra: str(fd, 'extra'), city: str(fd, 'city'), footer: str(fd, 'footer'),
      signers: [1, 2].map((i) => ({ name: str(fd, `signer${i}_name`), title: str(fd, `signer${i}_title`) })),
    };
    const { data, error } = await ctx.supabase.rpc('amend_certificate', {
      p_certificate: reqStr(fd, 'id', 'id'), p_changes: changes, p_reason: reqStr(fd, 'reason', 'Motivo del cambio'),
    });
    if (error) return fail(error);
    revalidatePath('/app/certificados', 'layout');
    return ok('Certificado corregido.', data);
  });
  if (r.ok && r.data) redirect(`/app/certificados/${r.data}?editado=1`);
  return r;
}
