'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function createAnnouncement(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const section = str(fd, 'section_id');
    const audience = section ? 'section' : (str(fd, 'audience') ?? 'all');
    const { error } = await ctx.supabase.from('announcements').insert({
      organization_id: ctx.orgId, audience, section_id: section,
      title: reqStr(fd, 'title', 'Título'), body: reqStr(fd, 'body', 'Mensaje'),
      pinned: !!fd.get('pinned'), expires_at: str(fd, 'expires_at'),
    });
    if (error) return fail(error);
    revalidatePath('/app/anuncios'); revalidatePath('/app');
    return ok('Anuncio publicado.');
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
