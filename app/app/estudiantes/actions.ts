'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser } from '@/lib/users';

function personFields(fd: FormData) {
  return {
    first_names: reqStr(fd, 'first_names', 'Nombres'),
    last_names: reqStr(fd, 'last_names', 'Apellidos'),
    id_document_country: reqStr(fd, 'id_document_country', 'País del documento'),
    id_document_type: reqStr(fd, 'id_document_type', 'Tipo de documento'),
    id_document_number: reqStr(fd, 'id_document_number', 'Número de documento').toUpperCase(),
    email: str(fd, 'email')?.toLowerCase() ?? null,
    phone: str(fd, 'phone'),
    birth_date: str(fd, 'birth_date'),
    campus_id: str(fd, 'campus_id'),
  };
}

export async function createStudent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const row = { organization_id: ctx.orgId, student_code: reqStr(fd, 'student_code', 'Código').toUpperCase(), ...personFields(fd) };
    const { data, error } = await ctx.supabase.from('students').insert(row).select('id').single();
    if (error) return fail(error);
    revalidatePath('/app/estudiantes');
    return ok(`Estudiante ${row.first_names} ${row.last_names} registrado.`, data);
  });
}

export async function updateStudent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error, count } = await ctx.supabase.from('students')
      .update({ ...personFields(fd), status: reqStr(fd, 'status', 'Estado') }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos para editar esta ficha.');
    revalidatePath(`/app/estudiantes/${id}`);
    return ok('Ficha actualizada.');
  });
}

/** Crea (o vincula) la cuenta del portal para un estudiante o profesor. */
export async function grantPortalAccess(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const kind = reqStr(fd, 'kind', 'tipo') as 'student' | 'teacher';
    const id = reqStr(fd, 'id', 'id');
    const email = reqStr(fd, 'email', 'Correo').toLowerCase();
    const perm = kind === 'student' ? 'students.edit' : 'teachers.edit';
    if (!can(ctx, perm)) return fail('No tiene permisos para dar acceso.');
    const table = kind === 'student' ? 'students' : 'teachers';
    const { data: person } = await ctx.supabase.from(table).select('first_names, last_names').eq('id', id).maybeSingle();
    if (!person) return fail('Ficha no encontrada.');
    const user = await ensureAuthUser(email, `${person.first_names} ${person.last_names}`, fd.get('invite') ? 'invite' : 'password');
    const { error } = await ctx.supabase.rpc('link_person_account', { p_kind: kind, p_person: id, p_user: user.id });
    if (error) return fail(error);
    revalidatePath(kind === 'student' ? `/app/estudiantes/${id}` : '/app/profesores');
    if ('password' in user && user.password)
      return ok(`Cuenta creada para ${email}. Contraseña temporal (se muestra solo esta vez): ${user.password}`);
    return ok(user.created ? `Invitación enviada a ${email}.` : `Cuenta existente ${email} vinculada.`);
  });
}
