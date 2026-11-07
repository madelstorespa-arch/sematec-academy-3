import 'server-only';
import type { Ctx } from '@/lib/context';
import { ensureAuthUser, tempPassword } from '@/lib/users';
import { workspaceEnabled, createWorkspaceUser } from '@/lib/workspace';

/**
 * Crea automáticamente la cuenta del portal de un estudiante (y su correo institucional
 * en Google Workspace, si está configurado). El llamador ya verificó el permiso.
 * Devuelve un texto para mostrar una sola vez, o null si ya tenía cuenta.
 */
export async function autoStudentAccess(ctx: Ctx, studentId: string): Promise<string | null> {
  const { data: s } = await ctx.supabase.from('students').select('first_names, last_names, email, user_id').eq('id', studentId).maybeSingle();
  if (!s || s.user_id) return null;
  const password = tempPassword();
  let email = s.email as string | null;
  let institutional = false;
  if (workspaceEnabled()) {
    email = await createWorkspaceUser({ firstNames: s.first_names, lastNames: s.last_names, password });
    institutional = true;
    await ctx.supabase.from('students').update({ email }).eq('id', studentId);
  }
  if (!email) return 'El estudiante no tiene correo: agréguelo en su ficha y use «Crear contraseña».';
  const user = await ensureAuthUser(email, `${s.first_names} ${s.last_names}`, 'password', password);
  const { error } = await ctx.supabase.rpc('link_person_account', { p_kind: 'student', p_person: studentId, p_user: user.id });
  if (error) return `No se pudo vincular la cuenta: ${error.message}`;
  if (!user.created) return `Cuenta existente ${email} vinculada al estudiante.`;
  return `Acceso creado${institutional ? ' con correo institucional' : ''}: ${email} · contraseña temporal (se muestra solo esta vez): ${password}`;
}
