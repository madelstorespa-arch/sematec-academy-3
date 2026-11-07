'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser, checkPassword } from '@/lib/users';

const back = () => revalidatePath('/app/personal');

export async function createEmployee(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('employees').insert({
      organization_id: ctx.orgId, campus_id: str(fd, 'campus_id'), employee_code: reqStr(fd, 'employee_code', 'Código').toUpperCase(),
      first_names: reqStr(fd, 'first_names', 'Nombres'), last_names: reqStr(fd, 'last_names', 'Apellidos'),
      id_document_country: reqStr(fd, 'id_document_country', 'País'), id_document_type: reqStr(fd, 'id_document_type', 'Tipo de documento'),
      id_document_number: reqStr(fd, 'id_document_number', 'N° de documento').toUpperCase(), email: str(fd, 'email')?.toLowerCase() ?? null,
      position: reqStr(fd, 'position', 'Cargo'),
    });
    if (error) return fail(error);
    back(); return ok('Funcionario registrado.');
  });
}

export async function addContract(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('employment_contracts').insert({
      organization_id: ctx.orgId, employee_id: reqStr(fd, 'employee_id', 'Funcionario'), contract_type: reqStr(fd, 'contract_type', 'Tipo'),
      starts_on: reqStr(fd, 'starts_on', 'Inicio'), ends_on: str(fd, 'ends_on'), salary_amount: num(fd, 'salary_amount'), currency: 'CLP',
    });
    if (error) return fail(error);
    back(); return ok('Contrato registrado.');
  });
}

/** Crea la cuenta del funcionario (contraseña elegida por el administrador), le asigna un rol y la vincula a su ficha. */
export async function createEmployeeAccount(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'employees.edit')) return fail('No autorizado.');
    if (!can(ctx, 'security.admin') || ctx.aal !== 'aal2') return fail('Crear cuentas requiere permiso de seguridad y sesión con MFA.');
    const id = reqStr(fd, 'id', 'id');
    const { data: e } = await ctx.supabase.from('employees').select('email, first_names, last_names, user_id').eq('id', id).maybeSingle();
    if (!e?.email) return fail('La ficha no tiene correo: agréguelo primero.');
    const pw = str(fd, 'password');
    const user = await ensureAuthUser(e.email, `${e.first_names} ${e.last_names}`, 'password', pw ? checkPassword(pw) : undefined);
    if (user.created && !pw) return fail('Escriba la contraseña para la cuenta nueva.');
    const { error: e1 } = await ctx.supabase.rpc('grant_membership', { p_user: user.id, p_org: ctx.orgId, p_role_code: reqStr(fd, 'role', 'Rol'), p_campus: null, p_valid_until: null });
    if (e1) return fail(e1);
    const { error } = await ctx.supabase.from('employees').update({ user_id: user.id }).eq('id', id);
    if (error) return fail(error);
    back();
    return ok(user.created ? `Cuenta creada. Usuario: ${e.email} · contraseña: la que usted escribió.` : `Cuenta existente ${e.email} vinculada y con el rol asignado.`);
  });
}

export async function clock(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('clock', { p_org: ctx.orgId, p_out: fd.get('out') === '1' });
    if (error) return fail(error);
    back(); return ok(String(data));
  });
}

export async function requestLeave(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('leave_requests').insert({
      organization_id: ctx.orgId, employee_id: reqStr(fd, 'employee_id', 'ficha'), kind: reqStr(fd, 'kind', 'Tipo'),
      starts_on: reqStr(fd, 'starts_on', 'Desde'), ends_on: reqStr(fd, 'ends_on', 'Hasta'), reason: str(fd, 'reason'),
    });
    if (error) return fail(error);
    back(); return ok('Solicitud enviada a RR. HH.');
  });
}

export async function decideLeave(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const approve = fd.get('approve') === '1';
    const { error } = await ctx.supabase.rpc('decide_leave', { p_leave: reqStr(fd, 'id', 'id'), p_approve: approve });
    if (error) return fail(error);
    back(); return ok(approve ? 'Solicitud aprobada.' : 'Solicitud rechazada.');
  });
}
