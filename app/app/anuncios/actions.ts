'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { audienceUsers, mailSummary, noticeToUsers } from '@/lib/notify';

export async function createAnnouncement(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = str(fd, 'section_id');
    const audience = section ? 'section' : (str(fd, 'audience') ?? 'all');
    const title = reqStr(fd, 'title', 'Título'); const body = reqStr(fd, 'body', 'Mensaje');
    const { error } = await ctx.supabase.from('announcements').insert({
      organization_id: ctx.orgId, audience, section_id: section, title, body,
      pinned: !!fd.get('pinned'), expires_at: str(fd, 'expires_at'),
    });
    if (error) return fail(error);
    let mail = '';
    if (fd.get('send_email') === 'on' && ctx.orgId) {
      const users = (await audienceUsers(ctx.orgId, audience, section)).filter((u) => u !== ctx.user.id);
      mail = mailSummary(await noticeToUsers(users, { org: ctx.orgId, kind: 'anuncio', by: ctx.user.id, subject: `anuncio: ${title}`, title: `📢 ${title}`, text: body, link: { path: '/app/anuncios', label: 'Ver en la plataforma' } }));
    }
    revalidatePath('/app/anuncios'); revalidatePath('/app');
    return ok(`Anuncio publicado.${mail}`);
  });
}

export async function deleteAnnouncement(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('announcements').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos para eliminar este anuncio.');
    revalidatePath('/app/anuncios'); revalidatePath('/app');
    return ok('Anuncio eliminado.');
  });
}
