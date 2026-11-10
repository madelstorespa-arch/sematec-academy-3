'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { checkDocument } from '@/lib/identity';

export async function updateProfile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const doc = checkDocument(str(fd, 'id_document_type') ?? 'RUN', str(fd, 'id_document_number'), true);
    if (!doc.ok) return fail(doc.error);
    const { error } = await ctx.supabase.rpc('update_my_identity', {
      p_full_name: reqStr(fd, 'full_name', 'Nombre'), p_doc_type: doc.type ?? 'RUN', p_doc_number: doc.number ?? '', p_phone: str(fd, 'phone'),
    });
    if (error) return fail(error);
    const tz = str(fd, 'timezone');
    if (tz) await ctx.supabase.from('profiles').update({ timezone: tz }).eq('id', ctx.user.id);
    revalidatePath('/app', 'layout');
    return ok('Datos guardados. Ya puede entrar al sistema con su correo o con su RUT.');
  });
}

export async function uploadAvatar(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { saveImage } = await import('@/lib/media');
    const r = await saveImage(fd.get('file') as File, { kind: 'avatar', organizationId: ctx.orgId, userId: ctx.user.id, isPublic: false });
    if (r.error) return fail(r.error);
    const { error } = await ctx.supabase.from('profiles').update({ avatar_asset_id: r.id }).eq('id', ctx.user.id);
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Foto de perfil actualizada.');
  });
}
