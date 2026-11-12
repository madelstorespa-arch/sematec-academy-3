'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';

const KINDS = ['doc', 'sheet', 'slides', 'pub'] as const;
type Kind = (typeof KINDS)[number];
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/** Crea un documento nuevo (vacío, desde una plantilla o importado) y devuelve su id. */
export async function createOfficeDoc(kind: Kind, title: string, content: unknown): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!KINDS.includes(kind)) return { ok: false, error: 'Tipo inválido' };
  try {
    const ctx = await getContext();
    const org = requireOrg(ctx);
    const { data, error } = await ctx.supabase.from('office_documents')
      .insert({ organization_id: org, owner_id: ctx.user.id, kind, title: (title || 'Sin título').slice(0, 200), content: content ?? {} }).select('id').single();
    if (error) return { ok: false, error: error.message.includes('octet_length') ? 'El documento es demasiado grande (máx. 25 MB).' : error.message };
    revalidatePath('/app/oficina');
    return { ok: true, id: data.id };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}

export async function newOfficeDoc(fd: FormData) {
  const kind = String(fd.get('kind')) as Kind;
  const title = String(fd.get('title') ?? '') || ({ doc: 'Documento', sheet: 'Hoja de cálculo', slides: 'Presentación', pub: 'Publicación' } as Record<string, string>)[kind] || 'Sin título';
  const r = await createOfficeDoc(kind, title, { template: String(fd.get('template') ?? ''), size: String(fd.get('size') ?? '') });
  if (r.ok && r.id) redirect(`/app/oficina/${r.id}`);
  redirect('/app/oficina?error=1');
}

/** Guardado automático. */
export async function saveOfficeDoc(id: string, title: string, content: unknown): Promise<{ ok: boolean; error?: string; at?: string }> {
  if (!uuid(id)) return { ok: false, error: 'Documento inválido' };
  try {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('office_documents').update({ title: (title || 'Sin título').slice(0, 200), content }).eq('id', id).select('updated_at').maybeSingle();
    if (error) return { ok: false, error: error.message.includes('octet_length') ? 'El documento superó el máximo de 25 MB (reduzca las imágenes).' : error.message };
    if (!data) return { ok: false, error: 'No tiene permiso para editar este documento.' };
    return { ok: true, at: data.updated_at };
  } catch { return { ok: false, error: 'Sin conexión: los cambios quedan en esta pantalla; se guardarán al reconectar.' }; }
}

export async function shareOfficeDoc(id: string, shared: string) {
  if (!uuid(id) || !['private', 'org_view', 'org_edit'].includes(shared)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const { error, count } = await ctx.supabase.from('office_documents').update({ shared }, { count: 'exact' }).eq('id', id).eq('owner_id', ctx.user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: 'Solo el dueño puede compartir el documento.' };
  revalidatePath('/app/oficina');
  return { ok: true };
}

export async function trashOfficeDoc(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_documents').update({ deleted_at: fd.get('restore') ? null : new Date().toISOString() }).eq('id', id).eq('owner_id', ctx.user.id);
  revalidatePath('/app/oficina');
}

export async function duplicateOfficeDoc(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_documents').select('kind, title, content').eq('id', id).maybeSingle();
  if (!data) return;
  const r = await createOfficeDoc(data.kind as Kind, `Copia de ${data.title}`.slice(0, 200), data.content);
  if (r.ok && r.id) redirect(`/app/oficina/${r.id}`);
}
