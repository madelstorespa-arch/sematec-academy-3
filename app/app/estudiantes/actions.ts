'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser, tempPassword, checkPassword } from '@/lib/users';
import { createAdminClient } from '@/lib/supabase/admin';
import { workspaceEnabled, createWorkspaceUser } from '@/lib/workspace';

function personFields(fd: FormData) {
  return {
    first_names: reqStr(fd, 'first_names', 'Nombres'),
    last_names: reqStr(fd, 'last_names', 'Apellidos'),
    id_document_country: str(fd, 'id_document_country'),
    id_document_type: str(fd, 'id_document_type'),
    id_document_number: str(fd, 'id_document_number')?.toUpperCase() ?? null,
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
    const chosen = fd.get('invite') ? null : checkPassword(str(fd, 'password'));
    const user = await ensureAuthUser(email, `${person.first_names} ${person.last_names}`, fd.get('invite') ? 'invite' : 'password', chosen ?? undefined);
    const { error } = await ctx.supabase.rpc('link_person_account', { p_kind: kind, p_person: id, p_user: user.id });
    if (error) return fail(error);
    revalidatePath(kind === 'student' ? `/app/estudiantes/${id}` : '/app/profesores');
    if ('password' in user && user.password)
      return ok(`Cuenta creada. Usuario: ${email} · contraseña: la que usted escribió. Entréguesela a la persona.`);
    return ok(user.created ? `Invitación enviada a ${email}.` : `Cuenta existente ${email} vinculada.`);
  });
}

/**
 * Genera una contraseña temporal nueva para la cuenta de portal de un estudiante o profesor.
 * Solo para cuentas cuyo único rol es estudiante/profesor: nunca restablece cuentas administrativas.
 */
export async function resetPortalPassword(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const kind = reqStr(fd, 'kind', 'tipo') as 'student' | 'teacher';
    const id = reqStr(fd, 'id', 'id');
    if (!can(ctx, kind === 'student' ? 'students.edit' : 'teachers.edit')) return fail('No tiene permisos.');
    const table = kind === 'student' ? 'students' : 'teachers';
    // Lectura con RLS: confirma que la ficha pertenece a una institución del usuario actual
    const { data: person } = await ctx.supabase.from(table).select('user_id, email, organization_id').eq('id', id).maybeSingle();
    if (!person?.user_id) return fail('Esta ficha aún no tiene cuenta. Use «Dar acceso».');
    const admin = createAdminClient();
    const { data: roles } = await admin.from('memberships').select('status, roles(code)').eq('user_id', person.user_id);
    const privileged = (roles ?? []).some((m: any) => m.status === 'active' && !['estudiante', 'profesor'].includes(m.roles?.code));
    if (privileged) return fail('La cuenta tiene un rol administrativo: su contraseña solo puede cambiarla su titular.');
    const password = checkPassword(str(fd, 'password'));
    const { error } = await admin.auth.admin.updateUserById(person.user_id, { password });
    if (error) return fail(error.message);
    await admin.from('profiles').update({ status: 'active', status_reason: null }).eq('id', person.user_id).eq('status', 'locked');
    await admin.from('system_events').insert({
      organization_id: person.organization_id, user_id: person.user_id, event_type: 'password_reset_by_admin', severity: 'warning',
      details: { by: ctx.user.id, kind },
    });
    return ok(`Contraseña actualizada para ${person.email}.`);
  });
}

/**
 * Crea un buzón institucional real en Google Workspace y, con esa misma dirección,
 * la cuenta del portal SEMATEC (misma contraseña temporal para ambos).
 */
export async function createInstitutionalAccount(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const kind = reqStr(fd, 'kind', 'tipo') as 'student' | 'teacher';
    const id = reqStr(fd, 'id', 'id');
    if (!can(ctx, kind === 'student' ? 'students.edit' : 'teachers.edit')) return fail('No tiene permisos.');
    if (!workspaceEnabled()) return fail('Google Workspace no está configurado en el servidor.');
    const table = kind === 'student' ? 'students' : 'teachers';
    const { data: person } = await ctx.supabase.from(table).select('first_names, last_names, user_id').eq('id', id).maybeSingle();
    if (!person) return fail('Ficha no encontrada.');
    if (person.user_id) return fail('Esta persona ya tiene cuenta en SEMATEC.');
    const password = str(fd, 'password') ? checkPassword(str(fd, 'password')) : tempPassword();
    const email = await createWorkspaceUser({ firstNames: person.first_names, lastNames: person.last_names, password });
    const { error: upErr } = await ctx.supabase.from(table).update({ email }).eq('id', id);
    if (upErr) return fail(`Correo ${email} creado en Google, pero no se pudo guardar en la ficha: ${upErr.message}`);
    const user = await ensureAuthUser(email, `${person.first_names} ${person.last_names}`, 'password', password);
    const { error } = await ctx.supabase.rpc('link_person_account', { p_kind: kind, p_person: id, p_user: user.id });
    if (error) return fail(error);
    revalidatePath(kind === 'student' ? `/app/estudiantes/${id}` : '/app/profesores');
    return ok(`Correo institucional creado: ${email}. Contraseña temporal para Gmail y SEMATEC (se muestra solo esta vez): ${password}. Google pedirá cambiarla en el primer ingreso.`);
  });
}
