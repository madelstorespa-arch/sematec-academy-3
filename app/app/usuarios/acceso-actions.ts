'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { checkPassword } from '@/lib/users';
import { sendRecoveryLink } from '@/lib/recovery';

/** Verifica que quien actúa pueda administrar accesos y que el usuario sea de su institución. */
async function target(fd: FormData) {
  const ctx = await getContext();
  if (!(ctx.isOwner || can(ctx, 'security.admin'))) throw new Error('Solo el propietario o el encargado de seguridad pueden hacer esto.');
  if (ctx.aal !== 'aal2') throw new Error('Por seguridad, inicie sesión con su código de verificación en dos pasos (MFA).');
  const userId = reqStr(fd, 'user_id', 'usuario');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Usuario inválido.');
  const admin = createAdminClient();
  const { data: m } = await admin.from('memberships').select('id').eq('user_id', userId).eq('organization_id', ctx.orgId!).limit(1);
  const { data: p } = await admin.from('profiles').select('email, is_platform_admin').eq('id', userId).maybeSingle();
  if (!m?.length || !p) throw new Error('El usuario no pertenece a su institución.');
  if (p.is_platform_admin && !ctx.isPlatformAdmin) throw new Error('No puede modificar la cuenta del superadministrador.');
  const log = (event: string) => admin.from('system_events').insert({ organization_id: ctx.orgId, user_id: userId, event_type: event, severity: 'warning',
    details: { by: ctx.user.id, by_email: ctx.user.email } });
  return { ctx, admin, userId, email: p.email as string, log };
}
const wrap = (fn: () => Promise<ActionResult>) => guard(async () => { try { return await fn(); } catch (e) { return fail((e as Error).message); } });

/** 🔓 Desbloquear o reactivar la cuenta. */
export async function unlockAccount(fd: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { ctx, userId } = await target(fd);
    const { error } = await ctx.supabase.rpc('set_profile_status', { p_user: userId, p_status: 'active', p_reason: 'Desbloqueo desde «¿Por qué no puede entrar?»' });
    if (error) return fail(error);
    revalidatePath('/app/usuarios');
    return ok('Cuenta desbloqueada: ya puede entrar.');
  });
}

/** 🔑 Poner una contraseña nueva (y quitar el bloqueo por intentos fallidos). */
export async function setNewPassword(fd: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { admin, userId, log, ctx } = await target(fd);
    if (userId === ctx.user.id) return fail('Para su propia cuenta use «Mi cuenta → Cambiar contraseña».');
    const pw = checkPassword(str(fd, 'password'));
    const { error } = await admin.auth.admin.updateUserById(userId, { password: pw, ban_duration: 'none' });
    if (error) return fail(error.message);
    await admin.rpc('unlock_after_password_reset', { p_user: userId });
    await log('admin_password_set');
    revalidatePath('/app/usuarios');
    return ok('Contraseña nueva guardada. Entréguesela a la persona (puede cambiarla en «Mi cuenta»).');
  });
}

/** 🔄 Reiniciar la verificación en dos pasos (perdió el celular o borró la app). */
export async function resetMfa(fd: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { admin, userId, log, ctx } = await target(fd);
    if (userId === ctx.user.id) return fail('No puede reiniciar su propia verificación desde aquí.');
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) return fail(error.message);
    for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    await log('admin_mfa_reset');
    revalidatePath('/app/usuarios');
    return ok(`Verificación en dos pasos reiniciada (${data?.factors?.length ?? 0} dispositivo/s). Al entrar, la persona configurará su app de nuevo.`);
  });
}

/** ✉ Enviar el enlace de recuperación por correo. */
export async function sendRecovery(fd: FormData): Promise<ActionResult> {
  return wrap(async () => {
    const { email } = await target(fd);
    const r = await sendRecoveryLink(email);
    if (r === 'mail_off') return fail('El envío de correos no está configurado (variables SMTP en Vercel). Use «Poner una contraseña nueva».');
    if (r === 'not_allowed') return fail('La cuenta está suspendida o bloqueada por la administración: desbloquéela primero.');
    if (r !== 'sent') return fail('No se pudo generar el enlace para esa cuenta.');
    return ok(`Enlace enviado a ${email}. Vence en 1 hora.`);
  });
}
