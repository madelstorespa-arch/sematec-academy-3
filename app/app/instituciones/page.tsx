import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Tabs, Badge, Stat } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { countryOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { approveRequest, createOrganization, deleteExternal, rejectRequest, saveExternal, setPlatform } from './actions';
import { DeployGuide } from './deploy-guide';
import { RequestDecision } from './request-decision';

export const metadata = { title: 'Plataformas y organizaciones' };

type Org = { id: string; slug: string; display_name: string; legal_name: string; platform_mode: string; org_kind: string; status: string; country_code: string; created_at: string; members: number; rooms: number; sessions: number; recordings: number; owner_names: string | null };

const KINDS: [string, string][] = [['institucion', 'Institución'], ['instituto', 'Instituto'], ['colegio', 'Colegio'], ['universidad', 'Universidad'], ['asociacion', 'Asociación'], ['organizacion', 'Organización'], ['fundacion', 'Fundación'], ['iglesia', 'Iglesia'], ['empresa', 'Empresa'], ['otro', 'Otro']];
const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
const WANTS: Record<string, string> = { aula: '🎥 Aula virtual', completo: '🏛 Plataforma completa', independiente: '🗄 Independiente (base propia)' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; eliminada?: string; filas?: string; archivos?: string; cuentas?: string }> }) {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) notFound();
  const sp = await searchParams;
  const tab = sp.tab ?? 'organizaciones';
  const [{ data: orgsData, error }, { data: reqs }, { data: ext }, countries] = await Promise.all([
    ctx.supabase.rpc('platform_overview'),
    ctx.supabase.from('org_signup_requests').select('*').order('created_at', { ascending: false }).limit(200),
    ctx.supabase.from('external_platforms').select('*').order('created_at'),
    countryOptions(ctx),
  ]);
  const orgs = (orgsData ?? []) as Org[];
  const pending = (reqs ?? []).filter((r: any) => r.status === 'pendiente');
  const repo = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : 'madelstorespa-arch/sematec-academy-3';
  return (
    <>
      <PageHeader title="Plataformas y organizaciones" subtitle="Cada organización tiene su propio espacio aislado: usuarios, salas, grabaciones, marca y enlace." />
      {sp.eliminada && <p role="status" data-testid="org-eliminada" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ «{String(sp.eliminada).slice(0, 200)}» fue eliminada: {Number(sp.filas) || 0} registros, {Number(sp.archivos) || 0} archivos{Number(sp.cuentas) ? ` y ${Number(sp.cuentas)} cuentas` : ''}.</p>}
      {error && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Falta actualizar la base de datos: entre en ⬆ Actualizar sistema → Aplicar.</p>}
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Organizaciones" value={orgs.length} />
        <Stat label="Solo aula virtual" value={orgs.filter((o) => o.platform_mode === 'aula').length} />
        <Stat label="Solicitudes pendientes" value={pending.length} href="/app/instituciones?tab=solicitudes" />
        <Stat label="Independientes" value={(ext ?? []).length} href="/app/instituciones?tab=independientes" />
      </div>
      <Tabs current={tab} items={[
        { key: 'organizaciones', label: '🌎 Organizaciones', href: '/app/instituciones' },
        { key: 'solicitudes', label: `📨 Solicitudes${pending.length ? ` (${pending.length})` : ''}`, href: '/app/instituciones?tab=solicitudes' },
        { key: 'independientes', label: '🗄 Plataformas independientes', href: '/app/instituciones?tab=independientes' },
      ]} />

      {tab === 'organizaciones' && <>
        <Card title="Nueva organización" className="mb-6">
          <ActionForm action={createOrganization} submitLabel="Crear organización" id="nueva-org">
            <Grid cols={3}>
              <Field label="Nombre visible" name="display_name" required />
              <Field label="Razón social (opcional)" name="legal_name" />
              <Field label="Enlace (opcional)" name="slug" placeholder="mi-instituto" />
              <SelectField label="Tipo de plataforma" name="platform_mode" required defaultValue="aula" options={[{ value: 'aula', label: '🎥 Solo aula virtual' }, { value: 'completo', label: '🏛 Sistema completo' }]} />
              <SelectField label="Tipo de organización" name="org_kind" required defaultValue="organizacion" options={KINDS.map(([value, label]) => ({ value, label }))} />
              <SelectField label="País" name="country" required options={countries} defaultValue="CL" />
              <Field label="Nombre del propietario" name="owner_name" required />
              <Field label="Correo del propietario" name="owner_email" type="email" required />
              <Field label="Identificador tributario" name="tax_id" />
            </Grid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="invite" /> Invitar al propietario por correo (requiere SMTP)</label>
            <p className="text-xs text-slate-500">Para eliminar una organización: primero «Suspender» y luego «🗑 Eliminar». La moneda y la zona horaria se toman del país. El superadministrador no ve los datos personales de la organización: solo su propietario y quienes él autorice.</p>
          </ActionForm>
        </Card>
        <Card title="Organizaciones">{orgs.length ? <div className="overflow-x-auto"><table className="table" data-testid="tabla-orgs"><thead><tr><th>Organización</th><th>Tipo</th><th>Enlace</th><th>Uso</th><th>Estado</th><th></th></tr></thead>
          <tbody>{orgs.map((o) => <tr key={o.id} data-org={o.slug}>
            <td><b>{o.display_name}</b><br /><span className="text-xs text-slate-500">{kindLabel(o.org_kind)} · {o.country_code} · desde {fmtDate(o.created_at)}{o.owner_names ? ` · 👤 ${o.owner_names}` : ''}</span></td>
            <td>{o.platform_mode === 'aula' ? <Badge color="blue">🎥 Aula</Badge> : <Badge color="green">🏛 Completo</Badge>}</td>
            <td><a className="link text-xs" href={`/o/${o.slug}`} target="_blank" rel="noreferrer">/o/{o.slug}</a></td>
            <td className="text-xs text-slate-600">👥 {o.members} · 🎥 {o.rooms} salas · {o.sessions} clases · ⏺ {o.recordings}</td>
            <td><StatusBadge status={o.status} /></td>
            <td className="space-y-1">
              <ActionForm action={setPlatform} inline submitLabel="Cambiar tipo" submitClass="btn-secondary text-xs" resetOnSuccess={false}>
                <input type="hidden" name="org" value={o.id} /><input type="hidden" name="platform_mode" value={o.platform_mode === 'aula' ? 'completo' : 'aula'} />
              </ActionForm>
              {o.status !== 'active' && <a className="btn-secondary block text-center text-xs text-red-700" href={`/app/instituciones/eliminar/${o.id}`} data-testid="eliminar-org">🗑 Eliminar</a>}
              <ActionForm action={setPlatform} inline submitLabel={o.status === 'active' ? 'Suspender' : 'Reactivar'} submitClass="btn-secondary text-xs" resetOnSuccess={false}
                confirm={o.status === 'active' ? `¿Suspender ${o.display_name}? Sus miembros no podrán entrar hasta reactivarla.` : undefined}>
                <input type="hidden" name="org" value={o.id} /><input type="hidden" name="status" value={o.status === 'active' ? 'inactive' : 'active'} />
              </ActionForm>
            </td></tr>)}</tbody></table></div>
          : <Empty>Aún no hay organizaciones.</Empty>}</Card>
        <p className="mt-4 text-sm text-slate-600">Formulario público para que una organización pida su plataforma: <a className="link" href="/registro-organizacion" target="_blank" rel="noreferrer">/registro-organizacion</a> (compártalo en su sitio o por WhatsApp).</p>
      </>}

      {tab === 'solicitudes' && <Card title="Solicitudes de organizaciones">
        {(reqs ?? []).length ? <ul className="divide-y divide-slate-100" data-testid="solicitudes-org">{(reqs ?? []).map((r: any) => (
          <li key={r.id} className="py-4" data-solicitud={r.org_name}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-bold">{r.org_name} <span className="text-xs font-normal text-slate-500">· {kindLabel(r.org_kind)} · {r.country_code}</span></p>
                <p className="text-sm">{WANTS[r.wants] ?? r.wants}{r.members_estimate ? ` · ~${r.members_estimate} personas` : ''}</p>
                <p className="text-xs text-slate-600">{r.contact_name} · {r.contact_email}{r.phone ? ` · ${r.phone}` : ''} · {fmtDate(r.created_at)}</p>
                {r.message && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">“{r.message}”</p>}</div>
              <Badge color={r.status === 'pendiente' ? 'amber' : r.status === 'aprobada' ? 'green' : 'gray'}>{r.status}</Badge>
            </div>
            <RequestDecision id={r.id} pending={r.status === 'pendiente'} wants={r.wants} approve={approveRequest} reject={rejectRequest}
              slug={r.org_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)} />
            {r.status !== 'pendiente' && <p className="mt-1 text-xs text-slate-500">{r.status === 'aprobada' ? 'Aprobada' : 'Rechazada'} el {fmtDate(r.decided_at)}{r.decision_note ? ` · ${r.decision_note}` : ''}</p>}
          </li>))}</ul> : <Empty>No hay solicitudes. Comparta el enlace <a className="link" href="/registro-organizacion">/registro-organizacion</a>.</Empty>}
      </Card>}

      {tab === 'independientes' && <>
        <Card title="Crear una plataforma independiente (con su propia base de datos)" className="mb-6"><DeployGuide repo={repo} /></Card>
        <Card title="Directorio de plataformas independientes" className="mb-6">
          {(ext ?? []).length ? <table className="table" data-testid="tabla-independientes"><thead><tr><th>Plataforma</th><th>Contacto</th><th>Estado</th><th></th></tr></thead>
            <tbody>{(ext ?? []).map((p: any) => <tr key={p.id}>
              <td><b>{p.name}</b><br /><a className="link text-xs" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>{p.notes && <p className="text-xs text-slate-500">{p.notes}</p>}</td>
              <td className="text-xs">{p.contact_name}<br />{p.contact_email}</td>
              <td><Badge color={p.status === 'activa' ? 'green' : p.status === 'suspendida' ? 'gray' : 'amber'}>{p.status.replace('_', ' ')}</Badge></td>
              <td><ActionForm action={deleteExternal} inline submitLabel="Quitar" submitClass="btn-secondary text-xs" confirm="¿Quitar del directorio? La plataforma seguirá funcionando."><input type="hidden" name="id" value={p.id} /></ActionForm></td>
            </tr>)}</tbody></table> : <Empty>Aún no hay plataformas independientes.</Empty>}
        </Card>
        <Card title="Agregar al directorio">
          <ActionForm action={saveExternal} submitLabel="Agregar" id="nueva-independiente">
            <Grid cols={2}>
              <Field label="Nombre" name="name" required /><Field label="Dirección (https://…)" name="url" required placeholder="https://mi-instituto.vercel.app" />
              <Field label="Contacto" name="contact_name" /><Field label="Correo del contacto" name="contact_email" type="email" />
              <SelectField label="Estado" name="status" defaultValue="activa" options={[{ value: 'activa', label: 'Activa' }, { value: 'en_instalacion', label: 'En instalación' }, { value: 'suspendida', label: 'Suspendida' }]} />
              <Field label="Notas" name="notes" />
            </Grid>
          </ActionForm>
        </Card>
      </>}
    </>
  );
}
