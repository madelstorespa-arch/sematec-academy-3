import 'server-only';
import nodemailer from 'nodemailer';

/**
 * Correo saliente propio (SMTP): recuperación de contraseña y avisos.
 * Variables en Vercel: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM
 * (p. ej., Gmail con «contraseña de aplicación», Brevo, Resend u Outlook).
 */
export const mailEnabled = () => !!process.env.SMTP_HOST && !!process.env.SMTP_FROM;

export async function sendMail(to: string, subject: string, html: string, text: string) {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const local = /^(localhost|127\.0\.0\.1)$/.test(process.env.SMTP_HOST ?? '');
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    ignoreTLS: local, requireTLS: !local && port !== 465,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  await t.sendMail({ from: process.env.SMTP_FROM, to, subject, html, text });
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
