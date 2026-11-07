'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser, checkPassword } from '@/lib/users';

export async function grantRole(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'security.admin') || ctx.aal !== 'aal2') return fail('Requiere permiso de seguridad y sesión con MFA.');
    const email = reqStr(fd, 'email', 'Correo').toLowerCase();
    const pw = str(fd, 'password');
    const user = await ensureAuthUser(email, reqStr(fd, 'full_name', 'Nombre'), fd.get('invite') ? 'invite' : 'password', pw ? checkPassword(pw) : undefined);
    const { error } = await ctx.supabase.rpc('grant_membership', {
      p_user: user.id, p_org: ctx.orgId, p_role_code: reqStr(fd, 'role', 'Rol'), p_campus: str(fd, 'campus_id'), p_valid_until: str(fd, 'valid_until'),
    });
    if (error) return fail(error);
    revalidatePath('/app/usuarios');
    if ('password' in user && user.password) return ok(pw ? `Rol asignado. Cuenta nueva ${email} con la contraseña que usted escribió.` : `Rol asignado. Cuenta nueva ${email} · contraseña temporal (se muestra solo esta vez): ${user.password}`);
    return ok(user.created ? `Rol asignado e invitación enviada a ${email}.` : `Rol asignado a ${email}.`);
  });
}

export async function revokeRole(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('revoke_membership', { p_membership: reqStr(fd, 'id', 'id'), p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    revalidatePath('/app/usuarios');
    return ok('Rol revocado.');
  });
}

export async function setAccountStatus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('set_profile_status', {
      p_user: reqStr(fd, 'user_id', 'Usuario'), p_status: reqStr(fd, 'status', 'Estado'), p_reason: reqStr(fd, 'reason', 'Motivo'),
    });
    if (error) return fail(error);
    revalidatePath('/app/usuarios');
    return ok('Estado de la cuenta actualizado.');
  });
}

export async function createRole(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const perms = fd.getAll('perm').map(String);
    if (!perms.length) return fail('Seleccione al menos un permiso.');
    const { error } = await ctx.supabase.rpc('create_custom_role', {
      p_org: ctx.orgId, p_code: reqStr(fd, 'code', 'Código').toLowerCase(), p_name: reqStr(fd, 'name', 'Nombre'),
      p_permissions: perms, p_requires_mfa: fd.get('mfa') === 'on',
    });
    if (error) return fail(error);
    revalidatePath('/app/usuarios');
    return ok('Rol personalizado creado.');
  });
}
