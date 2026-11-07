'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function addItem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const copies = Math.max(0, Math.floor(num(fd, 'copies') ?? 0));
    const url = str(fd, 'url');
    if (url && !url.startsWith('https://')) return fail('El enlace debe comenzar con https://');
    const { error } = await ctx.supabase.from('library_items').insert({
      organization_id: ctx.orgId, item_type: str(fd, 'item_type') ?? 'libro', title: reqStr(fd, 'title', 'Título'),
      author: str(fd, 'author'), publisher: str(fd, 'publisher'), year: num(fd, 'year'), isbn: str(fd, 'isbn'),
      category: str(fd, 'category'), course_id: str(fd, 'course_id'), url, description: str(fd, 'description'),
      total_copies: copies, available_copies: copies,
    });
    if (error) return fail(error);
    revalidatePath('/app/biblioteca');
    return ok('Material agregado al catálogo.');
  });
}

export async function loanItem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('library_loan', {
      p_item: reqStr(fd, 'item_id', 'Material'), p_borrower: reqStr(fd, 'borrower_id', 'Lector'), p_due: reqStr(fd, 'due_on', 'Devolución'),
    });
    if (error) return fail(error);
    revalidatePath('/app/biblioteca');
    return ok('Préstamo registrado.');
  });
}

export async function returnLoan(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('library_return', { p_loan: reqStr(fd, 'id', 'id') });
    if (error) return fail(error);
    revalidatePath('/app/biblioteca');
    return ok('Devolución registrada.');
  });
}
