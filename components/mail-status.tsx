import { Card } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { mailConfig, mailEnabled } from '@/lib/mailer';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { sendTestMail } from '@/app/app/configuracion/correo-actions';

/** 📧 Estado del correo saliente (sin mostrar nunca la clave) y botón de prueba. */
export async function MailStatus({ orgId }: { orgId?: string | null } = {}) {
  const c = mailConfig();
  const site = env.siteUrl();
  const rows: [string, string, boolean][] = [
    ['Servidor', c.host ? `${c.host}:${c.port}` : 'No configurado', !!c.host],
    ['Usuario (SMTP_USER)', c.user || 'No configurado', !!c.user],
    ['Clave (SMTP_PASS)', c.hasPass ? '•••••••• (configurada)' : 'No configurada', c.hasPass],
    ['Remitente', c.from || 'No configurado', !!c.from],
    ['Enlaces de los correos', site, !/localhost|127\.0\.0\.1/.test(site)],
  ];
  const sb = await createClient();
  let q = sb.from('mail_log').select('id, created_at, to_email, subject, kind, status, error').order('created_at', { ascending: false }).limit(25);
  if (orgId) q = q.or(`organization_id.eq.${orgId},organization_id.is.null`);
  const { data: log } = await q;
  return (
    <Card title="📧 Correo del sistema" className="mb-6" id="correo">
      <table className="w-full text-sm" data-testid="estado-correo"><tbody>{rows.map(([k, v, okv]) => (
        <tr key={k} className="border-b border-slate-100"><td className="py-1.5 pr-3 text-slate-500">{k}</td><td className={okv ? 'text-emerald-800' : 'text-red-700'}>{okv ? '✓' : '✕'} {v}</td></tr>))}</tbody></table>
      {env.siteUrlMisconfigured() && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">⚠ En Vercel la variable <b>NEXT_PUBLIC_SITE_URL</b> dice «localhost». El sistema ya la ignora y usa {site}, pero conviene borrarla o cambiarla por esa dirección.</p>}
      {!mailEnabled() && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">Sin correo propio, los correos (recuperar contraseña, boletas) no llegan a los usuarios. En Vercel → Settings → Environment Variables agregue <b>SMTP_USER</b> = su Gmail y <b>SMTP_PASS</b> = la contraseña de aplicación de 16 letras de esa cuenta, y haga «Redeploy».</p>}
      <div className="mt-3"><ActionForm action={sendTestMail} submitLabel="✉ Enviar correo de prueba" submitClass="btn-secondary btn-sm">
        <label className="block text-sm"><span className="label">Enviar la prueba a (vacío = a mí)</span><input className="input" type="email" name="to" placeholder="persona@correo.cl" data-testid="prueba-correo-a" /></label>
      </ActionForm></div>
      <details className="mt-4" open={!!log?.length}>
        <summary className="cursor-pointer text-sm font-semibold">📬 Últimos correos enviados ({log?.length ?? 0})</summary>
        {log?.length ? (
          <div className="mt-2 overflow-x-auto"><table className="table text-xs" data-testid="registro-correos"><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Estado</th></tr></thead>
            <tbody>{log.map((m: any) => (
              <tr key={m.id}><td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td><td>{m.to_email}</td><td>{m.subject}</td>
                <td>{m.status === 'sent' ? <span className="text-emerald-700">✓ Enviado</span> : <span className="text-red-700" title={m.error ?? ''}>✕ {m.status === 'off' ? 'Correo no configurado' : 'Falló'}{m.error ? `: ${String(m.error).slice(0, 90)}` : ''}</span>}</td></tr>))}</tbody></table></div>
        ) : <p className="mt-2 text-xs text-slate-500">Aún no se han enviado correos.</p>}
      </details>
    </Card>
  );
}
