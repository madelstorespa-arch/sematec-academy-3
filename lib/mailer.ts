import 'server-only';
import nodemailer from 'nodemailer';

/**
 * Correo saliente propio (SMTP): recuperación de contraseña y avisos.
 * Variables en Vercel: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM
 * (p. ej., Gmail con «contraseña de aplicación», Brevo, Resend u Outlook).
 */
export const mailEnabled = () => !!process.env.SMTP_HOST && !!process.env.SMTP_FROM;

export async function sendMail(to: string, subject: string, html: string, text: string, attachments?: { filename: string; content: Buffer | Uint8Array; contentType?: string }[]) {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const local = /^(localhost|127\.0\.0\.1)$/.test(process.env.SMTP_HOST ?? '');
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    // Google muestra la contraseña de aplicación en grupos («abcd efgh ijkl mnop»): se quitan los espacios
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER.trim(), pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, '') } : undefined,
    ignoreTLS: local, requireTLS: !local && port !== 465,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  try {
    await t.sendMail({ from: process.env.SMTP_FROM, to, subject, html, text, attachments: attachments?.map((a) => ({ ...a, content: Buffer.from(a.content) })) });
  } catch (e) {
    throw new Error(mailErrorText(e));
  }
}

/** Traduce los errores del servidor de correo a instrucciones claras. */
export function mailErrorText(e: unknown) {
  const m = (e as Error)?.message ?? String(e);
  if (/535|BadCredentials|Username and Password not accepted|Invalid login|EAUTH/i.test(m))
    return 'El servidor de correo rechazó el usuario o la clave. Revise en Vercel: SMTP_USER debe ser el correo completo de Gmail y SMTP_PASS la «contraseña de aplicación» de 16 letras creada en ESA misma cuenta de Google (no la contraseña normal de Gmail). Después haga «Redeploy».';
  if (/534|Application-specific password required/i.test(m))
    return 'Gmail exige una «contraseña de aplicación»: créela en myaccount.google.com → Seguridad → Contraseñas de aplicaciones y póngala en SMTP_PASS (Vercel). Después haga «Redeploy».';
  if (/ENOTFOUND|EDNS|getaddrinfo/i.test(m)) return 'No se encontró el servidor de correo: revise SMTP_HOST en Vercel (para Gmail: smtp.gmail.com).';
  if (/ETIMEDOUT|ECONNREFUSED|ESOCKET|timeout/i.test(m)) return 'No se pudo conectar con el servidor de correo: revise SMTP_PORT en Vercel (para Gmail: 465).';
  if (/\b55[03]\b.*sender|sender address|Sender address/i.test(m)) return 'El servidor rechazó el remitente: SMTP_FROM debe usar el mismo correo que SMTP_USER, por ejemplo «SEMATEC ACADEMY <sucorreo@gmail.com>».';
  return `No se pudo enviar el correo: ${m}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Plantilla simple y legible en cualquier correo. */
export function mailLayout(site: string, title: string, bodyHtml: string, button?: { href: string; label: string }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-weight:bold;color:#1d4ed8">${esc(site)}</p>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
${button ? `<p style="margin:24px 0"><a href="${esc(button.href)}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>
<p style="font-size:12px;color:#64748b">Si el botón no funciona, copie este enlace en su navegador:<br>${esc(button.href)}</p>` : ''}
<p style="font-size:12px;color:#64748b;margin-top:24px">Si usted no pidió este correo, ignórelo: su cuenta sigue segura.</p>
</div></body></html>`;
}
