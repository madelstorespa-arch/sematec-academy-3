'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function updateProfile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('profiles').update({
      full_name: reqStr(fd, 'full_name', 'Nombre'), phone: str(fd, 'phone'), timezone: reqStr(fd, 'timezone', 'Zona horaria'),
    }).eq('id', ctx.user.id);
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Perfil actualizado.');
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
