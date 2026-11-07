'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

export async function createTeacher(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const row = {
      organization_id: ctx.orgId,
      teacher_code: reqStr(fd, 'teacher_code', 'Código').toUpperCase(),
      first_names: reqStr(fd, 'first_names', 'Nombres'),
      last_names: reqStr(fd, 'last_names', 'Apellidos'),
      id_document_country: str(fd, 'id_document_country'),
      id_document_type: str(fd, 'id_document_type'),
      id_document_number: str(fd, 'id_document_number')?.toUpperCase() ?? null,
      email: reqStr(fd, 'email', 'Correo').toLowerCase(),
      academic_degree: str(fd, 'academic_degree'),
      specialty: str(fd, 'specialty'),
      campus_id: str(fd, 'campus_id'),
    };
    const { error } = await ctx.supabase.from('teachers').insert(row);
    if (error) return fail(error);
    revalidatePath('/app/profesores');
    return ok(`Profesor ${row.first_names} ${row.last_names} registrado.`);
  });
}

export async function setTeacherStatus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('teachers').update({ status: reqStr(fd, 'status', 'Estado') }, { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath('/app/profesores');
    return ok('Estado actualizado.');
  });
}
