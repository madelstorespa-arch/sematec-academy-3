'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { safeNext } from '@/lib/safe-redirect';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import type { ActionResult } from '@/lib/actions';

/** IP real del visitante (Vercel la entrega en x-real-ip; x-forwarded-for puede ser falsificado por el cliente). */
async function clientIp() {
  const h = await headers();
  const ip = (h.get('x-real-ip') ?? h.get('x-vercel-forwarded-for') ?? (h.get('x-forwarded-for') ?? '').split(',').pop() ?? '').trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : null;
}

export async function signIn(fd: FormData): Promise<ActionResult> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(fd.get('password') ?? '').slice(0, 200);
  const next = safeNext(String(fd.get('next') ?? '/app'));
  if (!email || !password) return { ok: false, error: 'Ingrese correo y contraseña.' };

  const ip = await clientIp();
  try {
    const { data: blocked } = await createAdminClient().rpc('login_ip_blocked', { p_ip: ip });
    if (blocked) return { ok: false, error: 'Demasiados intentos fallidos desde esta red. Por seguridad, espere 15 minutos e intente de nuevo.' };
  } catch { /* si la verificación falla se continúa: el bloqueo por cuenta sigue activo */ }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // Registro del intento fallido y bloqueo automático (SEG-010)
    try {
      const h = await headers();
      await createAdminClient().rpc('record_login_failure', { p_email: email, p_ip: ip, p_user_agent: (h.get('user-agent') ?? '').slice(0, 300) });
    } catch { /* el registro no debe impedir responder */ }
    const code = (error as { code?: string } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    if (error && code !== 'invalid_credentials' && !(status === 400 && !code)) {
      console.error('[login] Supabase Auth', status, code, error.message);
      return { ok: false, error: `No se pudo iniciar sesión: el servicio de autenticación respondió «${code ?? status ?? 'error'}». Si persiste, revise la configuración del proyecto.` };
    }
    return { ok: false, error: 'Correo o contraseña incorrectos.' };
  }
  const { data: profile } = await supabase.from('profiles').select('status').eq('id', data.user.id).maybeSingle();
  if (profile && profile.status !== 'active') {
    await supabase.auth.signOut();
    return { ok: false, error: 'La cuenta está bloqueada o suspendida. Contacte a la administración de su institución.' };
  }
  redirect(next);
}

export async function requestReset(fd: FormData): Promise<ActionResult> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Ingrese un correo válido.' };
  const generic: ActionResult = { ok: true, message: 'Si el correo está registrado, recibirá en unos minutos un enlace para crear una nueva contraseña (revise también «Spam»). El enlace vence en 1 hora.' };
  const ip = await clientIp();
  try {
    const { data: limited } = await createAdminClient().rpc('password_reset_limited', { p_ip: ip, p_email: email });
    if (limited) return { ok: false, error: 'Se pidieron demasiados enlaces. Espere unos minutos e intente de nuevo.' };
  } catch { /* si la verificación falla se continúa */ }

  if (mailEnabled()) {
    // Correo propio: enlace que funciona en cualquier equipo (no depende del navegador donde se pidió)
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
      if (error || !data?.properties?.hashed_token) return generic; // misma respuesta exista o no la cuenta
      const { data: prof } = await admin.from('profiles').select('full_name, status').eq('id', data.user.id).maybeSingle();
      if (prof && prof.status !== 'active') return generic;
      const link = `${env.siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
      const { data: site } = await admin.from('site_settings').select('site_name').limit(1).maybeSingle();
      const brand = site?.site_name ?? 'SEMATEC ACADEMY';
      const hi = prof?.full_name ? `Hola ${prof.full_name.split(' ')[0]},` : 'Hola,';
      await sendMail(email, `${brand}: crear una nueva contraseña`,
        mailLayout(brand, 'Crear una nueva contraseña', `<p>${hi}</p><p>Recibimos una solicitud para restablecer la contraseña de su cuenta. Toque el botón para crear una nueva. El enlace sirve una sola vez y vence en 1 hora.</p>`,
          { href: link, label: 'Crear nueva contraseña' }),
        `${hi}\n\nPara crear una nueva contraseña abra este enlace (vence en 1 hora):\n${link}\n\nSi usted no lo pidió, ignore este correo.`);
    } catch (e) {
      console.error('[recuperar] no se pudo enviar el correo:', (e as Error).message);
      return { ok: false, error: 'No se pudo enviar el correo en este momento. Intente en unos minutos o pida ayuda a la administración.' };
    }
    return generic;
  }
  // Sin correo propio: lo envía Supabase (requiere su configuración de SMTP y de URL del sitio)
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.siteUrl()}/auth/confirm?next=/cambiar-clave` });
  return generic;
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
