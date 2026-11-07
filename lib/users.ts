import 'server-only';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { ValidationError } from '@/lib/actions';

export function tempPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%*+-=?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < 16) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

/**
 * Obtiene o crea la cuenta de Auth para un correo. El llamador DEBE haber
 * verificado antes que el usuario actual tiene permiso para dar acceso.
 * mode 'invite' envía correo de invitación (requiere SMTP configurado en Supabase);
 * mode 'password' crea la cuenta con una contraseña temporal que se muestra una sola vez.
 */
export async function ensureAuthUser(email: string, fullName: string, mode: 'invite' | 'password', fixedPassword?: string) {
  const admin = createAdminClient();
  const normalized = email.trim().toLowerCase();
  const { data: existing } = await admin.from('profiles').select('id').eq('email', normalized).maybeSingle();
  if (existing) return { id: existing.id as string, created: false as const };
  if (mode === 'invite') {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
      data: { full_name: fullName }, redirectTo: `${env.siteUrl()}/auth/confirm?next=/cambiar-clave`,
    });
    if (error || !data.user) throw new ValidationError(
      'No se pudo enviar la invitación por correo: el envío de correos (SMTP) no está configurado. Desmarque «Invitar por correo» y escriba una contraseña para la cuenta.');
    return { id: data.user.id, created: true as const };
  }
  const password = fixedPassword ?? tempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: normalized, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    const m = error?.message ?? '';
    if (/already|registered|exists/i.test(m)) throw new ValidationError('Ese correo ya tiene una cuenta. Búsquela en la lista o use otro correo.');
    if (/password/i.test(m)) throw new ValidationError(`La contraseña no fue aceptada: ${m}`);
    if (/email/i.test(m)) throw new ValidationError('El correo no es válido. Revíselo.');
    throw new ValidationError(`No se pudo crear la cuenta: ${m || 'error desconocido'}`);
  }
  return { id: data.user.id, created: true as const, password };
}

/** Contraseña elegida por el administrador: 10+ caracteres con mayúscula, minúscula y número. */
export function checkPassword(pw: string | null): string {
  if (!pw) throw new ValidationError('Escriba la contraseña para la cuenta.');
  if (pw.length < 10 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw))
    throw new ValidationError(`La contraseña debe tener al menos 10 caracteres (escribió ${pw.length}), con mayúsculas, minúsculas y números. Ejemplo: Sematec2026Ok`);
  return pw;
}
