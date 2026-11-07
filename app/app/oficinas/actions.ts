'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { localToIso } from '@/lib/lms';

const back = (code: string) => { revalidatePath(`/app/oficinas/${code}`); revalidatePath('/app/oficinas'); };

export async function createPost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const parent = str(fd, 'parent_id');
    const { error } = await ctx.supabase.from('office_posts').insert({
      office_id: reqStr(fd, 'office_id', 'oficina'), parent_id: parent, title: parent ? null : reqStr(fd, 'title', 'Tema'),
      body: reqStr(fd, 'body', 'Mensaje'),
    });
    if (error) return fail(error);
    back(reqStr(fd, 'code', 'oficina'));
    return ok(parent ? 'Respuesta publicada.' : 'Tema publicado en la mesa de discusión.');
  });
}

export async function deletePost(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('office_posts').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('Solo puede eliminar sus propias publicaciones.');
    back(reqStr(fd, 'code', 'oficina'));
    return ok('Publicación eliminada.');
  });
}

export async function requestAppointment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const starts = localToIso(reqStr(fd, 'starts_at', 'Fecha y hora'));
    if (new Date(starts).getTime() < Date.now() + 10 * 60_000) return fail('Elija una fecha y hora futura.');
    const { error } = await ctx.supabase.from('appointments').insert({
      organization_id: ctx.orgId, office_id: reqStr(fd, 'office_id', 'oficina'), topic: reqStr(fd, 'topic', 'Motivo'),
      details: str(fd, 'details'), mode: reqStr(fd, 'mode', 'Modalidad'), starts_at: starts, duration_min: num(fd, 'duration_min') ?? 30,
    });
    if (error) return fail(error);
    back(reqStr(fd, 'code', 'oficina'));
    return ok('Cita solicitada. La oficina la confirmará y le llegará una notificación.');
  });
}

export async function manageAppointment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const when = str(fd, 'starts_at');
    const { error } = await ctx.supabase.rpc('update_appointment', {
      p_id: reqStr(fd, 'id', 'id'), p_status: reqStr(fd, 'status', 'Estado'), p_starts: when ? localToIso(when) : null, p_note: str(fd, 'note'),
    });
    if (error) return fail(error);
    back(reqStr(fd, 'code', 'oficina'));
    const st = String(fd.get('status'));
    return ok(st === 'confirmada' ? 'Cita confirmada y notificada.' : st === 'cancelada' ? 'Cita cancelada.' : 'Cita actualizada.');
  });
}
