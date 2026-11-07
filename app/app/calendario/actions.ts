'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { localToIso } from '@/lib/lms';

export async function createEvent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const allDay = !!fd.get('all_day');
    const start = reqStr(fd, 'start', 'Inicio'); const end = str(fd, 'end') ?? start;
    const toIso = (v: string, endOfDay = false) => localToIso(v.length === 10 ? `${v}T${endOfDay ? '23:59' : '00:00'}` : v);
    const { error } = await ctx.supabase.from('calendar_events').insert({
      organization_id: ctx.orgId, kind: str(fd, 'kind') ?? 'evento', title: reqStr(fd, 'title', 'Título'), description: str(fd, 'description'),
      starts_at: toIso(allDay ? start.slice(0, 10) : start), ends_at: toIso(allDay ? end.slice(0, 10) : end, allDay),
      all_day: allDay, audience: str(fd, 'audience') ?? 'all',
    });
    if (error) return fail(error);
    revalidatePath('/app/calendario'); return ok('Evento agregado al calendario.');
  });
}

export async function deleteEvent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('calendar_events').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    revalidatePath('/app/calendario'); return ok('Evento eliminado.');
  });
}
