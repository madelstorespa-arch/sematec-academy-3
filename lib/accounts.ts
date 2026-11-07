import 'server-only';
import { getContext } from '@/lib/context';
import { ensureAuthUser } from '@/lib/users';

/** Crea la cuenta (correo + contraseña elegida) y la vincula a la ficha recién registrada (validado por RLS/RPC). */
export async function createAndLinkAccount(kind: 'student' | 'teacher', id: string, email: string, name: string, password: string) {
  const ctx = await getContext();
  const user = await ensureAuthUser(email, name, 'password', password);
  const { error } = await ctx.supabase.rpc('link_person_account', { p_kind: kind, p_person: id, p_user: user.id });
  if (error) throw new Error(error.message);
  return user.created;
}
