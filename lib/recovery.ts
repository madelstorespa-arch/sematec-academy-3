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
  const { data: prof } = await admin.from('profiles').select('id, full_name, status, status_reason').ilike('email', email).maybeSingle();
  if (!prof) return 'no_account';
  if (prof.status !== 'active' && !(prof.status === 'locked' && String(prof.status_reason ?? '').startsWith('Bloqueo por intentos fallidos'))) return 'not_allowed';
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (error || !data?.properties?.hashed_token) return 'no_account';
  const link = `${env.siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
  const { data: site } = await admin.from('site_settings').select('site_name').limit(1).maybeSingle();
  const brand = site?.site_name ?? 'SEMATEC ACADEMY';
  const hi = prof.full_name ? `Hola ${prof.full_name.split(' ')[0]},` : 'Hola,';
  await sendMail(email, `${brand}: crear una nueva contraseña`,
    mailLayout(brand, 'Crear una nueva contraseña', `<p>${hi}</p><p>Recibimos una solicitud para restablecer la contraseña de su cuenta. Toque el botón para crear una nueva. El enlace sirve una sola vez y vence en 1 hora.</p>`,
      { href: link, label: 'Crear nueva contraseña' }),
    `${hi}\n\nPara crear una nueva contraseña abra este enlace (vence en 1 hora):\n${link}\n\nSi usted no lo pidió, ignore este correo.`);
  return 'sent';
}
