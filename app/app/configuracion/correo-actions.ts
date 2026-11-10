'use server';
import { getContext } from '@/lib/context';
import { mailLayout, sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import type { ActionResult } from '@/lib/actions';

/** ✉ Envía un correo de prueba al propietario y muestra el error exacto si falla. */
export async function sendTestMail(): Promise<ActionResult> {
  try {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin) return { ok: false, error: 'Solo el propietario puede probar el correo.' };
    const to = ctx.user.email ?? '';
    if (!to) return { ok: false, error: 'Su cuenta no tiene correo.' };
    await sendMail(to, 'Prueba de correo de la plataforma',
      mailLayout('SEMATEC ACADEMY', '✓ El correo funciona', `<p>Este es un correo de prueba. Los enlaces de los correos apuntan a <b>${env.siteUrl()}</b>.</p>`),
      `El correo funciona. Los enlaces apuntan a ${env.siteUrl()}.`);
    return { ok: true, message: `Correo de prueba enviado a ${to}. Revise su bandeja (y «Spam»).` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
