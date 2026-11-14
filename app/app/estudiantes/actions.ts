'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { docFields, fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser, tempPassword, checkPassword } from '@/lib/users';
import { createAdminClient } from '@/lib/supabase/admin';
import { workspaceEnabled, createWorkspaceUser } from '@/lib/workspace';
import { createAndLinkAccount } from '@/lib/accounts';

function personFields(fd: FormData, docRequired = false) {
  return {
    ...docFields(fd, docRequired),
    first_names: reqStr(fd, 'first_names', 'Nombres'),
    last_names: reqStr(fd, 'last_names', 'Apellidos'),
    email: str(fd, 'email')?.toLowerCase() ?? null,
    phone: str(fd, 'phone'),
    birth_date: str(fd, 'birth_date'),
    campus_id: str(fd, 'campus_id'),
  };
}

export async function createStudent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const email = reqStr(fd, 'email', 'Correo (será su usuario)').toLowerCase();
    const password = checkPassword(str(fd, 'password')); // validar antes de crear la ficha
    const row = { organization_id: ctx.orgId, student_code: reqStr(fd, 'student_code', 'Código').toUpperCase(), ...personFields(fd, true), email };
    const { data, error } = await ctx.supabase.from('students').insert(row).select('id').single();
    if (error) return fail(error);
    revalidatePath('/app/estudiantes');
    try {
      const created = await createAndLinkAccount('student', data.id, email, `${row.first_names} ${row.last_names}`, password);
      return ok(`Estudiante ${row.first_names} ${row.last_names} registrado con su cuenta. Usuario: ${email}${created ? ' · contraseña: la que usted escribió.' : ' (la cuenta ya existía y conserva su contraseña).'}`, data);
    } catch (e) {
      return ok(`Estudiante registrado, pero no se pudo crear la cuenta: ${(e as Error).message}. Créela desde su ficha con «🔑 Crear cuenta».`, data);
    }
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
    const { data: person } = await ctx.supabase.from(table).select('first_names, last_names, organization_id').eq('id', id).maybeSingle();
    if (!person) return fail('Ficha no encontrada.');
    const chosen = fd.get('invite') ? null : checkPassword(str(fd, 'password'));
    const user = await ensureAuthUser(email, `${person.first_names} ${person.last_names}`, fd.get('invite') ? 'invite' : 'password', chosen ?? undefined);
    // Ese correo ya es la cuenta de OTRA ficha de esta institución (ficha duplicada o persona distinta)
    const { data: other } = await ctx.supabase.from(table).select('id, first_names, last_names, email')
      .eq('organization_id', person.organization_id).eq('user_id', user.id).neq('id', id).maybeSingle();
    if (other) {
      const who = `${other.first_names} ${other.last_names}`.trim();
      if (!fd.get('move')) {
        return fail(`El correo ${email} ya es la cuenta de otra ficha de ${kind === 'student' ? 'estudiante' : 'profesor'} en esta institución: «${who}». `
          + `Si es la misma persona (ficha duplicada), marque «Mover la cuenta a esta ficha» y pulse otra vez «Crear cuenta»; si es otra persona, use un correo distinto.`);
      }
      const { error: e0, count } = await ctx.supabase.from(table).update({ user_id: null }, { count: 'exact' }).eq('id', other.id);
      if (e0) return fail(e0);
      if (!count) return fail('No se pudo soltar la cuenta de la otra ficha (sin permiso).');
    }
    const { error } = await ctx.supabase.rpc('link_person_account', { p_kind: kind, p_person: id, p_user: user.id });
    if (error) return fail(error);
    if (other) {
      revalidatePath(kind === 'student' ? `/app/estudiantes/${other.id}` : '/app/profesores');
      return ok(`Cuenta ${email} movida a esta ficha (se quitó de «${`${other.first_names} ${other.last_names}`.trim()}»). Si la otra ficha era un duplicado, puede eliminarla.${!user.created && chosen ? ' Su contraseña sigue siendo la de antes: use «🔑 Cambiar» en esta ficha si necesita una nueva.' : ''}`);
    }
    revalidatePath(kind === 'student' ? `/app/estudiantes/${id}` : '/app/profesores');
    if ('password' in user && user.password)
      return ok(`Cuenta creada. Usuario: ${email} · contraseña: la que usted escribió. Entréguesela a la persona.`);
    return ok(user.created ? `Invitación enviada a ${email}.` : `Cuenta existente ${email} vinculada.${chosen ? ' Su contraseña sigue siendo la de antes: use «🔑 Cambiar» si necesita una nueva.' : ''}`);
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
