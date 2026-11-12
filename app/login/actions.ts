'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { safeNext } from '@/lib/safe-redirect';
import { sendRecoveryTo, type Account } from '@/lib/recovery';
import { getPublicSite } from '@/lib/site';
import type { ActionResult } from '@/lib/actions';

/** IP real del visitante (Vercel la entrega en x-real-ip; x-forwarded-for puede ser falsificado por el cliente). */
async function clientIp() {
  const h = await headers();
  const ip = (h.get('x-real-ip') ?? h.get('x-vercel-forwarded-for') ?? (h.get('x-forwarded-for') ?? '').split(',').pop() ?? '').trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : null;
}

export async function signIn(fd: FormData): Promise<ActionResult> {
  let email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(fd.get('password') ?? '').slice(0, 200);
  const next = safeNext(String(fd.get('next') ?? '/app'));
  if (!email || !password) return { ok: false, error: 'Ingrese su correo o RUT y la contraseña.' };
  // También se puede entrar con el RUT (o pasaporte) registrado en «Mi cuenta»
  if (!email.includes('@')) {
    const { data: byDoc } = await createAdminClient().rpc('email_for_document', { p_doc: email.slice(0, 30) }).then((r) => r, () => ({ data: null }));
    email = typeof byDoc === 'string' && byDoc ? byDoc : `${email.replace(/[^0-9k]/g, '') || 'x'}@rut.invalido`;
  }

  const ip = await clientIp();
  try {
    const { data: blocked } = await createAdminClient().rpc('login_ip_blocked', { p_ip: ip });
    if (blocked) return { ok: false, error: 'Demasiados intentos fallidos desde esta red. Por seguridad, espere 15 minutos e intente de nuevo.' };
  } catch { /* si la verificación falla se continúa: el bloqueo por cuenta sigue activo */ }

  // Cuenta bloqueada por intentos fallidos: se desbloquea sola a los 15 minutos (o al recuperar la contraseña)
  try {
    const { data: pre } = await createAdminClient().rpc('login_precheck', { p_email: email });
    const p = pre as { exists?: boolean; status?: string; until?: string | null; by_failures?: boolean } | null;
    if (p?.exists && p.status === 'locked' && p.by_failures) {
      const hh = p.until ? new Date(p.until).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }) : '';
      return { ok: false, error: `Cuenta bloqueada por varios intentos fallidos${hh ? ` hasta las ${hh}` : ''}. Espere o use «¿Olvidó su contraseña?»: al crear una nueva se desbloquea.` };
    }
  } catch { /* si la verificación falla se continúa */ }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // Registro del intento fallido y bloqueo automático (SEG-010)
    let fails = 0; let locked = false;
    try {
      const h = await headers();
      const { data: rf } = await createAdminClient().rpc('record_login_failure', { p_email: email, p_ip: ip, p_user_agent: (h.get('user-agent') ?? '').slice(0, 300) });
      fails = Number((rf as { failures_in_window?: number } | null)?.failures_in_window ?? 0); locked = !!(rf as { locked?: boolean } | null)?.locked;
    } catch { /* el registro no debe impedir responder */ }
    const code = (error as { code?: string } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    if (error && code !== 'invalid_credentials' && !(status === 400 && !code)) {
      console.error('[login] Supabase Auth', status, code, error.message);
      return { ok: false, error: `No se pudo iniciar sesión: el servicio de autenticación respondió «${code ?? status ?? 'error'}». Si persiste, revise la configuración del proyecto.` };
    }
    if (locked) return { ok: false, error: 'Correo o contraseña incorrectos. Por seguridad, la cuenta quedó bloqueada 15 minutos. Puede usar «¿Olvidó su contraseña?» para crear una nueva y entrar de inmediato.' };
    if (fails >= 3) return { ok: false, error: `Correo o contraseña incorrectos. Le quedan ${Math.max(1, 5 - fails)} intento(s) antes de un bloqueo de 15 minutos. Si no la recuerda, use «¿Olvidó su contraseña?».` };
    return { ok: false, error: 'Correo o contraseña incorrectos.' };
  }
  const { data: profile } = await supabase.from('profiles').select('status, preferences').eq('id', data.user.id).maybeSingle();
  if (profile && profile.status !== 'active') {
    await supabase.auth.signOut();
    return { ok: false, error: 'La cuenta está bloqueada o suspendida. Contacte a la administración de su institución.' };
  }
  // Página de inicio elegida por la persona en «Mi configuración»
  const home = (profile?.preferences as { home?: string } | null)?.home;
  redirect(next === '/app' && typeof home === 'string' && /^\/app(\/[a-z0-9/_-]*)?$/.test(home) ? home : next);
}

/**
 * 🔑 Recuperar contraseña (cualquier usuario): con su correo o su RUT. Siempre responde lo mismo, exista o no la
 * cuenta, para no revelar quién está registrado.
 */
