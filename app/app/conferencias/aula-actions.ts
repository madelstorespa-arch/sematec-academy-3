'use server';
import { getContext } from '@/lib/context';

const ok = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
export type Waiting = { id: string; name: string; requested_at: string; is_guest: boolean };

/** Estado de los controles del anfitrión (sala de espera, bloqueo, grupos abiertos). */
export async function getAulaControls(session: string) {
  if (!ok(session)) return null;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('conference_sessions').select('waiting_room, locked, breakout_groups').eq('id', session).maybeSingle();
  return data as { waiting_room: boolean; locked: boolean; breakout_groups: number } | null;
}

export async function getWaiting(session: string): Promise<Waiting[]> {
  if (!ok(session)) return [];
  const ctx = await getContext();
  const { data } = await ctx.supabase.rpc('conference_waiting_list', { p_session: session });
  return (data ?? []) as Waiting[];
}

export async function admitWaiting(session: string, ids: string[] | null, admit: boolean) {
  if (!ok(session)) return { ok: false, error: 'Sesión inválida' };
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc('conference_admit', { p_session: session, p_ids: ids?.filter(ok) ?? null, p_admit: admit });
  return error ? { ok: false, error: error.message } : { ok: true, count: data as number };
}

export async function setAulaControls(session: string, waiting: boolean | null, locked: boolean | null) {
  if (!ok(session)) return { ok: false, error: 'Sesión inválida' };
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc('conference_set_controls', { p_session: session, p_waiting: waiting, p_locked: locked });
  return error ? { ok: false, error: error.message } : { ok: true, ...(data as object) };
}
