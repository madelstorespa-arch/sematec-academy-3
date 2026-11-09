'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/safe-redirect';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';

/** Suspender, reactivar o eliminar cualquier registro (solo propietario institucional; validado en la base). */
export async function ownerManage(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const op = reqStr(fd, 'op', 'operación');
    const { data, error } = await ctx.supabase.rpc('owner_manage', { p_table: reqStr(fd, 'table', 'módulo'), p_id: reqStr(fd, 'id', 'id'), p_op: op });
    if (error) return fail(error);
    const path = String(fd.get('path') ?? '');
    if (path.startsWith('/app')) revalidatePath(path);
    revalidatePath('/app', 'layout');
    const after = fd.get('after');
    if (op === 'delete' && after) redirect(safeNext(String(after)));
    return ok(`Registro ${data}.`);
  });
}
