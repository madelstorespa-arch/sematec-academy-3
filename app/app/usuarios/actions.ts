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
    // Si escribió contraseña se usa esa (aunque esté marcado «Invitar por correo»)
    const user = await ensureAuthUser(email, reqStr(fd, 'full_name', 'Nombre'), fd.get('invite') && !pw ? 'invite' : 'password', pw ? checkPassword(pw) : undefined);
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

/** ✏ El propietario edita a un usuario: nombre, RUT, teléfono, correo de acceso y rol. */
export async function editMember(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Seleccione una institución.');
    const user = reqStr(fd, 'user_id', 'Usuario');
    const { checkDocument } = await import('@/lib/identity');
    const doc = checkDocument(str(fd, 'id_document_type') ?? 'RUN', str(fd, 'id_document_number'), false);
    if (!doc.ok) return fail(doc.error);
    const { error } = await ctx.supabase.rpc('admin_update_member', {
      p_org: ctx.orgId, p_user: user, p_full_name: reqStr(fd, 'full_name', 'Nombre'), p_doc_type: doc.type ?? '', p_doc_number: doc.number ?? '', p_phone: str(fd, 'phone') ?? '',
    });
    if (error) return fail(error);
    const role = str(fd, 'role'), membership = str(fd, 'membership_id');
    if (role && membership) {
      const { error: e2 } = await ctx.supabase.rpc('change_membership_role', { p_membership: membership, p_role_code: role, p_campus: str(fd, 'campus_id') });
      if (e2) return fail(e2);
    }
    const email = str(fd, 'email')?.toLowerCase();
    if (email && email !== str(fd, 'old_email')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Correo no válido.');
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const admin = createAdminClient();
      const { error: e3 } = await admin.auth.admin.updateUserById(user, { email, email_confirm: true });
      if (e3) return fail(e3.message.includes('already') ? 'Ese correo ya lo usa otra cuenta.' : e3.message);
      await admin.from('profiles').update({ email }).eq('id', user);
    }
    revalidatePath('/app/usuarios');
    return ok('Usuario actualizado.');
  });
}

async function removeOne(ctx: Awaited<ReturnType<typeof getContext>>, user: string, reason: string) {
  const { data, error } = await ctx.supabase.rpc('remove_member', { p_org: ctx.orgId, p_user: user, p_reason: reason });
  if (error) throw new Error(error.message);
  if ((data as any)?.suspended) {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    await createAdminClient().auth.admin.updateUserById(user, { ban_duration: '876000h' }).catch(() => {});
  }
}

/** 🗑 Elimina a la persona del sistema (revoca sus roles y bloquea su acceso). Su historial se conserva. */
export async function removeMember(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    try { await removeOne(ctx, reqStr(fd, 'user_id', 'Usuario'), reqStr(fd, 'reason', 'Motivo')); } catch (e) { return fail((e as Error).message); }
    revalidatePath('/app/usuarios');
    return ok('Usuario eliminado del sistema: ya no puede entrar. Su historial (notas, pagos, ventas) se conserva.');
  });
}

/** Acciones para varios usuarios a la vez (por ejemplo, todos los de un rol). */
export async function bulkMembers(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const users = [...new Set(fd.getAll('sel').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)))].filter((u) => u !== ctx.user.id);
    const action = reqStr(fd, 'bulk_action', 'Acción');
    const reason = str(fd, 'bulk_reason') ?? '';
    if (!users.length) return fail('Seleccione al menos un usuario (no se incluye usted).');
    if (reason.length < 3) return fail('Indique el motivo.');
    let done = 0; const errors: string[] = [];
    for (const u of users.slice(0, 500)) {
      try {
        if (action === 'remove') await removeOne(ctx, u, reason);
        else {
          const { error } = await ctx.supabase.rpc('set_profile_status', { p_user: u, p_status: action === 'activate' ? 'active' : 'suspended', p_reason: reason });
          if (error) throw new Error(error.message);
          if (action === 'activate') {
            const { createAdminClient } = await import('@/lib/supabase/admin');
            await createAdminClient().auth.admin.updateUserById(u, { ban_duration: 'none' }).catch(() => {});
          }
        }
        done++;
      } catch (e) { errors.push((e as Error).message); }
    }
    revalidatePath('/app/usuarios');
    if (!done) return fail(errors[0] ?? 'No se pudo aplicar.');
    const verb = action === 'remove' ? 'eliminados del sistema' : action === 'activate' ? 'reactivados' : 'suspendidos';
    return ok(`${done} usuario(s) ${verb}.${errors.length ? ` ${errors.length} no se pudieron: ${errors[0]}` : ''}`);
  });
}
