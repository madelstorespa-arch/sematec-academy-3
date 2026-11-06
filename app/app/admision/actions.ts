'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function decide(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const approve = reqStr(fd, 'decision', 'Decisión') === 'approve';
    const { error } = await ctx.supabase.rpc('decide_application', { p_application: reqStr(fd, 'id', 'id'), p_approve: approve, p_notes: str(fd, 'notes') });
    if (error) return fail(error);
    revalidatePath('/app/admision');
    return ok(approve ? 'Postulación aprobada. El postulante ya puede pagar desde «Estado de solicitud».' : 'Postulación rechazada.');
  });
}

export async function updateMessage(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('contact_messages').update({
      status: reqStr(fd, 'status', 'Estado'), internal_notes: str(fd, 'internal_notes'), handled_by: ctx.user.id, handled_at: new Date().toISOString(),
    }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath('/app/admision');
    return ok('Mensaje actualizado.');
  });
}
