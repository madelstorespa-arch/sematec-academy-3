'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { mailSummary, nameOf, noticeToUsers, usersWithPermission } from '@/lib/notify';

/** La «otra parte» del ticket: quien lo pidió, o quien lo atiende (asignado o equipo de soporte). */
async function otherSide(ticketId: string, me: string) {
  const { data: t } = await createAdminClient().from('support_tickets').select('organization_id, requester_id, assigned_to, subject, number').eq('id', ticketId).maybeSingle();
  if (!t) return { users: [] as string[], t: null };
  if (t.requester_id !== me) return { users: [t.requester_id as string], t };
  return { users: t.assigned_to ? [t.assigned_to as string] : (await usersWithPermission(t.organization_id, 'support.edit')).filter((u) => u !== me), t };
}

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
    if (fd.get('send_email') === 'on') {
      const { users, t } = await otherSide(data.id, ctx.user.id);
      if (t) await noticeToUsers(users, { org: ctx.orgId, kind: 'soporte', by: ctx.user.id, subject: `solicitud de soporte N° ${t.number}: ${t.subject}`, title: `🛟 ${t.subject}`,
        text: `${await nameOf(ctx.user.id)} pidió ayuda:\n\n${String(fd.get('body') ?? '')}`, link: { path: `/app/soporte/${data.id}`, label: 'Atender la solicitud' } });
    }
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
    let mail = '';
    if (fd.get('send_email') === 'on' && !fd.get('internal')) {
      const { users, t } = await otherSide(id, ctx.user.id);
      if (t) mail = mailSummary(await noticeToUsers(users, { org: ctx.orgId, kind: 'soporte', by: ctx.user.id, subject: `respuesta en la solicitud N° ${t.number}`, title: `🛟 ${t.subject}`,
        text: `${await nameOf(ctx.user.id)} respondió:\n\n${String(fd.get('body') ?? '')}`, link: { path: `/app/soporte/${id}`, label: 'Ver la conversación' } }));
    }
    revalidatePath(`/app/soporte/${id}`);
    return ok(`Respuesta enviada.${mail}`);
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
