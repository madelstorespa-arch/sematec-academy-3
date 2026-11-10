import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm, Field, TextArea } from '@/components/forms';
import { FIELD_TYPES, type CustomModule } from '@/lib/modules';
import { LOCKED, baseNav, type MenuCustom } from '@/lib/nav-items';
import { FieldsEditor } from './fields-editor';
import { deleteModule, saveMenu, saveModule } from './actions';

export const metadata = { title: 'Módulos y menú' };
const ICONS = ['🧩', '📋', '📦', '🚚', '🧾', '🛠', '📅', '🏷', '📞', '🧪', '🏆', '💡', '🔧', '🗂', '📌', '🧹', '🍽', '🚌', '🎫', '❤'];
type Role = { code: string; name: string };

function ModuleFields({ m, roles }: { m?: CustomModule; roles: Role[] }) {
  const pick = (name: string, sel: string[]) => (
    <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-xs">
      {roles.map((r) => <label key={r.code} className="flex items-center gap-1"><input type="checkbox" name={name} value={r.code} defaultChecked={sel.includes(r.code)} /> {r.name}</label>)}
    </div>);
  return (
    <>
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field label="Nombre del módulo" name="name" required defaultValue={m?.name} placeholder="Ej.: Préstamo de equipos" />
        <label className="block"><span className="label">Ícono</span>
          <select name="icon" defaultValue={m?.icon ?? '🧩'} className="input text-lg">{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
        <label className="block"><span className="label">Código (4 letras)</span>
          <input name="code_prefix" defaultValue={m?.code_prefix} maxLength={4} pattern="[A-Za-z]{4}" placeholder="Auto" className="input w-24 uppercase" title="Los registros reciben un código automático: 4 letras + 6 números" /></label>
      </div>
      <TextArea label="Descripción (opcional)" name="description" defaultValue={m?.description} rows={2} />
      <FieldsEditor initial={m?.fields} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="label">👁 Quién lo ve <span className="font-normal text-slate-500">(sin marcar = todos)</span></p>{pick('view_roles', m?.view_roles ?? [])}</div>
        <div><p className="label">✏ Quién agrega y edita <span className="font-normal text-slate-500">(el propietario siempre)</span></p>{pick('edit_roles', m?.edit_roles ?? [])}</div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="show_in_menu" defaultChecked={m?.show_in_menu ?? true} /> Mostrar en el menú</label>
        <label className="flex items-center gap-2"><input type="hidden" name="active" value="off" /><input type="checkbox" name="active" value="on" defaultChecked={m?.active ?? true} /> Activo (disponible)</label>
      </div>
    </>
  );
}

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!ctx.isOwner) redirect('/app');
  const [{ data: mods }, { data: roles }, { data: menu }, { data: counts }] = await Promise.all([
    ctx.supabase.from('custom_modules').select('*').eq('organization_id', orgId).order('name'),
    ctx.supabase.from('roles').select('code, name, organization_id').order('name'),
    ctx.supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', 'menu.custom').maybeSingle(),
    ctx.supabase.from('custom_records').select('module_id').eq('organization_id', orgId).limit(20000),
  ]);
  const roleList = ((roles ?? []) as any[]).filter((r) => !r.organization_id || r.organization_id === orgId) as Role[];
  const roleName = new Map(roleList.map((r) => [r.code, r.name]));
  const n = new Map<string, number>(); (counts ?? []).forEach((c: any) => n.set(c.module_id, (n.get(c.module_id) ?? 0) + 1));
  const custom = (menu?.value ?? {}) as MenuCustom;
  const nav = baseNav(ctx);
  const typeName = new Map<string, string>(FIELD_TYPES as unknown as [string, string][]);
  return (
    <>
      <PageHeader title="🧩 Módulos y menú" subtitle="Agregue nuevas secciones al sistema, diseñe sus formularios y personalice el menú — sin tocar el código" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card title="➕ Nuevo módulo">
            <p className="mb-3 text-sm text-slate-600">Ejemplos: «Préstamo de equipos», «Reclamos», «Visitas», «Mantenciones», «Proveedores». Cada registro recibe un código automático (4 letras + 6 números).</p>
            <ActionForm action={saveModule} submitLabel="Crear módulo" resetOnSuccess={false}><ModuleFields roles={roleList} /></ActionForm>
          </Card>
          <Card title={`Módulos creados (${mods?.length ?? 0})`}>
            {mods?.length ? <ul className="divide-y divide-slate-100" data-testid="lista-modulos">{(mods as CustomModule[]).map((m) => (
              <li key={m.id} className="py-3 text-sm" data-testid="modulo">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base"><span className="mr-1">{m.icon}</span><b>{m.name}</b> <Badge color={m.active ? 'green' : 'gray'}>{m.active ? 'Disponible' : 'No disponible'}</Badge> {!m.show_in_menu && <Badge color="gray">Fuera del menú</Badge>}</span>
                  <Link className="link" href={`/app/m/${m.slug}`}>Abrir ({n.get(m.id) ?? 0} registros) →</Link>
                </div>
                <p className="mt-1 text-xs text-slate-500">Código {m.code_prefix}000001 · Campos: {m.fields.map((f) => `${f.label} (${typeName.get(f.type) ?? f.type}${f.required ? ', obligatorio' : ''})`).join(' · ')}</p>
                <p className="text-xs text-slate-500">👁 {m.view_roles.length ? m.view_roles.map((r) => roleName.get(r) ?? r).join(', ') : 'Todos'} · ✏ {m.edit_roles.length ? m.edit_roles.map((r) => roleName.get(r) ?? r).join(', ') : 'Solo el propietario'}</p>
                <div className="mt-1 flex gap-3">
                  <details><summary className="link cursor-pointer text-xs" data-testid="editar-modulo">✏ Editar módulo y campos</summary>
                    <div className="mt-2 rounded-xl border border-slate-200 p-3"><ActionForm action={saveModule} submitLabel="Guardar cambios" resetOnSuccess={false}><ModuleFields m={m} roles={roleList} /></ActionForm></div></details>
                  <ActionForm action={deleteModule} inline submitLabel="🗑 Eliminar" submitClass="text-xs text-red-600 hover:underline" confirm={`¿Eliminar el módulo «${m.name}» y todos sus registros?`}><input type="hidden" name="id" value={m.id} /></ActionForm>
                </div>
              </li>))}</ul> : <Empty>Aún no hay módulos. Cree el primero con el formulario.</Empty>}
          </Card>
        </div>
        <Card title="☰ Personalizar el menú">
          <p className="mb-3 text-sm text-slate-600">Cambie el nombre de cualquier opción u ocúltela para todos. Las opciones ocultas siguen funcionando para quien tenga el enlace y el permiso.</p>
          <ActionForm action={saveMenu} submitLabel="Guardar menú" resetOnSuccess={false}>
            <table className="w-full text-sm" data-testid="menu-personalizar">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Opción</th><th>Nombre en el menú</th><th className="text-center">Ocultar</th></tr></thead>
              <tbody>{nav.map((i) => (
                <tr key={i.href} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-xs text-slate-500">{i.icon} {i.label}</td>
                  <td className="py-1 pr-2"><input name={`label:${i.href}`} defaultValue={custom.labels?.[i.href] ?? ''} placeholder={i.label} maxLength={40} className="input py-1 text-sm" aria-label={`Nombre para ${i.label}`} /></td>
                  <td className="text-center">{LOCKED.has(i.href) ? <span className="text-xs text-slate-400">—</span>
                    : <input type="checkbox" name="hide" value={i.href} defaultChecked={custom.hidden?.includes(i.href)} aria-label={`Ocultar ${i.label}`} />}</td>
                </tr>))}</tbody>
            </table>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
