'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import type { CustomModule } from '@/lib/modules';
import { createAdminClient } from '@/lib/supabase/admin';
import { mailSummary, nameOf, noticeToUsers, usersWithRoles } from '@/lib/notify';

const FILE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip',
};

async function load(fd: FormData) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('id', reqStr(fd, 'module_id', 'Sistema')).eq('organization_id', orgId).maybeSingle();
  if (!m) throw new ValidationError('Sistema no encontrado.');
  return { ctx, orgId, m: m as CustomModule };
}

function dataFrom(fd: FormData, m: CustomModule) {
  const data: Record<string, unknown> = {};
  for (const f of m.fields) {
    const raw = fd.get(`f_${f.key}`);
    if (f.type === 'checkbox') { data[f.key] = raw === 'on'; continue; }
    const v = typeof raw === 'string' ? raw.trim().slice(0, f.type === 'textarea' ? 5000 : 500) : '';
    if (!v) { if (f.required) throw new ValidationError(`Complete el campo «${f.label}».`); data[f.key] = null; continue; }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(v.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) throw new ValidationError(`«${f.label}» debe ser un número.`);
      data[f.key] = String(n);
    } else data[f.key] = v;
  }
  return data;
}

const statusLabel = (m: CustomModule, k?: string | null) => m.workflow?.find((w) => w.key === k)?.label ?? k ?? '';
const link = (m: CustomModule, id: string) => ({ path: `/app/m/${m.slug}/${id}`, label: 'Ver en la plataforma' });

/** Sube un archivo adjunto a un registro (máx. 4 MB). */
async function attach(ctx: Awaited<ReturnType<typeof getContext>>, orgId: string, recordId: string, file: File) {
  if (!file.size) return;
  if (file.size > 4 * 1024 * 1024) throw new ValidationError('El archivo pesa más de 4 MB.');
  const ext = FILE_TYPES[file.type];
  if (!ext) throw new ValidationError('Tipo de archivo no permitido (PDF, imágenes, Word, Excel, PowerPoint, texto o ZIP).');
  const path = `sistemas/${orgId}/${recordId}/${crypto.randomUUID()}.${ext}`;
  const up = await createAdminClient().storage.from('user-files').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) throw new ValidationError(`No se pudo guardar el archivo: ${up.error.message}`);
  const { error } = await ctx.supabase.from('custom_record_files').insert({ organization_id: orgId, record_id: recordId, path, name: file.name.slice(0, 200), size: file.size, mime: file.type });
  if (error) { await createAdminClient().storage.from('user-files').remove([path]); throw new ValidationError('No tiene permiso para adjuntar archivos aquí.'); }
  await ctx.supabase.from('custom_record_events').insert({ organization_id: orgId, record_id: recordId, kind: 'file', body: file.name.slice(0, 200) });
}

/** ➕ Crear o editar un registro (con estado, responsable, fecha límite, adjunto y aviso por correo). */
export async function saveSystemRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId, m } = await load(fd);
    const data = dataFrom(fd, m);
    const id = str(fd, 'id');
    const extra: Record<string, unknown> = {};
    if (fd.has('assignee_id')) extra.assignee_id = str(fd, 'assignee_id');
    if (fd.has('due_on')) extra.due_on = str(fd, 'due_on');
    if (fd.has('status') && str(fd, 'status')) extra.status = str(fd, 'status');
    const q = id
      ? ctx.supabase.from('custom_records').update({ data, ...extra }).eq('id', id).eq('module_id', m.id).select('id, code, assignee_id').single()
      : ctx.supabase.from('custom_records').insert({ organization_id: orgId, module_id: m.id, data, ...extra }).select('id, code, assignee_id').single();
    const { data: r, error } = await q;
    if (error) return fail(error.code === '42501' ? 'No tiene permiso para guardar en este sistema.' : error);
    const file = fd.get('file');
    if (file instanceof File && file.size) await attach(ctx, orgId, r.id, file);
    let mail = '';
    if (fd.get('send_email') === 'on' && !id) {
      const me = await nameOf(ctx.user.id);
      const first = m.fields[0] ? String(data[m.fields[0].key] ?? '') : '';
      const to = r.assignee_id ? [r.assignee_id] : (await usersWithRoles(orgId, m.edit_roles)).slice(0, 30);
      mail = mailSummary(await noticeToUsers(to.filter((u) => u !== ctx.user.id), { org: orgId, kind: 'sistema', by: ctx.user.id,
        subject: `${m.name}: nuevo registro ${r.code}`, title: `${m.icon} ${m.name} · ${r.code}`, text: `${me} ingresó un nuevo registro${first ? `: ${first}` : ''}.`, link: link(m, r.id) }));
    }
    revalidatePath(`/app/m/${m.slug}`);
    return ok(id ? `Registro ${r.code} actualizado.` : `Registro creado con el código ${r.code}.${mail}`, { id: r.id, code: r.code });
  });
}

