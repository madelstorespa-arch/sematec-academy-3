'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { OFFICE_QUOTA_BYTES } from '@/lib/office/limits';
import { isOO } from '@/lib/onlyoffice';
import { createAdminClient } from '@/lib/supabase/admin';

const KINDS = ['doc', 'sheet', 'slides', 'pub'] as const;
type Kind = (typeof KINDS)[number];
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const tooBig = (m: string) => (m.includes('octet_length') ? 'El documento superó el máximo de 25 MB (reduzca las imágenes).' : m);
const OFFLINE = { ok: false, error: 'Sin conexión con el servidor.' } as const;
const QUOTA_MSG = 'Superó el espacio disponible: vacíe la papelera o elimine archivos para crear documentos nuevos.';
const VERSION_EVERY_MS = 10 * 60 * 1000;

/** Crea un documento nuevo (vacío, desde una plantilla o importado) y devuelve su id. */
export async function createOfficeDoc(kind: Kind, title: string, content: unknown, folderId?: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!KINDS.includes(kind)) return { ok: false, error: 'Tipo inválido' };
  try {
    const ctx = await getContext();
    const org = requireOrg(ctx);
    const { data: u } = await ctx.supabase.rpc('office_usage');
    const used = Number((u as { office?: number } | null)?.office ?? 0) + Number((u as { files?: number } | null)?.files ?? 0);
    if (used >= OFFICE_QUOTA_BYTES) return { ok: false, error: QUOTA_MSG };
    const { data, error } = await ctx.supabase.from('office_documents')
      .insert({ organization_id: org, owner_id: ctx.user.id, kind, title: (title || 'Sin título').slice(0, 200), content: content ?? {}, folder_id: uuid(folderId) ? folderId : null }).select('id').single();
    if (error) return { ok: false, error: tooBig(error.message) };
    revalidatePath('/app/oficina');
    return { ok: true, id: data.id };
  } catch { return OFFLINE; }
}

export async function newOfficeDoc(fd: FormData) {
  const kind = String(fd.get('kind')) as Kind;
  const title = String(fd.get('title') ?? '') || ({ doc: 'Documento', sheet: 'Hoja de cálculo', slides: 'Presentación', pub: 'Publicación' } as Record<string, string>)[kind] || 'Sin título';
  const r = await createOfficeDoc(kind, title, { template: String(fd.get('template') ?? ''), size: String(fd.get('size') ?? '') }, String(fd.get('folder') ?? '') || null);
  if (r.ok && r.id) redirect(`/app/oficina/${r.id}`);
  redirect(`/app/oficina?error=${r.error === QUOTA_MSG ? 'cuota' : '1'}`);
}

export type SaveResult = { ok: boolean; error?: string; version?: number; conflict?: { version: number; by: string; at: string } };

/**
 * Guardado automático con control de conflictos: solo guarda si nadie más cambió el documento
 * desde la versión que la persona tiene abierta (nunca se pisan cambios ajenos en silencio).
 */
export async function saveOfficeDoc(id: string, title: string, content: unknown, baseVersion?: number): Promise<SaveResult> {
  if (!uuid(id)) return { ok: false, error: 'Documento inválido' };
  try {
    const ctx = await getContext();
    let q = ctx.supabase.from('office_documents').update({ title: (title || 'Sin título').slice(0, 200), content }).eq('id', id);
    if (typeof baseVersion === 'number') q = q.eq('version', baseVersion);
    const { data, error } = await q.select('version, organization_id').maybeSingle();
    if (error) return { ok: false, error: tooBig(error.message) };
    if (!data) {
      const { data: cur } = await ctx.supabase.from('office_documents').select('version, updated_at, profiles!office_documents_updated_by_fkey(full_name)').eq('id', id).maybeSingle();
      if (cur && typeof baseVersion === 'number' && cur.version !== baseVersion) {
        return { ok: false, conflict: { version: cur.version, at: cur.updated_at, by: (cur.profiles as { full_name?: string } | null)?.full_name ?? 'otra persona' } };
      }
      return { ok: false, error: 'No tiene permiso para editar este documento (solo lectura).' };
    }
    // Versión automática cada 10 minutos de edición
    const { data: last } = await ctx.supabase.from('office_versions').select('created_at').eq('document_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!last || Date.now() - Date.parse(last.created_at) > VERSION_EVERY_MS) {
      await ctx.supabase.from('office_versions').insert({ organization_id: data.organization_id, document_id: id, version: data.version, title, content, label: null });
    }
    return { ok: true, version: data.version };
  } catch { return { ok: false, error: 'Sin conexión: los cambios quedan en esta pantalla; se guardarán al reconectar.' }; }
}

