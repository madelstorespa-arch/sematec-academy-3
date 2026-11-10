import { randomInt } from 'node:crypto';
import { can, type Ctx } from '@/lib/context';
import { Card, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { mailEnabled } from '@/lib/mailer';
import { closeHelpRequest, resetMfa, sendRecovery, setNewPassword } from './acceso-actions';

const REASON: Record<string, string> = { sin_correo: 'No tiene correo', no_llega: 'El correo no le llega', mfa: 'Perdió el celular de verificación', otro: 'Otro' };
/** Contraseña temporal fácil de dictar: 3 palabras + números, cumple las reglas (12+, mayúsculas, minúsculas, números). */
function tempPassword() {
  const w = ['Sol', 'Mar', 'Luna', 'Rio', 'Cielo', 'Monte', 'Lago', 'Bosque', 'Nube', 'Faro', 'Valle', 'Puerto'];
  return `${w[randomInt(w.length)]}${w[randomInt(w.length)]}${w[randomInt(w.length)]}${randomInt(1000, 9999)}`;
}

/** 🔑 Solicitudes de personas que no pueden recuperar su contraseña por correo. */
export async function HelpRequests({ ctx }: { ctx: Ctx }) {
  if (!(ctx.isOwner || can(ctx, 'security.admin') || can(ctx, 'users.admin'))) return null;
  const { data } = await ctx.supabase.from('password_help_requests')
    .select('id, identifier, full_name, contact, message, reason, created_at, user_id, profiles!password_help_requests_user_id_fkey(full_name, email, id_document_number, status)')
    .eq('organization_id', ctx.orgId!).eq('status', 'pendiente').order('created_at').limit(50);
  const rows = (data ?? []) as any[];
  if (!rows.length) return null;
  const mfaOk = ctx.aal === 'aal2';
  return (
    <Card title={`🔑 Personas que piden ayuda para entrar (${rows.length})`} className="mb-6 border-amber-300">
      <p className="mb-3 text-sm text-slate-600">Antes de dar una contraseña, <b>confirme la identidad</b> de la persona (llámela al contacto que dejó, pídale su RUT y algún dato que solo ella sepa).</p>
      {!mfaOk && <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-900">Para poner contraseñas, entre con su verificación en dos pasos (MFA).</p>}
      <ul className="divide-y divide-slate-100" data-testid="solicitudes-clave">{rows.map((r) => {
        const hid = r.user_id ? <><input type="hidden" name="user_id" value={r.user_id} /><input type="hidden" name="help_id" value={r.id} /></> : null;
        return (
          <li key={r.id} className="py-3 text-sm" data-testid="solicitud-clave">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.full_name} <Badge color="amber">{REASON[r.reason] ?? r.reason}</Badge></p>
                <p className="text-xs text-slate-600">Escribió: {r.identifier} · Contacto: <b>{r.contact}</b> · {fmtDateTime(r.created_at)}</p>
                {r.message && <p className="mt-1 text-xs italic text-slate-600">«{r.message}»</p>}
                <p className="mt-1 text-xs">{r.profiles ? <>Cuenta: <b>{r.profiles.full_name}</b> · {r.profiles.email} {r.profiles.id_document_number ? `· ${r.profiles.id_document_number}` : ''} {r.profiles.status !== 'active' && <Badge color="red">{r.profiles.status}</Badge>}</>
                  : <span className="text-red-700">⚠ No se encontró una cuenta con ese RUT o correo: contacte a la persona para revisarlo.</span>}</p>
              </div>
              <span className="flex gap-1">
                <ActionForm action={closeHelpRequest} inline submitLabel="✓ Resuelta" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={r.id} /></ActionForm>
                <ActionForm action={closeHelpRequest} inline submitLabel="Descartar" submitClass="text-xs text-slate-500 hover:underline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="descartada" /></ActionForm>
              </span>
            </div>
            {r.user_id && mfaOk && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <ActionForm action={setNewPassword} inline submitLabel="🔑 Dar esta contraseña temporal" submitClass="btn-primary btn-sm" resetOnSuccess={false}>
                  {hid}<input name="password" defaultValue={tempPassword()} required minLength={12} className="input w-48 py-1 font-mono text-sm" aria-label="Contraseña temporal" data-testid="clave-temporal" />
                </ActionForm>
                {mailEnabled() && r.profiles?.email && <ActionForm action={sendRecovery} inline submitLabel="✉ Reenviar enlace al correo" submitClass="btn-secondary btn-sm">{hid}</ActionForm>}
                {r.reason === 'mfa' && <ActionForm action={resetMfa} inline submitLabel="🔄 Reiniciar verificación en dos pasos" submitClass="btn-secondary btn-sm" confirm="¿Reiniciar su verificación en dos pasos?">{hid}</ActionForm>}
              </div>)}
          </li>);
      })}</ul>
    </Card>
  );
}