/** 🔄 Cambiar estado, responsable o fecha límite, con comentario y aviso por correo. */
export async function manageSystemRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId, m } = await load(fd);
    const id = reqStr(fd, 'id', 'Registro');
    const { data: before } = await ctx.supabase.from('custom_records').select('status, assignee_id, created_by, code').eq('id', id).maybeSingle();
    if (!before) return fail('Registro no encontrado.');
    const patch: Record<string, unknown> = {};
    if (str(fd, 'status')) patch.status = str(fd, 'status');
    if (fd.has('assignee_id')) patch.assignee_id = str(fd, 'assignee_id');
    if (fd.has('due_on')) patch.due_on = str(fd, 'due_on');
    const { error } = await ctx.supabase.from('custom_records').update(patch).eq('id', id).eq('module_id', m.id).select('id').single();
    if (error) return fail(error.code === 'PGRST116' || error.code === '42501' ? 'No tiene permiso para cambiar este registro.' : error);
    const note = str(fd, 'comment');
    if (note) await ctx.supabase.from('custom_record_events').insert({ organization_id: orgId, record_id: id, kind: 'comment', body: note.slice(0, 4000) });
    let mail = '';
    if (fd.get('send_email') === 'on') {
      const changes = [patch.status && patch.status !== before.status ? `Estado: ${statusLabel(m, before.status)} → ${statusLabel(m, patch.status as string)}` : '',
        patch.assignee_id && patch.assignee_id !== before.assignee_id ? `Responsable: ${await nameOf(patch.assignee_id as string)}` : '',
        patch.due_on ? `Fecha límite: ${String(patch.due_on).split('-').reverse().join('-')}` : '', note ? `\n${note}` : ''].filter(Boolean).join('\n');
      const to = [before.created_by, patch.assignee_id ?? before.assignee_id].filter((u): u is string => !!u && u !== ctx.user.id);
      mail = mailSummary(await noticeToUsers(to, { org: orgId, kind: 'sistema', by: ctx.user.id, subject: `${m.name}: actualización de ${before.code}`,
        title: `${m.icon} ${before.code}`, text: `${await nameOf(ctx.user.id)} actualizó el registro.\n\n${changes}`, link: link(m, id) }));
    }
    revalidatePath(`/app/m/${m.slug}`); revalidatePath(`/app/m/${m.slug}/${id}`);
    return ok(`Registro actualizado.${mail}`);
  });
}

/** 💬 Comentario y/o archivo adjunto en un registro. */
export async function commentSystemRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId, m } = await load(fd);
    const id = reqStr(fd, 'id', 'Registro');
    const { data: rec } = await ctx.supabase.from('custom_records').select('code, created_by, assignee_id').eq('id', id).maybeSingle();
    if (!rec) return fail('Registro no encontrado.');
    const body = str(fd, 'body'); const file = fd.get('file');
    if (!body && !(file instanceof File && file.size)) return fail('Escriba un comentario o adjunte un archivo.');
    if (body) { const { error } = await ctx.supabase.from('custom_record_events').insert({ organization_id: orgId, record_id: id, kind: 'comment', body: body.slice(0, 4000) }); if (error) return fail(error); }
    if (file instanceof File && file.size) await attach(ctx, orgId, id, file);
    let mail = '';
    if (fd.get('send_email') === 'on') {
      const to = [rec.created_by, rec.assignee_id].filter((u): u is string => !!u && u !== ctx.user.id);
      mail = mailSummary(await noticeToUsers(to, { org: orgId, kind: 'sistema', by: ctx.user.id, subject: `${m.name}: comentario en ${rec.code}`,
        title: `${m.icon} ${rec.code}`, text: `${await nameOf(ctx.user.id)} comentó:\n\n${body ?? '(adjuntó un archivo)'}`, link: link(m, id) }));
    }
    revalidatePath(`/app/m/${m.slug}/${id}`);
    return ok(`Guardado.${mail}`);
  });
}

export async function deleteSystemFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('custom_record_files').delete().eq('id', reqStr(fd, 'file_id', 'Archivo')).select('path');
    if (error) return fail(error);
    if (!data?.length) return fail('No puede eliminar este archivo.');
    await createAdminClient().storage.from('user-files').remove([data[0].path]);
    revalidatePath(String(fd.get('path') ?? '/app/sistemas'));
    return ok('Archivo eliminado.');
  });
}

export async function deleteSystemRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, m } = await load(fd);
    const { data, error } = await ctx.supabase.from('custom_records').delete().eq('id', reqStr(fd, 'id', 'Registro')).eq('module_id', m.id).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('No tiene permiso para eliminar este registro.');
    revalidatePath(`/app/m/${m.slug}`);
    if (fd.get('after')) redirect(`/app/m/${m.slug}`);
    return ok('Registro eliminado (puede deshacerlo con ↶).');
  });
}
