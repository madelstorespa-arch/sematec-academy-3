'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function openTicket(fd: FormData): Promise<ActionResult> {
  const r = await guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('support_tickets').insert({
      organization_id: ctx.orgId, subject: reqStr(fd, 'subject', 'Asunto'),
      category: str(fd, 'category') ?? 'general', priority: str(fd, 'priority') ?? 'normal',
    }).select('id').single();
    if (error) return fail(error);
    const { error: e2 } = await ctx.supabase.from('support_messages').insert({
      ticket_id: data.id, organization_id: ctx.orgId, body: reqStr(fd, 'body', 'Descripción'),
    });
    if (e2) return fail(e2);
    revalidatePath('/app/soporte');
    return ok('Solicitud enviada.', data.id);
  });
  if (r.ok) redirect(`/app/soporte/${r.data}`);
  return r;
}

export async function replyTicket(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'ticket_id', 'ticket');
    const { error } = await ctx.supabase.from('support_messages').insert({
      ticket_id: id, organization_id: ctx.orgId, body: reqStr(fd, 'body', 'Mensaje'), internal: !!fd.get('internal'),
    });
    if (error) return fail(error.code === '42501' ? 'El ticket está cerrado o no tiene acceso.' : error);
    revalidatePath(`/app/soporte/${id}`);
    return ok('Respuesta enviada.');
  });
}

export async function updateTicket(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'ticket_id', 'ticket');
    const status = reqStr(fd, 'status', 'Estado');
    const { error, count } = await ctx.supabase.from('support_tickets').update({
      status, priority: reqStr(fd, 'priority', 'Prioridad'), assigned_to: str(fd, 'assigned_to'),
      closed_at: ['resuelto', 'cerrado'].includes(status) ? new Date().toISOString() : null,
    }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos para gestionar tickets.');
    revalidatePath(`/app/soporte/${id}`); revalidatePath('/app/soporte');
    return ok('Ticket actualizado.');
  });
}
