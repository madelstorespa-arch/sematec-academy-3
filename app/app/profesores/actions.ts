'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { checkPassword } from '@/lib/users';
import { createAndLinkAccount } from '@/lib/accounts';

export async function createTeacher(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const row = {
      organization_id: ctx.orgId,
      teacher_code: reqStr(fd, 'teacher_code', 'Código').toUpperCase(),
      first_names: reqStr(fd, 'first_names', 'Nombres'),
      last_names: reqStr(fd, 'last_names', 'Apellidos'),
      email: reqStr(fd, 'email', 'Correo').toLowerCase(),
      academic_degree: str(fd, 'academic_degree'),
      specialty: str(fd, 'specialty'),
      campus_id: str(fd, 'campus_id'),
    };
    const password = checkPassword(str(fd, 'password'));
    const { data, error } = await ctx.supabase.from('teachers').insert(row).select('id').single();
    if (error) return fail(error);
    revalidatePath('/app/profesores');
    try {
      const created = await createAndLinkAccount('teacher', data.id, row.email, `${row.first_names} ${row.last_names}`, password);
      return ok(`Profesor ${row.first_names} ${row.last_names} registrado con su cuenta. Usuario: ${row.email}${created ? ' · contraseña: la que usted escribió.' : ' (la cuenta ya existía y conserva su contraseña).'}`);
    } catch (e) {
      return ok(`Profesor registrado, pero no se pudo crear la cuenta: ${(e as Error).message}. Créela con «🔑 Crear cuenta».`);
    }
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
