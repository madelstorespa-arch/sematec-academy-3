import Link from 'next/link';
import { Card, Badge } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { mailEnabled } from '@/lib/mailer';
import { can, type getContext } from '@/lib/context';
import { unlockAccount, setNewPassword, resetMfa, sendRecovery } from './acceso-actions';

type Ctx = Awaited<ReturnType<typeof getContext>>;
type D = { exists: boolean; other_org?: boolean; user_id?: string; name?: string; status?: string; reason?: string | null; locked_until?: string | null;
  last_sign_in?: string | null; confirmed?: boolean; banned_until?: string | null; has_password?: boolean; roles?: { role: string; status: string; until: string | null; mfa: boolean }[];
  mfa_enrolled?: boolean; needs_mfa?: boolean; fails_24h?: number; person?: string | null; platform_admin?: boolean };
type F = { level: 'ok' | 'warn' | 'bad'; text: string };

/** 🔎 ¿Por qué no puede entrar? — revisa una cuenta y ofrece la solución con un botón. */
export async function AccessDiagnosis({ ctx, email }: { ctx: Ctx; email?: string }) {
  let d: D | null = null; let err: string | null = null;
  if (email) {
    const { data, error } = await ctx.supabase.rpc('access_diagnosis', { p_org: ctx.orgId, p_email: email });
    d = data as D; err = error?.message ?? null;
  }
  const f: F[] = [];
  if (d && !d.exists) f.push(d.person ? { level: 'bad', text: `Tiene ficha de ${d.person}, pero NO tiene cuenta para entrar. Créela desde su ficha con «🔑 Crear cuenta» (Estudiantes, Profesores o Personal).` }
    : { level: 'bad', text: 'No existe ninguna cuenta con ese correo. Revise que esté bien escrito (sin espacios) o cree la cuenta.' });
  if (d?.other_org) f.push({ level: 'bad', text: 'La cuenta existe, pero no pertenece a su institución.' });
  if (d?.exists && !d.other_org) {
    const now = Date.now();
    if (d.status === 'locked' && String(d.reason ?? '').startsWith('Bloqueo por intentos fallidos'))
      f.push({ level: 'bad', text: `Bloqueada por varios intentos fallidos${d.locked_until && new Date(d.locked_until).getTime() > now ? ` hasta ${fmtDateTime(d.locked_until)}` : ''}: se desbloquea sola en 15 minutos, al recuperar la contraseña o con «Desbloquear».` });
    else if (d.status === 'locked') f.push({ level: 'bad', text: `Bloqueada por la administración: ${d.reason ?? 'sin motivo'}.` });
    else if (d.status === 'suspended') f.push({ level: 'bad', text: `Cuenta suspendida: ${d.reason ?? 'sin motivo'}.` });
    else f.push({ level: 'ok', text: 'La cuenta está activa.' });
    if (d.banned_until && new Date(d.banned_until).getTime() > now) f.push({ level: 'bad', text: 'Está bloqueada en el sistema de autenticación: póngale una contraseña nueva para reactivarla.' });
    if (!d.has_password) f.push({ level: 'bad', text: 'La cuenta no tiene contraseña: póngale una abajo.' });
    if (!d.confirmed) f.push({ level: 'warn', text: 'El correo no está confirmado: al ponerle una contraseña nueva queda habilitada.' });
    const active = (d.roles ?? []).filter((r) => r.status === 'active' && (!r.until || new Date(r.until).getTime() > now));
    if (!active.length) f.push({ level: 'bad', text: 'No tiene ningún rol activo en la institución (sin rol no puede entrar a ningún módulo). Asígnele uno en «Asignar rol a un usuario».' });
    else f.push({ level: 'ok', text: `Roles activos: ${[...new Set(active.map((r) => r.role))].join(', ')}.` });
    if (d.needs_mfa && !d.mfa_enrolled) f.push({ level: 'warn', text: 'Su rol exige verificación en dos pasos: al entrar se le mostrará un código QR para configurar Google Authenticator (u otra app). Debe tener el celular a mano.' });
    if (d.mfa_enrolled) f.push({ level: 'warn', text: 'Usa verificación en dos pasos: si perdió el celular o borró la app, use «Reiniciar verificación en dos pasos».' });
    if ((d.fails_24h ?? 0) > 0) f.push({ level: 'warn', text: `${d.fails_24h} intento(s) fallido(s) en las últimas 24 horas: probablemente no recuerda la contraseña.` });
    f.push(d.last_sign_in ? { level: 'ok', text: `Última vez que entró: ${fmtDateTime(d.last_sign_in)}.` } : { level: 'warn', text: 'Nunca ha entrado a la plataforma.' });
  }
  const color = { ok: 'text-emerald-800', warn: 'text-amber-800', bad: 'text-red-700' };
  const icon = { ok: '✓', warn: '⚠', bad: '✕' };
  const hid = d?.user_id ? <input type="hidden" name="user_id" value={d.user_id} /> : null;
  const canAct = ctx.isOwner || can(ctx, 'security.admin');
  return (
    <Card title="🔎 ¿Por qué no puede entrar?" className="mb-6">
      <form className="flex flex-wrap items-end gap-2" data-testid="diagnostico">
        <label className="block"><span className="label">Correo de la persona</span>
          <input className="input w-72" type="email" name="revisar" defaultValue={email} required placeholder="persona@correo.cl" /></label>
        <button className="btn-primary">Revisar</button>
      </form>
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
      {d && (
        <div className="mt-4 space-y-3" data-testid="diagnostico-resultado">
          {d.name && <p className="text-sm font-semibold">{d.name} <Badge>{email}</Badge></p>}
          <ul className="space-y-1 text-sm">{f.map((x, i) => <li key={i} className={color[x.level]}>{icon[x.level]} {x.text}</li>)}</ul>
          {d.exists && !d.other_org && d.user_id && canAct && (ctx.aal !== 'aal2'
            ? <p className="text-sm text-amber-700">Para usar las soluciones, entre con su código de verificación en dos pasos.</p>
            : (
              <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-2">
                <div className="flex flex-wrap gap-2">
                  {d.status !== 'active' && <ActionForm action={unlockAccount} inline submitLabel="🔓 Desbloquear / reactivar" submitClass="btn-primary btn-sm">{hid}</ActionForm>}
                  {d.mfa_enrolled && <ActionForm action={resetMfa} inline submitLabel="🔄 Reiniciar verificación en dos pasos" submitClass="btn-secondary btn-sm" confirm="¿Reiniciar la verificación en dos pasos? La persona deberá configurar su app de nuevo al entrar.">{hid}</ActionForm>}
                  {mailEnabled() && <ActionForm action={sendRecovery} inline submitLabel="✉ Enviar enlace de recuperación" submitClass="btn-secondary btn-sm">{hid}</ActionForm>}
                </div>
                <ActionForm action={setNewPassword} submitLabel="🔑 Poner una contraseña nueva" submitClass="btn-secondary btn-sm">
                  {hid}<Field label="Contraseña nueva" name="password" type="password" required autoComplete="new-password" placeholder="Mín. 10, con mayúsculas, minúsculas y números" />
                </ActionForm>
              </div>))}
          {!d.exists && <p className="text-sm"><Link className="link" href="/app/estudiantes">Estudiantes</Link> · <Link className="link" href="/app/profesores">Profesores</Link> · <Link className="link" href="/app/personal">Personal</Link></p>}
        </div>)}
      {!mailEnabled() && <p className="mt-3 text-xs text-amber-700">⚠ El correo de recuperación no está configurado (variables SMTP en Vercel): «¿Olvidó su contraseña?» no llega a los usuarios. Mientras tanto, use «Poner una contraseña nueva».</p>}
    </Card>
  );
}