/** Estado actual del documento y quiénes lo tienen abierto (para avisar cambios de otras personas). */
export async function officePulse(id: string): Promise<{ ok: boolean; version?: number; by?: string; present?: string[] }> {
  if (!uuid(id)) return { ok: false };
  try {
    const ctx = await getContext();
    const now = new Date().toISOString();
    await ctx.supabase.from('office_marks').upsert({ user_id: ctx.user.id, document_id: id, opened_at: now }, { onConflict: 'user_id,document_id' });
    const [{ data: d }, { data: who }] = await Promise.all([
      ctx.supabase.from('office_documents').select('version, profiles!office_documents_updated_by_fkey(full_name)').eq('id', id).maybeSingle(),
      ctx.supabase.rpc('office_present', { p_doc: id }),
    ]);
    return { ok: true, version: d?.version, by: (d?.profiles as { full_name?: string } | null)?.full_name, present: ((who ?? []) as { full_name: string }[]).map((w) => w.full_name) };
  } catch { return { ok: false }; }
}

// ---------------------------------------------------------------- compartir
export async function shareOfficeDoc(id: string, shared: string) {
  if (!uuid(id) || !['private', 'org_view', 'org_edit'].includes(shared)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const { error, count } = await ctx.supabase.from('office_documents').update({ shared }, { count: 'exact' }).eq('id', id).eq('owner_id', ctx.user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: 'Solo el dueño puede compartir el documento.' };
  revalidatePath('/app/oficina');
  return { ok: true };
}

export async function searchPeople(q: string) {
  try {
    const ctx = await getContext();
    const { data } = await ctx.supabase.rpc('office_people', { p_org: requireOrg(ctx), p_q: String(q ?? '').slice(0, 60) });
    return (data ?? []) as { id: string; full_name: string; email: string }[];
  } catch { return []; }
}

export async function listShares(id: string) {
  if (!uuid(id)) return [];
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_shares').select('id, permission, expires_at, grantee_id, profiles!office_shares_grantee_id_fkey(full_name, email)').eq('document_id', id).order('created_at');
  return (data ?? []).map((s) => ({ id: s.id, permission: s.permission as string, expires_at: s.expires_at as string | null, grantee_id: s.grantee_id, name: (s.profiles as { full_name?: string } | null)?.full_name ?? '', email: (s.profiles as { email?: string } | null)?.email ?? '' }));
}

export async function shareWith(id: string, grantee: string, permission: string, expires: string | null) {
  if (!uuid(id) || !uuid(grantee) || !['viewer', 'commenter', 'editor'].includes(permission)) return { ok: false, error: 'Datos inválidos' };
  const exp = expires ? new Date(`${expires}T23:59:59-03:00`) : null;
  if (exp && (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now())) return { ok: false, error: 'La fecha de caducidad debe ser futura.' };
  try {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('office_shares').upsert({ document_id: id, grantee_id: grantee, permission, expires_at: exp?.toISOString() ?? null, created_by: ctx.user.id, organization_id: requireOrg(ctx) }, { onConflict: 'document_id,grantee_id' });
    if (error) return { ok: false, error: error.message.includes('row-level') ? 'Solo el dueño puede compartir el documento.' : error.message };
    revalidatePath('/app/oficina');
    return { ok: true };
  } catch { return OFFLINE; }
}

export async function revokeShare(shareId: string) {
  if (!uuid(shareId)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const { error, count } = await ctx.supabase.from('office_shares').delete({ count: 'exact' }).eq('id', shareId);
  if (error || !count) return { ok: false, error: error?.message ?? 'No autorizado' };
  revalidatePath('/app/oficina');
  return { ok: true };
}

// ---------------------------------------------------------------- versiones
export async function listVersions(id: string) {
  if (!uuid(id)) return [];
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_versions').select('id, version, title, label, created_at, profiles!office_versions_created_by_fkey(full_name)').eq('document_id', id).order('created_at', { ascending: false }).limit(100);
  return (data ?? []).map((v) => ({ id: v.id, version: v.version, title: v.title, label: v.label as string | null, at: v.created_at, by: (v.profiles as { full_name?: string } | null)?.full_name ?? '' }));
}

export async function saveVersion(id: string, label: string) {
  if (!uuid(id)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const { data: d } = await ctx.supabase.from('office_documents').select('organization_id, version, title, content').eq('id', id).maybeSingle();
  if (!d) return { ok: false, error: 'Documento no encontrado' };
  const { error } = await ctx.supabase.from('office_versions').insert({ organization_id: d.organization_id, document_id: id, version: d.version, title: d.title, content: d.content, label: (label || 'Versión guardada').slice(0, 120) });
  return error ? { ok: false, error: error.message.includes('row-level') ? 'Solo el dueño o un editor puede guardar versiones.' : error.message } : { ok: true };
}

/** Restaura una versión anterior (antes guarda la actual como versión, para poder deshacer). */
export async function restoreVersion(versionId: string): Promise<{ ok: boolean; error?: string; version?: number }> {
  if (!uuid(versionId)) return { ok: false, error: 'Datos inválidos' };
  const ctx = await getContext();
  const { data: v } = await ctx.supabase.from('office_versions').select('document_id, version, title, content, created_at').eq('id', versionId).maybeSingle();
  if (!v) return { ok: false, error: 'Versión no encontrada' };
  const before = await saveVersion(v.document_id, `Antes de restaurar la versión del ${new Date(v.created_at).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`);
  if (!before.ok) return before;
  // Un archivo de ONLYOFFICE restaurado abre una sesión nueva (clave nueva)
  const content = isOO(v.content) ? { oo: { ...v.content.oo, key: crypto.randomUUID() } } : v.content;
  const { data, error } = await ctx.supabase.from('office_documents').update({ title: v.title, content }).eq('id', v.document_id).select('version').maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? 'No tiene permiso para restaurar.' };
  return { ok: true, version: data.version };
}

// ---------------------------------------------------------------- comentarios
export async function listComments(id: string) {
  if (!uuid(id)) return [];
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_comments').select('id, body, quote, resolved, created_at, author_id, profiles!office_comments_author_id_fkey(full_name)').eq('document_id', id).order('created_at');
  return (data ?? []).map((c) => ({ id: c.id, body: c.body, quote: c.quote as string | null, resolved: c.resolved, at: c.created_at, mine: c.author_id === ctx.user.id, by: (c.profiles as { full_name?: string } | null)?.full_name ?? '' }));
}

export async function addComment(id: string, body: string, quote: string | null) {
  if (!uuid(id) || !String(body ?? '').trim()) return { ok: false, error: 'Escriba el comentario.' };
  try {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('office_comments').insert({ document_id: id, organization_id: requireOrg(ctx), author_id: ctx.user.id, body: String(body).trim().slice(0, 2000), quote: quote ? String(quote).slice(0, 500) : null });
    return error ? { ok: false, error: error.message.includes('row-level') ? 'Con acceso de lector no puede comentar.' : error.message } : { ok: true };
  } catch { return OFFLINE; }
}

export async function resolveComment(commentId: string, resolved: boolean) {
  if (!uuid(commentId)) return { ok: false };
  const ctx = await getContext();
  const { error, count } = await ctx.supabase.from('office_comments').update({ resolved }, { count: 'exact' }).eq('id', commentId);
  return { ok: !error && !!count };
}

export async function deleteComment(commentId: string) {
  if (!uuid(commentId)) return { ok: false };
  const ctx = await getContext();
  const { error, count } = await ctx.supabase.from('office_comments').delete({ count: 'exact' }).eq('id', commentId);
  return { ok: !error && !!count };
}

// ---------------------------------------------------------------- Drive (formularios)
const back = (fd: FormData) => { const r = String(fd.get('back') ?? '/app/oficina'); return r.startsWith('/app/oficina') ? r : '/app/oficina'; };

export async function trashOfficeDoc(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_documents').update({ deleted_at: fd.get('restore') ? null : new Date().toISOString() }).eq('id', id).eq('owner_id', ctx.user.id);
  revalidatePath('/app/oficina');
}

export async function purgeOfficeDoc(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  const { data: gone } = await ctx.supabase.from('office_documents').delete().eq('id', id).eq('owner_id', ctx.user.id).not('deleted_at', 'is', null).select('id, organization_id').maybeSingle();
  if (gone) await removeStored(gone.organization_id, gone.id);
  revalidatePath('/app/oficina');
}

export async function duplicateOfficeDoc(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_documents').select('kind, title, content, folder_id, owner_id').eq('id', id).maybeSingle();
  if (!data) return;
  const oo = isOO(data.content) ? data.content.oo : null;
  const r = await createOfficeDoc(data.kind as Kind, `Copia de ${data.title}`.slice(0, 200), oo ? { importing: true } : data.content, data.owner_id === ctx.user.id ? data.folder_id : null);
  if (r.ok && r.id && oo) {
    // El archivo de ONLYOFFICE se copia a la carpeta del documento nuevo
    const { data: nd } = await ctx.supabase.from('office_documents').select('organization_id').eq('id', r.id).single();
    const to = `oficina/${nd!.organization_id}/${r.id}/${crypto.randomUUID()}.${oo.ext}`;
    const cp = await createAdminClient().storage.from('user-files').copy(oo.path, to);
    if (!cp.error) await ctx.supabase.from('office_documents').update({ content: { oo: { path: to, ext: oo.ext, size: oo.size, key: crypto.randomUUID() } } }).eq('id', r.id);
  }
  if (r.ok && r.id) redirect(`/app/oficina/${r.id}`);
}

export async function renameOfficeDoc(fd: FormData) {
  const id = String(fd.get('id')); const title = String(fd.get('title') ?? '').trim().slice(0, 200);
  if (!uuid(id) || !title) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_documents').update({ title }).eq('id', id);
  revalidatePath('/app/oficina');
}

export async function moveOfficeDoc(fd: FormData) {
  const id = String(fd.get('id')); const folder = String(fd.get('folder') ?? '');
  if (!uuid(id)) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_documents').update({ folder_id: uuid(folder) ? folder : null }).eq('id', id).eq('owner_id', ctx.user.id);
  revalidatePath('/app/oficina');
}

export async function starOfficeDoc(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_marks').upsert({ user_id: ctx.user.id, document_id: id, starred: fd.get('on') === '1' }, { onConflict: 'user_id,document_id' });
  revalidatePath('/app/oficina');
}

export async function createFolder(fd: FormData) {
  const name = String(fd.get('name') ?? '').trim().slice(0, 120); const parent = String(fd.get('parent') ?? '');
  if (!name) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_folders').insert({ organization_id: requireOrg(ctx), owner_id: ctx.user.id, name, parent_id: uuid(parent) ? parent : null });
  revalidatePath('/app/oficina');
  redirect(back(fd));
}

export async function renameFolder(fd: FormData) {
  const id = String(fd.get('id')); const name = String(fd.get('name') ?? '').trim().slice(0, 120);
  if (!uuid(id) || !name) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_folders').update({ name }).eq('id', id);
  revalidatePath('/app/oficina');
}

/** Elimina una carpeta: sus documentos vuelven a «Mis archivos» (no se borra ningún documento). */
export async function deleteFolder(fd: FormData) {
  const id = String(fd.get('id'));
  if (!uuid(id)) return;
  const ctx = await getContext();
  await ctx.supabase.from('office_folders').delete().eq('id', id);
  revalidatePath('/app/oficina');
  redirect('/app/oficina?v=mios');
}

/** Retención de la papelera: elimina definitivamente lo que lleva más de `days` días (y sus archivos). */
export async function purgeExpiredTrash(days: number) {
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_documents').delete().eq('owner_id', ctx.user.id)
    .lt('deleted_at', new Date(Date.now() - days * 864e5).toISOString()).select('id, organization_id');
  for (const d of data ?? []) await removeStored(d.organization_id, d.id);
}

/** Borra del almacenamiento los archivos de ONLYOFFICE de un documento eliminado definitivamente. */
async function removeStored(org: string, id: string) {
  try {
    const admin = createAdminClient(); const dir = `oficina/${org}/${id}`;
    const { data } = await admin.storage.from('user-files').list(dir, { limit: 1000 });
    if (data?.length) await admin.storage.from('user-files').remove(data.map((o) => `${dir}/${o.name}`));
  } catch { /* el documento ya no existe; los archivos huérfanos no son accesibles */ }
}
