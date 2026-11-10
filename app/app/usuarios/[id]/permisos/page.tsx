import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDate } from '@/lib/format';
import { saveUserPermissions } from './actions';

export const metadata = { title: 'Permisos del usuario' };
const ACTIONS: [string, string][] = [['view', 'Ver'], ['create', 'Crear'], ['edit', 'Editar'], ['approve', 'Aprobar'], ['void', 'Anular'], ['export', 'Exportar'], ['admin', 'Administrar']];
const SENSITIVE = (code: string) => code.endsWith('.admin') || ['security', 'users', 'organization', 'audit', 'settings'].includes(code.split('.')[0]);

/** 🛡 Autorizaciones de una persona: lo que le da su rol, más lo que se le permite o se le quita individualmente. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(ctx.isOwner || can(ctx, 'security.admin') || can(ctx, 'users.view'))) notFound();
  const admin = createAdminClient();
  const [{ data: prof }, { data: mems }, { data: perms }, { data: extra }] = await Promise.all([
    admin.from('profiles').select('id, full_name, email, id_document_number, user_code, status').eq('id', id).maybeSingle(),
    admin.from('memberships').select('status, valid_until, campus_id, campuses(name), roles(id, code, name, requires_mfa, role_permissions(permission_code))').eq('user_id', id).eq('organization_id', orgId),
    admin.from('permissions').select('code, module, action, description').order('code'),
    ctx.supabase.from('user_permissions').select('permission_code, effect, campus_id, valid_until, reason, created_at, granted_by').eq('organization_id', orgId).eq('user_id', id),
  ]);
  if (!prof || !mems?.length) notFound();
  const active = (mems as any[]).filter((m) => m.status === 'active' && (!m.valid_until || new Date(m.valid_until) > new Date()));
  const fromRole = new Map<string, string[]>();
  for (const m of active) for (const rp of m.roles?.role_permissions ?? []) fromRole.set(rp.permission_code, [...(fromRole.get(rp.permission_code) ?? []), m.roles.name]);
  const isTargetOwner = active.some((m) => m.roles?.code === 'propietario_institucional');
  const ext = new Map((extra ?? []).map((e: any) => [e.permission_code, e]));
  const first = (extra ?? [])[0] as any;
  const canEdit = (ctx.isOwner || (can(ctx, 'security.admin') && ctx.aal === 'aal2')) && id !== ctx.user.id && !isTargetOwner;
  // Módulos agrupados con su nombre en español (de la descripción «Tienda · Vender»)
  const mods = new Map<string, { label: string; perms: Map<string, any> }>();
  for (const p of (perms ?? []) as any[]) {
    const label = String(p.description || p.module).split(' · ')[0];
    if (!mods.has(p.module)) mods.set(p.module, { label, perms: new Map() });
    mods.get(p.module)!.perms.set(p.action, p);
  }
  const list = [...mods.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'es'));
  const effective = (perms ?? []).filter((p: any) => (fromRole.has(p.code) || ext.get(p.code)?.effect === 'allow') && ext.get(p.code)?.effect !== 'deny').length;
  const nAllow = [...ext.values()].filter((e: any) => e.effect === 'allow').length, nDeny = ext.size - nAllow;
  return (
    <>
      <PageHeader title={`🛡 Permisos de ${prof.full_name || prof.email}`} subtitle="Además de lo que da su rol, puede permitirle algo extra o quitarle un permiso, sin tocar código."
        actions={<Link className="btn-secondary" href="/app/usuarios">← Usuarios y roles</Link>} />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-slate-500">Persona</p><p className="font-semibold">{prof.full_name}</p>
          <p className="text-xs text-slate-500">{prof.email}{prof.id_document_number ? ` · ${prof.id_document_number}` : ''}{prof.user_code ? ` · ${prof.user_code}` : ''}</p></Card>
        <Card><p className="text-xs text-slate-500">Roles</p>{active.length ? active.map((m, i) => <p key={i} className="text-sm">{m.roles?.name} <span className="text-xs text-slate-500">· {m.campuses?.name ?? 'todas las sedes'}</span></p>) : <p className="text-sm">Sin roles activos</p>}</Card>
        <Card><p className="text-xs text-slate-500">Permisos efectivos</p><p className="text-2xl font-bold" data-testid="permisos-efectivos">{effective}</p>
          <p className="text-xs text-slate-500">{fromRole.size} por su rol · <span className="text-emerald-700">{nAllow} extra</span> · <span className="text-red-700">{nDeny} quitados</span></p></Card>
      </div>
      {isTargetOwner && <p className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Es el propietario: tiene todos los permisos y no se pueden cambiar.</p>}
      {!canEdit && !isTargetOwner && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{id === ctx.user.id ? 'No puede cambiar sus propias autorizaciones.' : 'Solo el propietario o el encargado de seguridad (con verificación en dos pasos) pueden cambiarlas. Usted puede verlas.'}</p>}
      <Card>
        <ActionForm action={saveUserPermissions} submitLabel="💾 Guardar autorizaciones" resetOnSuccess={false} hideSubmit={!canEdit}>
          <input type="hidden" name="user_id" value={id} />
          <p className="text-sm text-slate-600">En cada casilla: <b>Según su rol</b> (✓ lo tiene, — no lo tiene), <b className="text-emerald-700">✅ Permitir</b> (se lo da aunque su rol no lo tenga) o <b className="text-red-700">⛔ Quitar</b> (se lo quita aunque su rol lo tenga). 🔐 = exige verificación en dos pasos.</p>
          <div className="overflow-x-auto">
            <table className="table text-sm" data-testid="matriz-permisos">
              <thead><tr><th className="sticky left-0 bg-white">Módulo</th>{ACTIONS.map(([, l]) => <th key={l} className="text-center">{l}</th>)}</tr></thead>
              <tbody>{list.map(([mod, { label, perms: ps }]) => (
                <tr key={mod}>
                  <td className="sticky left-0 bg-white font-medium">{label}</td>
                  {ACTIONS.map(([a]) => {
                    const p = ps.get(a);
                    if (!p) return <td key={a} />;
                    const role = fromRole.has(p.code); const cur = ext.get(p.code)?.effect ?? '';
                    const mineOk = ctx.isOwner || can(ctx, p.code);
                    return (
                      <td key={a} className={`text-center ${cur === 'allow' ? 'bg-emerald-50' : cur === 'deny' ? 'bg-red-50' : ''}`} title={`${p.description}${role ? ` — por su rol: ${fromRole.get(p.code)!.join(', ')}` : ''}`}>
                        <select name={`p:${p.code}`} defaultValue={cur} disabled={!canEdit} aria-label={p.description}
                          className={`rounded border px-1 py-0.5 text-xs ${cur === 'allow' ? 'border-emerald-400 text-emerald-800' : cur === 'deny' ? 'border-red-400 text-red-800' : 'border-slate-200'}`}>
                          <option value="">{role ? '✓ Rol' : '— Rol'}</option>
                          {(mineOk || cur === 'allow') && <option value="allow">✅ Permitir</option>}
                          <option value="deny">⛔ Quitar</option>
                        </select>{SENSITIVE(p.code) && <span title="Exige verificación en dos pasos"> 🔐</span>}
                      </td>);
                  })}
                </tr>))}</tbody>
            </table>
          </div>
          {canEdit && (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block"><span className="label">Válido en</span>
                <select name="campus_id" defaultValue={first?.campus_id ?? ''} className="input"><option value="">Todas las sedes</option>{ctx.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="block"><span className="label">Hasta (opcional)</span>
                <input type="date" name="valid_until" defaultValue={first?.valid_until ? new Date(first.valid_until).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }) : ''} className="input" /></label>
              <label className="block"><span className="label">Motivo</span><input name="reason" defaultValue={first?.reason ?? ''} maxLength={300} placeholder="Ej.: reemplazo de vacaciones" className="input" /></label>
            </div>)}
          {first && <p className="text-xs text-slate-500">Última modificación: {fmtDate(first.created_at)}{first.valid_until ? ` · vencen el ${fmtDate(first.valid_until)}` : ''}{first.reason ? ` · «${first.reason}»` : ''}</p>}
        </ActionForm>
      </Card>
      {ext.size > 0 && <p className="mt-3 text-sm"><Badge color="amber">Individual</Badge> Esta persona tiene autorizaciones propias además de su rol.</p>}
    </>
  );
}
