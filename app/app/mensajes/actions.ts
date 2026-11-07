'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function sendMessage(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('messages').insert({
      organization_id: ctx.orgId, recipient_id: reqStr(fd, 'recipient_id', 'Destinatario'), parent_id: str(fd, 'parent_id'),
      subject: reqStr(fd, 'subject', 'Asunto'), body: reqStr(fd, 'body', 'Mensaje'),
    });
    if (error) return fail(error.code === '42501' ? 'No puede enviar mensajes a esa persona.' : error);
    revalidatePath('/app/mensajes');
    return ok('Mensaje enviado.');
  });
}
