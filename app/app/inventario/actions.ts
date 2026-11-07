'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function addItem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('inventory_items').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      category: str(fd, 'category') ?? 'otro', brand: str(fd, 'brand'), model: str(fd, 'model'), serial_number: str(fd, 'serial_number'),
      campus_id: str(fd, 'campus_id'), room_id: str(fd, 'room_id'), assigned_to: str(fd, 'assigned_to'),
      purchase_date: str(fd, 'purchase_date'), purchase_value: num(fd, 'purchase_value'), notes: str(fd, 'notes'),
    });
    if (error) return fail(error.code === '23505' ? 'Ya existe un bien con ese código.' : error);
    revalidatePath('/app/inventario'); return ok('Bien ingresado al inventario.');
  });
}

export async function updateItem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('inventory_items').update({
      status: reqStr(fd, 'status', 'Estado'), room_id: str(fd, 'room_id'), assigned_to: str(fd, 'assigned_to'),
    }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    revalidatePath('/app/inventario'); return ok('Actualizado (queda en el historial).');
  });
}
