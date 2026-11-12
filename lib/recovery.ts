import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';

export type RecoveryResult = 'sent' | 'no_account' | 'not_allowed' | 'mail_off';

/**
 * Envía el enlace para crear una nueva contraseña (sirve en cualquier equipo, una sola vez, 1 hora).
 * Las cuentas bloqueadas por intentos fallidos SÍ lo reciben (recuperar la contraseña las desbloquea);
 * las suspendidas o bloqueadas por la administración no.
 */
export async function sendRecoveryLink(email: string): Promise<RecoveryResult> {
  if (!mailEnabled()) return 'mail_off';
  const admin = createAdminClient();
  const { data } = await admin.rpc('find_account', { p_identifier: email });
  const acc = (data as Account[] | null)?.[0];
  if (!acc) return 'no_account';
  return sendRecoveryTo(acc);
}

export type Account = { user_id: string; email: string | null; full_name: string | null; status: string; organization_id: string | null; login_email: string | null; send_to: string | null };

/** ¿La cuenta puede recuperar su contraseña? Activa, o bloqueada solo por intentos fallidos. */
export async function canRecover(userId: string) {
  const { data: prof } = await createAdminClient().from('profiles').select('status, status_reason').eq('id', userId).maybeSingle();
  return !!prof && (prof.status === 'active' || (prof.status === 'locked' && String(prof.status_reason ?? '').startsWith('Bloqueo por intentos fallidos')));
}

/**
 * Envía el enlace para crear una nueva contraseña a una cuenta activa.
 * El enlace se genera con el correo de inicio de sesión y se envía al correo registrado que escribió la persona
 * (perfil, ficha de estudiante, profesor o funcionario) o, si escribió su RUT, al correo principal de la cuenta.
 */
export async function sendRecoveryTo(acc: Account): Promise<RecoveryResult> {
  if (!mailEnabled()) return 'mail_off';
  if (!(await canRecover(acc.user_id))) return 'not_allowed';
  const admin = createAdminClient();
  const login = acc.login_email ?? acc.email;
  const to = acc.send_to ?? acc.email ?? login;
  if (!login || !to) return 'no_account';
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: login });
  if (error || !data?.properties?.hashed_token) throw new Error(`No se pudo generar el enlace de recuperación: ${error?.message ?? 'sin respuesta de Supabase'}`);
  const link = `${env.siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
  const { data: site } = await admin.from('site_settings').select('site_name').limit(1).maybeSingle();
  const brand = site?.site_name ?? 'SEMATEC ACADEMY';
  const hi = acc.full_name ? `Hola ${acc.full_name.split(' ')[0]},` : 'Hola,';
  const user = login.toLowerCase() !== to.toLowerCase() ? `<p>Su usuario para entrar es <b>${login.replace(/[<>&"]/g, '')}</b>.</p>` : '';
  await sendMail(to, `${brand}: crear una nueva contraseña`,
    mailLayout(brand, 'Crear una nueva contraseña', `<p>${hi}</p><p>Recibimos una solicitud para restablecer la contraseña de su cuenta. Toque el botón para crear una nueva. El enlace sirve una sola vez y vence en 1 hora.</p>${user}`,
      { href: link, label: 'Crear nueva contraseña' }),
    `${hi}\n\nPara crear una nueva contraseña abra este enlace (vence en 1 hora):\n${link}\n${user ? `\nSu usuario para entrar es ${login}.\n` : ''}\nSi usted no lo pidió, ignore este correo.`,
    undefined, { org: acc.organization_id, kind: 'recuperar' });
  return 'sent';
}

/** Correo de bienvenida con enlace para crear la contraseña (cuenta nueva o recién habilitada). */
export async function sendAccessLink(email: string, o: { org?: string | null; title: string; intro: string }): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) return { ok: false, error: 'El correo de la plataforma no está configurado.' };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    if (error || !data?.properties?.hashed_token) return { ok: false, error: error?.message ?? 'No se pudo generar el enlace' };
    const link = `${env.siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
    const { brandOf, textToMailHtml } = await import('@/lib/notify');
    const brand = await brandOf(o.org);
    await sendMail(email, `${brand}: ${o.title}`,
      mailLayout(brand, o.title, `${textToMailHtml(o.intro)}<p>Su usuario es <b>${email.replace(/[<>&"]/g, '')}</b>. Toque el botón para crear su contraseña (el enlace sirve una vez y vence en 1 hora; después puede pedir otro en «¿Olvidó su contraseña?»).</p>`,
        { href: link, label: 'Crear mi contraseña' }),
      `${o.title}\n\n${o.intro}\n\nUsuario: ${email}\nCree su contraseña aquí (vence en 1 hora): ${link}`, undefined, { org: o.org, kind: 'acceso' });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
