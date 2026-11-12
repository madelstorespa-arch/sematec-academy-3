import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Stat } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { AREAS, CATALOG, type AreaKey } from '@/lib/systems-catalog';
import { installSystems, pinSystem, uninstallSystem } from './actions';
import { SystemsView } from './systems-view';

export const metadata = { title: 'Sistemas' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const [{ data: mine }, { data: mods }] = await Promise.all([
    ctx.supabase.rpc('my_systems', { p_org: orgId }),
    ctx.isOwner ? ctx.supabase.from('custom_modules').select('slug, catalog_key, active, show_in_menu').eq('organization_id', orgId) : Promise.resolve({ data: [] as any[] }),
  ]);
  const systems = (mine ?? []) as { slug: string; name: string; icon: string; area: string | null; description: string | null; manage: boolean; catalog_key: string | null; show_in_menu: boolean }[];
  const areas = [...(Object.entries(AREAS) as [AreaKey, (typeof AREAS)[AreaKey]][]).map(([key, a]) => ({ key, title: a.title, icon: a.icon, color: a.color })),
    { key: 'otros', title: 'Módulos propios de la institución', icon: '🧩', color: 'from-lime-700 to-green-500' }];
  const inst = new Map(((mods ?? []) as any[]).filter((m) => m.catalog_key).map((m) => [m.catalog_key as string, m]));
  const active = CATALOG.filter((s) => inst.get(s.key)?.active).length;
  const catalog = ctx.isOwner && v === 'catalogo';
  return (
    <div>
      <PageHeader title="🧩 Sistemas" subtitle={`${systems.length} sistema(s) disponibles para usted, ordenados por área. Cada uno con estados, responsables, plazos, adjuntos y aviso por correo.`}
        actions={ctx.isOwner ? <Link className={catalog ? 'btn-secondary' : 'btn-primary'} href={catalog ? '/app/sistemas' : '/app/sistemas?v=catalogo'} data-testid="ver-catalogo">{catalog ? '← Mis sistemas' : `📦 Catálogo (${CATALOG.length})`}</Link> : undefined} />
      {catalog ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Sistemas en el catálogo" value={CATALOG.length} />
            <Stat label="Activos" value={<span data-testid="sistemas-activos">{active}</span>} />
            <Stat label="Por activar" value={CATALOG.length - active} />
          </div>
          <Card className="mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-slate-600">Active todos los sistemas de una vez o elija por área. Puede desactivarlos cuando quiera: los datos se conservan.</p>
              <ActionForm action={installSystems} inline submitLabel={`⚡ Activar los ${CATALOG.length} sistemas`} submitClass="btn-primary"><input type="hidden" name="which" value="all" /></ActionForm>
            </div>
          </Card>
          {(Object.entries(AREAS) as [AreaKey, (typeof AREAS)[AreaKey]][]).map(([key, a]) => {
            const items = CATALOG.filter((s) => s.area === key);
            return (
              <section key={key} className="mb-8" data-testid={`catalogo-${key}`}>
                <div className={`mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r ${a.color} p-4 text-white`}>
                  <span className="text-3xl" aria-hidden>{a.icon}</span>
                  <span className="min-w-0 flex-1"><b className="block text-lg">{a.title} · {items.length}</b><span className="text-sm text-white/85">{a.text}</span></span>
                  <ActionForm action={installSystems} inline submitLabel="Activar toda el área" submitClass="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold hover:bg-white/30"><input type="hidden" name="which" value={`area:${key}`} /></ActionForm>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((s) => {
                    const m = inst.get(s.key);
                    return (
                      <div key={s.key} className={`card flex items-start gap-3 p-4 ${m?.active ? 'ring-1 ring-emerald-300' : ''}`} data-testid={`plantilla-${s.key}`}>
                        <span className="text-2xl" aria-hidden>{s.icon}</span>
                        <span className="min-w-0 flex-1">
                          <b className="block">{s.name}</b><span className="block text-xs text-slate-500">{s.description}</span>
                          <span className="mt-1 block text-[11px] text-slate-400">{s.fields.length} campos · {s.workflow.map((w) => w.label).join(' → ')}{s.features.self_service ? ' · autoservicio' : ''}</span>
                          <span className="mt-2 flex flex-wrap gap-2">
                            {m?.active ? <>
                              <Link className="btn-primary btn-sm" href={`/app/m/${m.slug}`}>Abrir</Link>
                              <ActionForm action={pinSystem} inline submitLabel={m.show_in_menu ? '📌 Quitar del menú' : '📌 Fijar en el menú'} submitClass="btn-secondary btn-sm"><input type="hidden" name="slug" value={m.slug} /><input type="hidden" name="on" value={m.show_in_menu ? '0' : '1'} /></ActionForm>
                              <ActionForm action={uninstallSystem} inline submitLabel="Desactivar" submitClass="btn-secondary btn-sm" confirm={`¿Desactivar «${s.name}»? Sus registros se conservan.`}><input type="hidden" name="key" value={s.key} /></ActionForm>
                            </> : <ActionForm action={installSystems} inline submitLabel="Activar" submitClass="btn-primary btn-sm"><input type="hidden" name="which" value={s.key} /></ActionForm>}
                          </span>
                        </span>
                      </div>);
                  })}
                </div>
              </section>);
          })}
        </>
      ) : systems.length ? <SystemsView systems={systems} areas={areas} />
        : <Card><p className="text-sm text-slate-600">Aún no hay sistemas activos.{ctx.isOwner && <> Active los {CATALOG.length} sistemas desde el <Link className="link" href="/app/sistemas?v=catalogo">Catálogo</Link>.</>}</p></Card>}
    </div>
  );
}
