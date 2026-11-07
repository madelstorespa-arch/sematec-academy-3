'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser, checkPassword } from '@/lib/users';
import { createAdminClient } from '@/lib/supabase/admin';

/** Crea la cuenta del apoderado (con la contraseña que escribe el personal) y la vincula al estudiante. */
export async function addGuardian(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'guardians.create')) return fail('No tiene permisos para registrar apoderados.');
    const student = reqStr(fd, 'student_id', 'estudiante');
    const email = reqStr(fd, 'email', 'Correo').toLowerCase();
    const name = reqStr(fd, 'full_name', 'Nombre completo');
    // Lectura con RLS: confirma que el estudiante pertenece a la institución del usuario actual
    const { data: s } = await ctx.supabase.from('students').select('id, email').eq('id', student).maybeSingle();
    if (!s) return fail('Estudiante no encontrado.');
    const admin = createAdminClient();
    const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    const password = existing ? null : checkPassword(str(fd, 'password'));
    const user = await ensureAuthUser(email, name, 'password', password ?? undefined);
    const { error } = await ctx.supabase.rpc('link_guardian', { p_student: student, p_user: user.id, p_relationship: str(fd, 'relationship') ?? 'apoderado' });
    if (error) return fail(error);
    revalidatePath(`/app/estudiantes/${student}`);
    return ok(user.created
      ? `Apoderado registrado. Usuario: ${email} · contraseña: la que usted escribió. Entréguesela.`
      : `La cuenta ${email} ya existía: quedó vinculada como apoderado (conserva su contraseña).`);
  });
}

export async function revokeGuardian(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { data, error } = await ctx.supabase.from('guardian_links').update({ status: 'revocado' }).eq('id', id).select('student_id').maybeSingle();
    if (error) return fail(error);
    if (!data) return fail('No tiene permisos.');
    revalidatePath(`/app/estudiantes/${data.student_id}`);
    return ok('Vínculo de apoderado revocado.');
  });
}

/** Cambia la contraseña de un apoderado (solo cuentas cuyo único rol es apoderado). */
export async function resetGuardianPassword(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'guardians.edit')) return fail('No tiene permisos.');
    const id = reqStr(fd, 'id', 'id');
    const { data: link } = await ctx.supabase.from('guardian_links').select('guardian_id, organization_id').eq('id', id).maybeSingle();
    if (!link) return fail('Vínculo no encontrado.');
    const admin = createAdminClient();
    const { data: roles } = await admin.from('memberships').select('status, roles(code)').eq('user_id', link.guardian_id);
    if ((roles ?? []).some((m: any) => m.status === 'active' && m.roles?.code !== 'apoderado'))
      return fail('Esta persona tiene otros roles en la plataforma: su contraseña solo puede cambiarla su titular.');
    const password = checkPassword(str(fd, 'password'));
    const { error } = await admin.auth.admin.updateUserById(link.guardian_id, { password });
    if (error) return fail(error.message);
    await admin.from('system_events').insert({
      organization_id: link.organization_id, user_id: link.guardian_id, event_type: 'password_reset_by_admin', severity: 'warning',
      details: { by: ctx.user.id, kind: 'guardian' },
    });
    return ok('Contraseña del apoderado actualizada.');
  });
}
