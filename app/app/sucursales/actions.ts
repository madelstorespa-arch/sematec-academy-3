'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';

/** ⚙ Datos de una sucursal (solo el propietario). */
export async function saveBranch(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner) throw new ValidationError('Solo el propietario cambia los datos de las sucursales.');
    const email = str(fd, 'email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('El correo no es válido.');
    const { data, error } = await ctx.supabase.from('campuses').update({
      phone: str(fd, 'phone')?.slice(0, 40) ?? null, email, address: str(fd, 'address')?.slice(0, 300) ?? null,
      receipt_footer: str(fd, 'receipt_footer')?.slice(0, 300) ?? null, store_enabled: fd.getAll('store_enabled').includes('on'),
    }).eq('id', reqStr(fd, 'id', 'sucursal')).eq('organization_id', ctx.orgId!).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('No tiene permiso para cambiar esa sucursal.');
    revalidatePath('/app/sucursales');
    return ok('Datos de la sucursal guardados.');
  });
}
