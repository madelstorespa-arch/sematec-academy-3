'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function createRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('create_student_request', {
      p_kind: reqStr(fd, 'kind', 'Trámite'), p_subject: reqStr(fd, 'subject', 'Asunto'), p_details: str(fd, 'details') ?? '',
    });
    if (error) return fail(error);
    revalidatePath('/app/punto-estudiantil');
    return ok(`Solicitud N° ${data} ingresada. Le avisaremos cuando tenga respuesta.`);
  });
}

export async function answerRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('answer_student_request', {
      p_id: reqStr(fd, 'id', 'id'), p_status: reqStr(fd, 'status', 'Estado'), p_response: str(fd, 'response') ?? '',
    });
    if (error) return fail(error);
    revalidatePath('/app/punto-estudiantil');
    return ok('Solicitud actualizada y estudiante notificado.');
  });
}
