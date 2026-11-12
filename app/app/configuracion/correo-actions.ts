'use server';
import { can, getContext } from '@/lib/context';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { fail, guard, ok, type ActionResult } from '@/lib/actions';

/** ✉ Envía un correo de prueba al propietario y muestra el error exacto si falla. */
/** 🔑 Prueba real de «¿Olvidó su contraseña?» con la cuenta de quien la ejecuta: muestra la causa exacta si falla. */
export async function testRecoveryMail(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin && !can(ctx, 'settings.admin')) return fail('Solo la administración puede probar el correo.');
    const to = ctx.user.email ?? '';
    if (!mailEnabled()) return fail('El correo de la plataforma no está configurado: en Vercel agregue SMTP_USER (su Gmail) y SMTP_PASS (contraseña de aplicación) y haga «Redeploy».');
    try {
      const { sendRecoveryLink } = await import('@/lib/recovery');
      const r = await sendRecoveryLink(to);
      if (r === 'sent') return ok(`Funciona: se envió un enlace de recuperación a ${to}. Revise su bandeja (y «Spam»). Si lo usa, cambiará su contraseña.`);
      return fail(r === 'no_account' ? 'Supabase no generó el enlace: revise que SUPABASE_SERVICE_ROLE_KEY esté en Vercel.' : 'Su cuenta no está activa.');
    } catch (e) { return fail((e as Error).message); }
  });
}

export async function sendTestMail(fd?: FormData): Promise<ActionResult> {
  try {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin) return { ok: false, error: 'Solo el propietario puede probar el correo.' };
    const custom = String(fd?.get('to') ?? '').trim().toLowerCase();
    const to = custom || (ctx.user.email ?? '');
    if (!to) return { ok: false, error: 'Su cuenta no tiene correo.' };
    await sendMail(to, 'Prueba de correo de la plataforma',
      mailLayout('SEMATEC ACADEMY', '✓ El correo funciona', `<p>Este es un correo de prueba. Los enlaces de los correos apuntan a <b>${env.siteUrl()}</b>.</p>`),
      `El correo funciona. Los enlaces apuntan a ${env.siteUrl()}.`, undefined, { org: ctx.orgId, kind: 'prueba', by: ctx.user.id });
    return { ok: true, message: `Correo de prueba enviado a ${to}. Revise su bandeja (y «Spam»).` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