export async function requestReset(fd: FormData): Promise<ActionResult> {
  const raw = String(fd.get('email') ?? '').trim().slice(0, 254);
  if (raw.length < 5) return { ok: false, error: 'Ingrese su correo o su RUT.' };
  if (raw.includes('@') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) return { ok: false, error: 'El correo no es válido.' };
  if (!raw.includes('@') && raw.replace(/[^0-9Kk]/g, '').length < 7) return { ok: false, error: 'El RUT no es válido. Escríbalo con dígito verificador, por ejemplo 12.345.678-5.' };
  const generic: ActionResult = { ok: true, message: 'Si la cuenta existe, recibirá en unos minutos, en el correo registrado, un enlace para crear una nueva contraseña (revise también «Spam»). Vence en 1 hora. ¿No tiene correo o no le llega? Use «No tengo acceso a mi correo» más abajo.' };
  const ip = await clientIp();
  const admin = createAdminClient();
  try {
    const { data: limited } = await admin.rpc('password_reset_limited', { p_ip: ip, p_email: raw.toLowerCase() });
    if (limited) return { ok: false, error: 'Se pidieron demasiados enlaces. Espere unos minutos e intente de nuevo.' };
  } catch { /* si la verificación falla se continúa */ }
  try {
    const { data: acc } = await admin.rpc('find_account', { p_identifier: raw });
    const account = (acc as Account[] | null)?.[0];
    // Sin cuenta o cuenta no activa: misma respuesta (no se revela si el correo existe)
    if (!account) return generic;
    const email = account.login_email ?? account.email;
    if (!email) return generic;
    const r = await sendRecoveryTo(account);
    if (r === 'mail_off') {
      // Sin correo propio configurado: lo intenta Supabase (solo llega si el proyecto tiene su propio SMTP configurado)
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.siteUrl()}/auth/confirm?next=/cambiar-clave` });
    }
  } catch (e) {
    console.error('[recuperar] no se pudo enviar el correo:', (e as Error).message);
    return { ok: false, error: 'No se pudo enviar el correo en este momento. Use «No tengo acceso a mi correo» y la administración le ayudará.' };
  }
  return generic;
}

/**
 * 🆘 «No tengo acceso a mi correo»: la persona deja sus datos y la administración de su institución le da una
 * contraseña temporal o le reenvía el enlace. Sirve para estudiantes sin correo, correos antiguos o celular de MFA perdido.
 */
export async function requestHelp(fd: FormData): Promise<ActionResult> {
  const clean = (k: string, max: number) => String(fd.get(k) ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const identifier = clean('identifier', 254), name = clean('full_name', 160), contact = clean('contact', 160), message = clean('message', 1000);
  const reason = ['sin_correo', 'no_llega', 'mfa', 'otro'].includes(String(fd.get('reason'))) ? String(fd.get('reason')) : 'otro';
  if (identifier.length < 5) return { ok: false, error: 'Ingrese su RUT o el correo con que entra.' };
  if (name.length < 3) return { ok: false, error: 'Ingrese su nombre completo.' };
  if (contact.replace(/[^0-9@a-z]/gi, '').length < 5) return { ok: false, error: 'Ingrese un teléfono o correo donde podamos contactarle.' };
  const ip = await clientIp();
  const admin = createAdminClient();
  try {
    const { data: limited } = await admin.rpc('password_help_limited', { p_ip: ip, p_identifier: identifier });
    if (limited) return { ok: false, error: 'Ya envió varias solicitudes. La administración las revisará; espere a que le contacten.' };
    const { data: acc } = await admin.rpc('find_account', { p_identifier: identifier });
    const a = (acc as { user_id: string; organization_id: string | null }[] | null)?.[0];
    let org = a?.organization_id ?? null;
    if (!org) { // cuenta no encontrada: la solicitud llega a la institución dueña de este sitio web, para que contacten a la persona
      const site = await getPublicSite();
      org = (site as { organization_id?: string } | null)?.organization_id ?? null;
      if (!org) { const { data: orgs } = await admin.from('organizations').select('id').limit(2); if (orgs?.length === 1) org = orgs[0].id; }
    }
    const { error } = await admin.from('password_help_requests').insert({
      identifier, full_name: name, contact, message: message || null, reason, ip,
      user_id: a?.user_id ?? null, organization_id: org,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error('[recuperar-ayuda]', (e as Error).message);
    return { ok: false, error: 'No se pudo enviar la solicitud. Intente en unos minutos o acérquese a la oficina de su institución.' };
  }
  return { ok: true, message: 'Solicitud enviada a la administración de su institución. Le contactarán al teléfono o correo que indicó para darle una contraseña temporal. Por seguridad, le pedirán confirmar su identidad.' };
}

export async function changePassword(fd: FormData): Promise<ActionResult> {
  const pass = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  if (pass.length < 12 || !/[A-Z]/.test(pass) || !/[a-z]/.test(pass) || !/[0-9]/.test(pass))
    return { ok: false, error: 'La contraseña debe tener al menos 12 caracteres, con mayúsculas, minúsculas y números.' };
  if (pass !== confirm) return { ok: false, error: 'Las contraseñas no coinciden.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pass });
  if (error) return { ok: false, error: error.code === 'insufficient_aal' ? 'Verifique su segundo factor (MFA) antes de cambiar la contraseña.' : error.message };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await createAdminClient().rpc('unlock_after_password_reset', { p_user: user.id }); // quita el bloqueo por intentos fallidos
  } catch { /* no impide el cambio */ }
  return { ok: true, message: 'Contraseña actualizada.' };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

export async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login');
}
