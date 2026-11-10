import { Card } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { mailConfig, mailEnabled } from '@/lib/mailer';
import { env } from '@/lib/env';
import { sendTestMail } from '@/app/app/configuracion/correo-actions';

/** 📧 Estado del correo saliente (sin mostrar nunca la clave) y botón de prueba. */
export function MailStatus() {
  const c = mailConfig();
  const site = env.siteUrl();
  const rows: [string, string, boolean][] = [
    ['Servidor', c.host ? `${c.host}:${c.port}` : 'No configurado', !!c.host],
    ['Usuario (SMTP_USER)', c.user || 'No configurado', !!c.user],
    ['Clave (SMTP_PASS)', c.hasPass ? '•••••••• (configurada)' : 'No configurada', c.hasPass],
    ['Remitente', c.from || 'No configurado', !!c.from],
    ['Enlaces de los correos', site, !/localhost|127\.0\.0\.1/.test(site)],
  ];
  return (
    <Card title="📧 Correo del sistema" className="mb-6">
      <table className="w-full text-sm" data-testid="estado-correo"><tbody>{rows.map(([k, v, okv]) => (
        <tr key={k} className="border-b border-slate-100"><td className="py-1.5 pr-3 text-slate-500">{k}</td><td className={okv ? 'text-emerald-800' : 'text-red-700'}>{okv ? '✓' : '✕'} {v}</td></tr>))}</tbody></table>
      {env.siteUrlMisconfigured() && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">⚠ En Vercel la variable <b>NEXT_PUBLIC_SITE_URL</b> dice «localhost». El sistema ya la ignora y usa {site}, pero conviene borrarla o cambiarla por esa dirección.</p>}
      {!mailEnabled() && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">Sin correo propio, los correos (recuperar contraseña, boletas) no llegan a los usuarios. En Vercel → Settings → Environment Variables agregue <b>SMTP_USER</b> = su Gmail y <b>SMTP_PASS</b> = la contraseña de aplicación de 16 letras de esa cuenta, y haga «Redeploy».</p>}
      <div className="mt-3"><ActionForm action={sendTestMail} submitLabel="✉ Enviarme un correo de prueba" submitClass="btn-secondary btn-sm" /></div>
    </Card>
  );
}
