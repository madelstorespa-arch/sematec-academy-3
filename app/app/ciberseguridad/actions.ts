'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';

const back = () => revalidatePath('/app/ciberseguridad', 'layout');

export async function revokeSessions(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('security_revoke_sessions', { p_org: ctx.orgId, p_user: reqStr(fd, 'user_id', 'usuario'), p_reason: str(fd, 'reason') ?? 'Cierre de sesiones desde el Centro de Ciberseguridad' });
    if (error) return fail(error);
    back(); return ok(`Se cerraron ${data} sesión(es). El acceso termina como máximo en 1 hora; para cortarlo de inmediato, bloquee la cuenta.`);
  });
}

export async function setAccount(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const lock = fd.get('lock') === '1';
    const { error } = await ctx.supabase.rpc('security_set_account', { p_org: ctx.orgId, p_user: reqStr(fd, 'user_id', 'usuario'), p_lock: lock, p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    back(); return ok(lock ? 'Cuenta bloqueada: ya no puede acceder a ningún dato y sus sesiones se cerraron.' : 'Cuenta desbloqueada.');
  });
}

export async function openIncident(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('security_open_incident', {
      p_org: ctx.orgId, p_title: reqStr(fd, 'title', 'Título'), p_severity: reqStr(fd, 'severity', 'Gravedad'),
      p_category: reqStr(fd, 'category', 'Categoría'), p_description: str(fd, 'description') ?? '', p_user: str(fd, 'user_id'),
    });
    if (error) return fail(error);
    back(); return ok(`Incidente N° ${data} registrado.`);
  });
}

export async function updateIncident(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('security_update_incident', { p_id: reqStr(fd, 'id', 'id'), p_status: reqStr(fd, 'status', 'Estado'), p_note: reqStr(fd, 'note', 'Bitácora') });
    if (error) return fail(error);
    back(); return ok('Incidente actualizado.');
  });
}

export async function verifyIntegrity(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const [{ data: chain, error }, { data: ov }] = await Promise.all([
      ctx.supabase.rpc('verify_audit_chain', { p_org: ctx.orgId }),
      ctx.supabase.rpc('security_overview', { p_org: ctx.orgId }),
    ]);
    if (error) return fail(error);
    const r = (chain as any[])[0]; const t = Number((ov as any)?.certificates_tampered ?? 0);
    if (!r.ok) return fail(`¡ALERTA! Auditoría alterada desde el evento N° ${r.first_broken_seq}. Registre un incidente.`);
    if (t) return fail(`¡ALERTA! ${t} certificado(s) no coinciden con su huella SHA-256. Registre un incidente.`);
    return ok(`Integridad correcta: ${r.checked} eventos de auditoría y todos los certificados verificados.`);
  });
}
