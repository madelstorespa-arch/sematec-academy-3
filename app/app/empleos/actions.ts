'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function createJob(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'alumni.create')) return fail('No tiene permisos para publicar ofertas.');
    const url = str(fd, 'apply_url'); const email = str(fd, 'apply_email')?.toLowerCase() ?? null;
    if (!url && !email) return fail('Indique cómo postular: un enlace (https://…) o un correo.');
    if (url && !/^https:\/\//i.test(url)) return fail('El enlace para postular debe empezar con https://');
    const { error } = await ctx.supabase.from('job_postings').insert({
      organization_id: ctx.orgId, kind: reqStr(fd, 'kind', 'Tipo'), title: reqStr(fd, 'title', 'Cargo'), company: reqStr(fd, 'company', 'Empresa'),
      location: str(fd, 'location'), modality: reqStr(fd, 'modality', 'Modalidad'), description: reqStr(fd, 'description', 'Descripción'),
      apply_url: url, apply_email: email, closes_on: str(fd, 'closes_on'),
    });
    if (error) return fail(error);
    revalidatePath('/app/empleos');
    return ok('Oferta publicada en la bolsa de empleo.');
  });
}

export async function toggleJob(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('job_postings')
      .update({ published: fd.get('publish') === '1' }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath('/app/empleos');
    return ok(fd.get('publish') === '1' ? 'Oferta publicada.' : 'Oferta retirada.');
  });
}
