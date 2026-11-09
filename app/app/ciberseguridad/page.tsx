import { notFound } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty, Stat, Tabs } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { serverConfigChecks, PROTECTIONS } from '@/lib/security-config';
import { revokeSessions, setAccount, openIncident, updateIncident, verifyIntegrity } from './actions';

export const metadata = { title: 'Centro de Ciberseguridad' };
const EV: Record<string, string> = {
  login_failed: 'Inicio de sesión fallido', account_locked: 'Cuenta bloqueada', account_unlocked: 'Cuenta desbloqueada',
  sessions_revoked: 'Sesiones cerradas', incident_opened: 'Incidente registrado', password_reset_by_admin: 'Contraseña cambiada por administrador',
  installment_payment_fulfill_failed: 'Pago no registrado', mfa_enrolled: 'MFA activado',
  owner_bruteforce: 'Ataque a la cuenta del propietario', login_ip_blocked: 'Red bloqueada por fuerza bruta',
};
const SEV: Record<string, 'gray' | 'amber' | 'red'> = { info: 'gray', warning: 'amber', critical: 'red' };
const ISEV: Record<string, ['gray' | 'blue' | 'amber' | 'red', string]> = { baja: ['gray', 'Baja'], media: ['blue', 'Media'], alta: ['amber', 'Alta'], critica: ['red', 'Crítica'] };
const IST: Record<string, string> = { abierto: 'Abierto', investigando: 'Investigando', contenido: 'Contenido', cerrado: 'Cerrado' };
const CAT: Record<string, string> = { acceso_indebido: 'Acceso indebido', fraude: 'Fraude', fuga_datos: 'Fuga de datos', malware_phishing: 'Malware / phishing', disponibilidad: 'Caída del servicio', alteracion_datos: 'Alteración de datos', otro: 'Otro' };

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string; dias?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!can(ctx, 'security.admin') && !can(ctx, 'audit.view') && !ctx.isPlatformAdmin) notFound();
  const manage = (can(ctx, 'security.admin') && ctx.aal === 'aal2') || ctx.isPlatformAdmin;
  const sp = await searchParams;
  const tab = sp.t ?? 'panorama';
  const { data: ov, error } = await ctx.supabase.rpc('security_overview', { p_org: orgId });
  if (error) throw new Error(error.message);
  const o = ov as any;
  const checks = serverConfigChecks();
  const issues = [
    ...checks.filter((c) => !c.ok),
    ...(o.admins_without_mfa.length ? [{ level: 'critical', title: 'Administradores sin MFA', detail: `${o.admins_without_mfa.length} cuenta(s) con rol administrativo aún no activan la verificación en dos pasos.` }] : []),
    ...(Number(o.certificates_tampered) ? [{ level: 'critical', title: 'Certificados alterados', detail: `${o.certificates_tampered} certificado(s) no coinciden con su huella.` }] : []),
    ...(Number(o.failed_logins_24h) >= 10 ? [{ level: 'warning', title: 'Muchos intentos fallidos', detail: `${o.failed_logins_24h} intentos fallidos en 24 horas.` }] : []),
  ] as { level: string; title: string; detail: string }[];
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + (i.level === 'critical' ? 20 : 8), 0));
  const tabs = [
    { key: 'panorama', label: '🛡 Panorama', href: '?t=panorama' }, { key: 'alertas', label: '🚨 Alertas', href: '?t=alertas' },
    { key: 'sesiones', label: '💻 Sesiones', href: '?t=sesiones' }, { key: 'accesos', label: '🔑 Accesos privilegiados', href: '?t=accesos' },
    { key: 'incidentes', label: `📋 Incidentes${Number(o.open_incidents) ? ` (${o.open_incidents})` : ''}`, href: '?t=incidentes' },
  ];

  let body: React.ReactNode = null;
  if (tab === 'panorama') {
    body = (
      <>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`card card-pad ${score >= 90 ? 'ring-2 ring-emerald-400' : score >= 70 ? 'ring-2 ring-amber-400' : 'ring-2 ring-red-400'}`}>
            <p className="label">Nivel de seguridad</p><p className="text-4xl font-black">{score}<span className="text-lg text-slate-400">/100</span></p>
            <p className="text-xs text-slate-500">{issues.length ? `${issues.length} punto(s) por resolver` : 'Sin observaciones'}</p>
          </div>
          <Stat label="Intentos fallidos (24 h)" value={o.failed_logins_24h} hint={Number(o.unknown_email_failures_24h) ? `${o.unknown_email_failures_24h} con correos inexistentes` : undefined} />
          <Stat label="Sesiones activas (7 días)" value={o.active_sessions} />
          <Stat label="Cuentas bloqueadas" value={o.locked} hint={Number(o.suspended) ? `${o.suspended} suspendidas` : undefined} />
          <Stat label="Alertas críticas (7 días)" value={o.critical_7d} />
          <Stat label="Cambios de notas (7 días)" value={o.grade_changes_7d} hint="Con motivo y auditoría" />
          <Stat label="Cambios de roles y permisos (7 días)" value={o.role_changes_7d} />
          <Stat label="Incidentes abiertos" value={o.open_incidents} />
        </div>
        <Card title="Puntos por resolver" className="mb-6" actions={<ActionForm action={verifyIntegrity} inline submitLabel="🔍 Verificar integridad" submitClass="btn-secondary btn-sm" resetOnSuccess={false} />}>
          {issues.length ? <ul className="space-y-2">{issues.map((i, k) => (
            <li key={k} className={`rounded-lg p-3 text-sm ${i.level === 'critical' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              <b>{i.level === 'critical' ? '⛔' : '⚠'} {i.title}:</b> {i.detail}</li>))}</ul>
            : <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ No hay observaciones de seguridad.</p>}
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Configuración del servidor">
            <ul className="space-y-2 text-sm">{checks.map((c, k) => (
              <li key={k} className="flex gap-2"><span>{c.ok ? '✅' : c.level === 'critical' ? '⛔' : '⚠️'}</span><span><b>{c.title}.</b> <span className="text-slate-600">{c.detail}</span></span></li>))}</ul>
            <p className="mt-3 text-xs text-slate-500">Solo se revisa si cada ajuste existe. Este panel nunca muestra contraseñas, claves ni secretos.</p>
          </Card>
          <Card title="Protecciones activas">
            <ul className="space-y-2 text-sm">{PROTECTIONS.map(([t, d]) => <li key={t}><b>✅ {t}:</b> <span className="text-slate-600">{d}</span></li>)}</ul>
          </Card>
        </div>
      </>);
  } else if (tab === 'alertas') {
    const days = Number(sp.dias ?? 7);
    const { data: alerts } = await ctx.supabase.rpc('security_alerts', { p_org: orgId, p_days: days });
    body = (
      <Card title={`Eventos de seguridad (últimos ${days} días)`}>
        <nav className="mb-4 flex gap-2 text-sm">{[1, 7, 30, 90].map((d) => <a key={d} href={`?t=alertas&dias=${d}`} className={days === d ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{d === 1 ? '24 h' : `${d} días`}</a>)}</nav>
        {alerts?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Fecha</th><th>Evento</th><th>Nivel</th><th>Cuenta</th><th>IP / dispositivo</th></tr></thead>
          <tbody>{(alerts as any[]).map((a) => (
            <tr key={a.id}><td className="whitespace-nowrap">{fmtDateTime(a.occurred_at)}</td><td>{EV[a.event_type] ?? a.event_type}{a.details?.reason && <span className="block text-xs text-slate-500">{a.details.reason}</span>}</td>
              <td><Badge color={SEV[a.severity]}>{a.severity}</Badge></td><td className="text-xs">{a.full_name ?? ''}<br />{a.email ?? '—'}</td>
              <td className="text-xs">{a.ip ?? '—'}<br /><span className="text-slate-400">{a.user_agent ?? ''}</span></td></tr>))}</tbody></table></div>
          : <Empty>Sin eventos en este periodo.</Empty>}
      </Card>);
  } else if (tab === 'sesiones') {
    const { data: sessions, error: se } = manage ? await ctx.supabase.rpc('security_sessions', { p_org: orgId }) : { data: null, error: null };
    const byUser = new Map<string, any[]>();
    for (const s of (sessions ?? []) as any[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
    body = !manage ? <Card><Empty>Ver y cerrar sesiones requiere permiso de seguridad y haber entrado con verificación en dos pasos.</Empty></Card> : (
      <Card title={`Sesiones activas (${sessions?.length ?? 0})`}>
        {se && <p className="text-sm text-red-700">{se.message}</p>}
        {byUser.size ? <ul className="divide-y divide-slate-100">{[...byUser.entries()].map(([uid, list]) => (
          <li key={uid} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm"><b>{list[0].full_name || list[0].email}</b> <span className="text-slate-500">{list[0].email}</span>{uid === ctx.user.id && <Badge color="blue">usted</Badge>}</span>
              {uid !== ctx.user.id && (
                <span className="flex flex-wrap gap-2">
                  <ActionForm action={revokeSessions} inline submitLabel="Cerrar sesiones" submitClass="btn-secondary btn-sm" confirm="¿Cerrar todas las sesiones de esta cuenta?"><input type="hidden" name="user_id" value={uid} /></ActionForm>
                  <ActionForm action={setAccount} inline submitLabel="⛔ Bloquear" submitClass="btn-secondary btn-sm text-red-700" confirm="¿Bloquear esta cuenta? Pierde el acceso de inmediato.">
                    <input type="hidden" name="user_id" value={uid} /><input type="hidden" name="lock" value="1" />
                    <input name="reason" required minLength={4} placeholder="Motivo" className="input w-36 py-1 text-xs" /></ActionForm>
                </span>)}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-500">{list.map((s) => (
              <li key={s.session_id}>Desde {fmtDateTime(s.created_at)} · última actividad {fmtDateTime(s.last_active)} · {s.aal === 'aal2' ? '🔐 con MFA' : 'sin MFA'} · IP {s.ip ?? '—'} · {s.user_agent ?? ''}</li>))}</ul>
          </li>))}</ul> : <Empty>No hay sesiones activas.</Empty>}
      </Card>);
  } else if (tab === 'accesos') {
    const locked = o.locked_list as any[];
    body = (
      <div className="space-y-6">
        <Card title="Cuentas con acceso privilegiado">
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Persona</th><th>Rol</th><th>MFA</th><th>Último ingreso</th><th>Estado</th></tr></thead>
            <tbody>{(o.privileged as any[]).map((p, k) => (
              <tr key={k}><td><b>{p.name}</b><br /><span className="text-xs text-slate-500">{p.email}</span></td><td>{p.role}</td>
                <td>{p.mfa ? <Badge color="green">Activo</Badge> : <Badge color="red">Sin MFA</Badge>}</td>
                <td className="whitespace-nowrap text-xs">{p.last_sign_in ? fmtDateTime(p.last_sign_in) : 'Nunca'}</td><td>{p.status}</td></tr>))}</tbody></table></div>
          <p className="mt-3 text-xs text-slate-500">Los roles administrativos deben activar la verificación en dos pasos (Mi cuenta → Seguridad); el sistema la exige al entrar.</p>
        </Card>
        <Card title="Cuentas bloqueadas">
          {locked?.length ? <ul className="divide-y divide-slate-100">{locked.map((p: any) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><b>{p.full_name || p.email}</b> <span className="text-slate-500">{p.email}</span><span className="block text-xs text-slate-500">{p.status_reason}</span></span>
              {manage && <ActionForm action={setAccount} inline submitLabel="Desbloquear" submitClass="btn-secondary btn-sm">
                <input type="hidden" name="user_id" value={p.id} /><input type="hidden" name="lock" value="0" />
                <input name="reason" required minLength={4} placeholder="Motivo (verificado con la persona…)" className="input w-52 py-1 text-xs" /></ActionForm>}
            </li>))}</ul> : <Empty>No hay cuentas bloqueadas.</Empty>}
        </Card>
      </div>);
  } else {
    const { data: incidents } = await ctx.supabase.from('security_incidents').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(100);
    body = (
      <div className="space-y-6">
        {manage && (
          <details className="card">
            <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Registrar incidente</summary>
            <div className="border-t border-slate-100 p-5"><ActionForm action={openIncident} submitLabel="Registrar">
              <Field label="Qué pasó" name="title" required placeholder="Ej.: Intentos de acceso a la cuenta de tesorería" />
              <Grid><SelectField label="Gravedad" name="severity" required defaultValue="media" options={Object.entries(ISEV).map(([value, [, label]]) => ({ value, label }))} />
                <SelectField label="Tipo" name="category" required defaultValue="acceso_indebido" options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} /></Grid>
              <TextArea label="Descripción y evidencias" name="description" rows={4} />
            </ActionForm></div>
          </details>)}
        <Card title="Incidentes de seguridad">
          {incidents?.length ? <ul className="divide-y divide-slate-100">{incidents.map((i: any) => (
            <li key={i.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">N° {i.number} · {i.title}</p><p className="text-xs text-slate-500">{CAT[i.category]} · {fmtDateTime(i.created_at)}</p></div>
                <span className="flex gap-2"><Badge color={ISEV[i.severity][0]}>{ISEV[i.severity][1]}</Badge><Badge color={i.status === 'cerrado' ? 'green' : 'amber'}>{IST[i.status]}</Badge></span>
              </div>
              {i.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{i.description}</p>}
              <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 text-xs text-slate-600">{(i.log as any[]).map((l, k) => <li key={k}><b>{fmtDateTime(l.at)} · {IST[l.status]}:</b> {l.note}</li>)}</ol>
              {manage && i.status !== 'cerrado' && (
                <div className="mt-2"><ActionForm action={updateIncident} inline submitLabel="Agregar a la bitácora" submitClass="btn-secondary btn-sm">
                  <input type="hidden" name="id" value={i.id} />
                  <select name="status" defaultValue={i.status === 'abierto' ? 'investigando' : i.status} className="input py-1 text-xs">{Object.entries(IST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input name="note" required minLength={3} placeholder="Qué se hizo (ej.: se bloqueó la cuenta, se cambió la clave)" className="input w-72 py-1 text-xs" />
                </ActionForm></div>)}
            </li>))}</ul> : <Empty>No hay incidentes registrados.</Empty>}
        </Card>
      </div>);
  }

  return (
    <>
      <PageHeader title="🛡 Centro de Ciberseguridad" subtitle="Supervise alertas, sesiones, accesos e incidentes sin tocar código. Nunca muestra contraseñas ni claves." />
      {!manage && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Modo solo lectura: para cerrar sesiones, bloquear cuentas o gestionar incidentes necesita permiso de seguridad y entrar con verificación en dos pasos.</p>}
      <Tabs items={tabs} current={tab} />
      {body}
    </>
  );
}
