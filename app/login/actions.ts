'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { safeNext } from '@/lib/safe-redirect';
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
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Ingrese su correo.' };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.siteUrl()}/auth/confirm?next=/cambiar-clave` });
  // Misma respuesta exista o no la cuenta (evita enumerar usuarios)
  return { ok: true, message: 'Si el correo está registrado, recibirá un enlace temporal para restablecer la contraseña.' };
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
