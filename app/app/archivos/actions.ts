'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';

const id = (fd: FormData) => { const v = reqStr(fd, 'id', 'archivo'); if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error('Archivo inválido'); return v; };

/** 🗑 Eliminar: deja de verse, pero el propietario lo ve en el historial. */
export async function deleteFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('delete_user_file', { p_id: id(fd) });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Archivo eliminado. (El propietario de la institución conserva el historial.)');
  });
}

export async function restoreFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('restore_user_file', { p_id: id(fd) });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Archivo restaurado: su dueño vuelve a verlo.');
  });
}

/** ✖ Eliminar definitivamente (solo propietario): borra el registro y el archivo del almacenamiento. */
export async function purgeFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner) return fail('Solo el propietario puede eliminar definitivamente.');
    const { data: path, error } = await ctx.supabase.rpc('purge_user_file', { p_id: id(fd) });
    if (error) return fail(error);
    const rm = await createAdminClient().storage.from('user-files').remove([String(path)]);
    revalidatePath('/app/archivos');
    return ok(rm.error ? `Registro eliminado; el archivo no se pudo borrar del almacenamiento (${rm.error.message}).` : 'Eliminado definitivamente.');
  });
}

// ---------- 📂 Carpetas ----------
const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const folderName = (fd: FormData) => {
  const n = reqStr(fd, 'name', 'Nombre de la carpeta').replace(/[\\/<>]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) throw new Error('Escriba el nombre de la carpeta.');
  return n;
};
const dupMsg = (e: { code?: string; message: string }) => (e.code === '23505' ? 'Ya existe una carpeta con ese nombre aquí.' : e.message);

export async function createFolder(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Sin institución.');
    const color = String(fd.get('color') ?? 'amber');
    const { error } = await ctx.supabase.from('file_folders').insert({
      organization_id: ctx.orgId, owner_id: ctx.user.id, parent_id: uuid(String(fd.get('parent_id') ?? '')), name: folderName(fd),
      color: ['amber', 'blue', 'green', 'red', 'purple', 'slate'].includes(color) ? color : 'amber',
    });
    if (error) return fail(dupMsg(error));
    revalidatePath('/app/archivos');
    return ok('Carpeta creada.');
  });
}

export async function renameFolder(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('file_folders').update({ name: folderName(fd) }).eq('id', id(fd)).eq('owner_id', ctx.user.id).select('id');
    if (error) return fail(dupMsg(error));
    if (!data?.length) return fail('Solo puede cambiar sus propias carpetas.');
    revalidatePath('/app/archivos');
    return ok('Carpeta renombrada.');
  });
}

/** Elimina la carpeta (y sus subcarpetas). Los archivos NO se borran: vuelven a «Mis archivos». */
export async function deleteFolder(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.from('file_folders').delete().eq('id', id(fd)).eq('owner_id', ctx.user.id).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('Solo puede eliminar sus propias carpetas.');
    revalidatePath('/app/archivos');
    return ok('Carpeta eliminada. Sus archivos quedaron en «Mis archivos».');
  });
}

export async function moveFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('move_user_file', { p_id: id(fd), p_folder: uuid(String(fd.get('folder_id') ?? '')) });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Archivo movido.');
  });
}

export async function renameFile(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('rename_user_file', { p_id: id(fd), p_name: reqStr(fd, 'name', 'Nombre') });
    if (error) return fail(error);
    revalidatePath('/app/archivos');
    return ok('Nombre cambiado.');
  });
}
