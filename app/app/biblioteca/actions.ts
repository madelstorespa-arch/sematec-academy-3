'use server';
import { revalidatePath } from 'next/cache';
import { saveLibraryFile } from '@/lib/lms';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

function visibility(fd: FormData) {
  return {
    visible_roles: fd.get('vis_mode') === 'roles' ? fd.getAll('visible_roles').map(String).filter((r) => /^[a-z_]{3,40}$/.test(r)) : [],
    hidden_users: [...new Set(fd.getAll('hidden_users').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)))],
  };
}

/** 👁 Cambia quién puede ver un libro o documento. */
export async function setVisibility(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const v = visibility(fd);
    if (fd.get('vis_mode') === 'roles' && !v.visible_roles.length) return fail('Elija al menos un rol, o «Todos».');
    const { error, count } = await ctx.supabase.from('library_items').update(v, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permiso para editar la biblioteca.');
    revalidatePath('/app/biblioteca');
    return ok(v.visible_roles.length || v.hidden_users.length ? 'Listo: el material quedó restringido.' : 'Listo: el material es visible para todos.');
  });
}

export async function addItem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const copies = Math.max(0, Math.floor(num(fd, 'copies') ?? 0));
    const url = str(fd, 'url');
    if (url && !url.startsWith('https://')) return fail('El enlace debe comenzar con https://');
    if (!str(fd, 'program_id') && !str(fd, 'course_id') && !str(fd, 'section_id'))
      return fail('Asocie el libro al menos a una carrera, asignatura o curso/sección.');
    let fileId: string | null = null;
    try { fileId = await saveLibraryFile(ctx, fd.get('file') as File | null); } catch (e) { return fail((e as Error).message); }
    const { error } = await ctx.supabase.from('library_items').insert({
      program_id: str(fd, 'program_id'), section_id: str(fd, 'section_id'), file_id: fileId,
      organization_id: ctx.orgId, item_type: str(fd, 'item_type') ?? 'libro', title: reqStr(fd, 'title', 'Título'),
      author: str(fd, 'author'), publisher: str(fd, 'publisher'), year: num(fd, 'year'), isbn: str(fd, 'isbn'),
      category: str(fd, 'category'), course_id: str(fd, 'course_id'), url, description: str(fd, 'description'),
      total_copies: copies, available_copies: copies, ...visibility(fd),
    });
    if (error) return fail(error);
    revalidatePath('/app/biblioteca');
    return ok(fileId || url ? 'Libro virtual agregado: ya lo ven los estudiantes de la carrera, asignatura o curso elegido.' : 'Material agregado al catálogo.');
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
