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
