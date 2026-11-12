'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { mailSummary, nameOf, noticeToUsers, usersWithPermission } from '@/lib/notify';

export async function createRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('create_student_request', {
      p_kind: reqStr(fd, 'kind', 'Trámite'), p_subject: reqStr(fd, 'subject', 'Asunto'), p_details: str(fd, 'details') ?? '',
    });
    if (error) return fail(error);
    let mail = '';
    if (fd.get('send_email') === 'on' && ctx.orgId) {
      const staff = (await usersWithPermission(ctx.orgId, 'students.edit')).filter((u) => u !== ctx.user.id);
      mail = mailSummary(await noticeToUsers(staff, { org: ctx.orgId, kind: 'solicitud', by: ctx.user.id, subject: `nueva solicitud N° ${data}: ${String(fd.get('subject'))}`, title: `🎒 Solicitud N° ${data}`,
        text: `${await nameOf(ctx.user.id)} ingresó una solicitud (${String(fd.get('kind'))}):\n\n${String(fd.get('subject'))}\n${String(fd.get('details') ?? '')}`, link: { path: '/app/punto-estudiantil', label: 'Atender la solicitud' } }));
    }
    revalidatePath('/app/punto-estudiantil');
    return ok(`Solicitud N° ${data} ingresada. Le avisaremos cuando tenga respuesta.${mail}`);
  });
}

export async function answerRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error } = await ctx.supabase.rpc('answer_student_request', {
      p_id: id, p_status: reqStr(fd, 'status', 'Estado'), p_response: str(fd, 'response') ?? '',
    });
    if (error) return fail(error);
    let mail = '';
    if (fd.get('send_email') === 'on') {
      const { data: r } = await createAdminClient().from('student_requests').select('requester_id, number, subject, status, response').eq('id', id).maybeSingle();
      if (r?.requester_id) mail = mailSummary(await noticeToUsers([r.requester_id], { org: ctx.orgId, kind: 'solicitud', by: ctx.user.id, subject: `respuesta a su solicitud N° ${r.number}`, title: `🎒 ${r.subject}`,
        text: `Estado: ${r.status}\n\n${r.response ?? ''}`, link: { path: '/app/punto-estudiantil', label: 'Ver mi solicitud' } }));
    }
    revalidatePath('/app/punto-estudiantil');
    return ok(`Solicitud actualizada y estudiante notificado.${mail}`);
  });
}
