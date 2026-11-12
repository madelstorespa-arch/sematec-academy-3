'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { HIDEABLE } from '@/lib/hideable';

/** 👁 Ocultar un registro para un público y por un tiempo. */
export async function hideRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const table = reqStr(fd, 'table', 'módulo'); const id = reqStr(fd, 'id', 'registro');
    if (!HIDEABLE.has(table)) return fail('Este registro no se puede ocultar.');
    const audience = fd.getAll('audience').map(String).filter((a) => ['all', 'public', 'students', 'teachers', 'guardians', 'staff'].includes(a));
    if (!audience.length) return fail('Elija para quién ocultarlo.');
    const dur = str(fd, 'duration') ?? 'siempre';
    let until: string | null = null;
    if (dur === 'fecha') {
      const d = str(fd, 'until'); if (!d) return fail('Elija hasta qué fecha.');
      until = new Date(`${d}T23:59:59-03:00`).toISOString();
    } else if (dur !== 'siempre') {
      const h = { '1h': 1, '1d': 24, '7d': 168, '30d': 720 }[dur]; if (!h) return fail('Duración inválida.');
      until = new Date(Date.now() + h * 3600_000).toISOString();
    }
    const { error } = await ctx.supabase.rpc('hide_record', { p_table: table, p_id: id, p_audience: audience.includes('all') ? ['all'] : audience, p_until: until, p_reason: str(fd, 'reason') });
    if (error) return fail(error);
    const path = String(fd.get('path') ?? ''); if (path.startsWith('/app')) revalidatePath(path);
    return ok(`Oculto${until ? ` hasta el ${new Date(until).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' })}` : ''}.`);
  });
}

export async function unhideRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('unhide_record', { p_table: reqStr(fd, 'table', 'módulo'), p_id: reqStr(fd, 'id', 'registro') });
    if (error) return fail(error);
    const path = String(fd.get('path') ?? ''); if (path.startsWith('/app')) revalidatePath(path);
    return ok('Visible de nuevo para todos.');
  });
}

/** Estado de ocultamiento de varios registros a la vez (para los botones de cada fila). */
export async function hiddenStates(ids: string[]): Promise<Record<string, { audience: string[]; until: string | null; reason: string | null }>> {
  const ctx = await getContext();
  const list = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 300);
  if (!list.length) return {};
  const { data } = await ctx.supabase.from('hidden_records').select('record_id, audience, hidden_until, reason').in('record_id', list);
  const out: Record<string, { audience: string[]; until: string | null; reason: string | null }> = {};
  for (const h of data ?? []) if (!h.hidden_until || Date.parse(h.hidden_until) > Date.now()) out[h.record_id] = { audience: h.audience, until: h.hidden_until, reason: h.reason };
  return out;
}
