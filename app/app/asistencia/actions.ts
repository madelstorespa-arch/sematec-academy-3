'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';

/** ✅ El estudiante marca su asistencia con el código de la clase (o el QR). */
export async function checkin(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const code = reqStr(fd, 'code', 'Código').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) return fail('El código tiene 6 letras o números.');
    const { data, error } = await ctx.supabase.rpc('checkin_attendance', { p_code: code });
    if (error) return fail(error);
    revalidatePath('/app/asistencia'); revalidatePath('/app/mi');
    return ok(`Asistencia registrada — ${data}.`);
  });
}
