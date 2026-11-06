import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { grantRole, revokeRole, setAccountStatus, createRole } from './actions';

export const metadata = { title: 'Usuarios y roles' };

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'users.view');
  const orgId = requireOrg(ctx);
  const sb = ctx.supabase;
  const [{ data: members }, { data: roles }, campuses, { data: perms }] = await Promise.all([
    sb.from('memberships').select('id, status, valid_until, created_at, campus_id, campuses(name), roles(code, name, requires_mfa), profiles!memberships_user_id_fkey(id, full_name, email, status)')
      .eq('organization_id', orgId).order('created_at', { ascending: false }),
    sb.from('roles').select('code, name, requires_mfa, organization_id').order('name'),
    campusOptions(ctx),
    sb.from('permissions').select('code, module, description').order('code'),
  ]);
  const admin = can(ctx, 'security.admin');
  const roleOpts = (roles ?? []).filter((r: any) => !r.organization_id || r.organization_id === orgId).map((r: any) => ({ value: r.code, label: `${r.name}${r.requires_mfa ? ' (MFA)' : ''}` }));
  const modules = [...new Set((perms ?? []).map((p: any) => p.module))];

  return (
    <>
      <PageHeader title="Usuarios y roles" subtitle="Acceso por institución, sede y rol. Los roles administrativos exigen MFA." />
      {admin && (
        <Card title="Asignar rol a un usuario" className="mb-6">
          {ctx.aal !== 'aal2' ? <p className="text-sm text-amber-700">Para administrar roles debe iniciar sesión con MFA.</p> : (
            <ActionForm action={grantRole} submitLabel="Asignar rol">
              <Grid cols={3}>
                <Field label="Correo" name="email" type="email" required /><Field label="Nombre completo" name="full_name" required />
                <SelectField label="Rol" name="role" required options={roleOpts} />
                <SelectField label="Sede (vacío = todas)" name="campus_id" options={campuses} placeholder="Todas las sedes" />
                <Field label="Vigente hasta (opcional)" name="valid_until" type="date" />
                <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="invite" /> Invitar por correo (requiere SMTP)</label>
              </Grid>
              <p className="text-xs text-slate-500">Si el correo no tiene cuenta, se crea. No puede otorgar roles con permisos que usted no posee.</p>
            </ActionForm>
          )}
        </Card>
      )}
      <Card title="Membresías">
        {members?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Usuario</th><th>Rol</th><th>Sede</th><th>Desde</th><th>Estado</th><th>Cuenta</th>{admin && <th>Acciones</th>}</tr></thead>
          <tbody>{members.map((m: any) => (
            <tr key={m.id}><td>{m.profiles?.full_name || '—'}<br /><span className="text-xs text-slate-500">{m.profiles?.email}</span></td>
              <td>{m.roles?.name} {m.roles?.requires_mfa && <Badge color="blue">MFA</Badge>}</td><td>{m.campuses?.name ?? 'Todas'}</td>
              <td>{fmtDate(m.created_at)}{m.valid_until && <><br /><span className="text-xs">hasta {fmtDate(m.valid_until)}</span></>}</td>
              <td><StatusBadge status={m.status} /></td><td><StatusBadge status={m.profiles?.status} /></td>
              {admin && <td className="space-y-1">
                {m.status === 'active' && <ActionForm action={revokeRole} inline submitLabel="Revocar" submitClass="btn-secondary btn-sm" confirm="¿Revocar este rol?">
                  <input type="hidden" name="id" value={m.id} /><input name="reason" required placeholder="Motivo" className="input w-28 py-1 text-xs" /></ActionForm>}
                {m.profiles?.id !== ctx.user.id && <ActionForm action={setAccountStatus} inline submitLabel="Aplicar" submitClass="btn-secondary btn-sm">
                  <input type="hidden" name="user_id" value={m.profiles?.id} />
                  <select name="status" defaultValue={m.profiles?.status} className="input py-1 text-xs"><option value="active">Cuenta activa</option><option value="suspended">Suspender</option><option value="locked">Bloquear</option></select>
                  <input name="reason" required placeholder="Motivo" className="input w-28 py-1 text-xs" /></ActionForm>}
              </td>}
            </tr>))}</tbody></table></div> : <Empty>Sin usuarios.</Empty>}
      </Card>
      {admin && ctx.aal === 'aal2' && (
        <details className="card mt-6">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Crear rol personalizado</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createRole} submitLabel="Crear rol">
              <Grid cols={3}><Field label="Código" name="code" required placeholder="asistente_finanzas" /><Field label="Nombre" name="name" required />
                <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="mfa" defaultChecked /> Exigir MFA</label></Grid>
              <div className="grid gap-3 md:grid-cols-3">{modules.map((mod) => (
                <fieldset key={mod} className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-xs font-bold uppercase text-slate-500">{mod}</legend>
                  {(perms ?? []).filter((p: any) => p.module === mod && ctx.perms.has(p.code)).map((p: any) => (
                    <label key={p.code} className="flex items-center gap-2 text-xs"><input type="checkbox" name="perm" value={p.code} />{p.code.split('.')[1]}</label>))}
                </fieldset>))}</div>
              <p className="text-xs text-slate-500">Solo aparecen los permisos que usted posee.</p>
            </ActionForm>
          </div>
        </details>
      )}
    </>
  );
}
