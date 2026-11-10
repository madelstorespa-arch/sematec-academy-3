'use server';
import { getContext } from '@/lib/context';

const ok = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
export type Waiting = { id: string; name: string; requested_at: string; is_guest: boolean };

/** Estado de los controles del anfitrión (sala de espera, bloqueo, grupos abiertos). */
export async function getAulaControls(session: string) {
  if (!ok(session)) return null;
  try {
    const ctx = await getContext();
    const { data } = await ctx.supabase.from('conference_sessions').select('waiting_room, locked, breakout_groups, room_policy').eq('id', session).maybeSingle();
    return data as { waiting_room: boolean; locked: boolean; breakout_groups: number; room_policy: Record<string, boolean> } | null;
  } catch { return null; }
}

export async function getWaiting(session: string): Promise<Waiting[]> {
  if (!ok(session)) return [];
  try {
    const ctx = await getContext();
    const { data } = await ctx.supabase.rpc('conference_waiting_list', { p_session: session });
    return (data ?? []) as Waiting[];
  } catch { return []; }
}

export async function admitWaiting(session: string, ids: string[] | null, admit: boolean) {
  if (!ok(session)) return { ok: false, error: 'Sesión inválida' };
  try {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('conference_admit', { p_session: session, p_ids: Array.isArray(ids) ? ids.filter(ok) : null, p_admit: !!admit });
    return error ? { ok: false, error: error.message } : { ok: true, count: data as number };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}

export async function setAulaControls(session: string, waiting: boolean | null, locked: boolean | null) {
  if (!ok(session)) return { ok: false, error: 'Sesión inválida' };
  try {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('conference_set_controls', { p_session: session, p_waiting: waiting, p_locked: locked });
    return error ? { ok: false, error: error.message } : { ok: true, ...(data as object) };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}

/** ⚙ Guarda la configuración de la sala (el servidor de video la aplica a quienes ya están conectados). */
export async function setRoomPolicy(session: string, policy: Record<string, boolean>) {
  if (!ok(session)) return { ok: false, error: 'Sesión inválida' };
  try {
    const ctx = await getContext();
    const clean = Object.fromEntries(Object.entries(policy ?? {}).filter(([k, v]) => ['mic', 'camera', 'share', 'chat', 'private_chat', 'reactions', 'rename'].includes(k) && typeof v === 'boolean'));
    const { data, error } = await ctx.supabase.rpc('conference_set_policy', { p_session: session, p_policy: clean });
    return error ? { ok: false, error: error.message } : { ok: true, policy: data as Record<string, boolean> };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}

export type AttendanceRow = { user_id: string; full_name: string; email: string; first_join: string; last_leave: string | null; minutes: number; connections: number; online: boolean };
/** 📋 Informe de asistencia de la sesión (solo anfitrión). */
export async function getAttendance(session: string): Promise<{ ok: boolean; rows?: AttendanceRow[]; error?: string }> {
  if (!ok(session)) return { ok: false, error: 'Sesión inválida' };
  try {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('conference_attendance_report', { p_session: session });
    return error ? { ok: false, error: error.message } : { ok: true, rows: (data ?? []) as AttendanceRow[] };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}
