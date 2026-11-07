'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';

/** Emite o renueva la credencial estudiantil (el propio estudiante o personal con students.edit). */
export async function issueCredential(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('issue_credential', { p_student: reqStr(fd, 'student_id', 'estudiante') });
    if (error) return fail(error);
    revalidatePath('/app/credencial');
    return ok('Credencial emitida.');
  });
}
