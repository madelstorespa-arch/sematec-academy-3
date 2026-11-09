'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';

export type UndoItem = { tx: string; label: string; at: string } | null;
export type UndoStatus = { undo: UndoItem; redo: UndoItem };

/** Estado de la barra ↶ ↷: qué se puede deshacer o rehacer ahora (cambios propios de la última hora). */
export async function getUndoStatus(): Promise<UndoStatus> {
  const ctx = await getContext();
  if (!ctx.orgId) return { undo: null, redo: null };
  const { data } = await ctx.supabase.rpc('undo_status', { p_org: ctx.orgId });
  return (data as UndoStatus) ?? { undo: null, redo: null };
}

/** ↶ Deshacer la última acción propia. */
export async function undoLast(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Sin institución activa.');
    const { data, error } = await ctx.supabase.rpc('undo_last', { p_org: ctx.orgId });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok(`Deshecho: ${data}.`);
  });
}

/** ↷ Rehacer lo último que se deshizo. */
export async function redoLast(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Sin institución activa.');
    const { data, error } = await ctx.supabase.rpc('redo_last', { p_org: ctx.orgId });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok(`Rehecho: ${data}.`);
  });
}

/** ♻ Restaurar desde la papelera (solo propietario; validado en la base). */
export async function restoreChange(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Sin institución activa.');
    const tx = reqStr(fd, 'tx', 'cambio');
    if (!/^\d+$/.test(tx)) return fail('Cambio inválido.');
    const { data, error } = await ctx.supabase.rpc('restore_change', { p_org: ctx.orgId, p_tx: tx });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok(`Restaurado: ${data}.`);
  });
}

/** ↺ Volver a una versión anterior de un registro (solo propietario; validado en la base). */
export async function restoreVersion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const ev = reqStr(fd, 'event', 'versión');
    if (!/^\d+$/.test(ev)) return fail('Versión inválida.');
    const { data, error } = await ctx.supabase.rpc('restore_version', { p_event: Number(ev) });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok(`Se restauró la versión de ${data}.`);
  });
}
