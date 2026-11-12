import { getContext } from '@/lib/context';
import { buildNav } from '@/lib/nav-items';
import { PageHeader } from '@/components/ui';
import { MAP_DESC, MAP_GROUPS } from '@/lib/platform-map';
import { AREAS, type AreaKey } from '@/lib/systems-catalog';
import { MapView } from './map-view';

export const metadata = { title: 'Mapa de la plataforma' };
export const dynamic = 'force-dynamic';

/** 🗺 Todos los sistemas de la plataforma a los que la persona tiene acceso, ordenados por área. */
export default async function Page() {
  const ctx = await getContext();
  const items = (await buildNav(ctx)).filter((i) => i.href !== '/app/mapa');
  const { data: sysRows } = ctx.orgId ? await ctx.supabase.rpc('my_systems', { p_org: ctx.orgId }) : { data: [] };
  const systems = (sysRows ?? []) as { slug: string; name: string; icon: string; area: string | null; description: string | null }[];
  const used = new Set<string>();
  const clean = (l: string) => l.replace(/ · 📨 \d+$/, '');
  const groups = MAP_GROUPS.map((g) => ({
    key: g.key, title: g.title, icon: g.icon, color: g.color,
    items: g.hrefs.map((h) => items.find((i) => i.href === h)).filter(Boolean).map((i) => { used.add(i!.href); return { href: i!.href, label: clean(i!.label), icon: i!.icon, desc: MAP_DESC[i!.href] ?? '' }; }),
  }));
  // Sistemas activados del catálogo, por área
  for (const [key, a] of Object.entries(AREAS) as [AreaKey, (typeof AREAS)[AreaKey]][]) {
    const its = systems.filter((s) => s.area === key).map((s) => { used.add(`/app/m/${s.slug}`); return { href: `/app/m/${s.slug}`, label: s.name, icon: s.icon, desc: s.description ?? '' }; });
    if (its.length) groups.push({ key: `sis-${key}`, title: a.title, icon: a.icon, color: a.color, items: its });
  }
  for (const s of systems.filter((x) => !x.area)) if (!items.some((i) => i.href === `/app/m/${s.slug}`)) items.push({ href: `/app/m/${s.slug}`, label: s.name, icon: s.icon });
  const extra = items.filter((i) => !used.has(i.href)).map((i) => ({ href: i.href, label: clean(i.label), icon: i.icon, desc: MAP_DESC[i.href] ?? 'Módulo de la institución' }));
  if (extra.length) groups.push({ key: 'otros', title: 'Módulos propios', icon: '🧩', color: 'from-lime-700 to-green-500', items: extra });
  const all = groups.filter((g) => g.items.length);
  const total = all.reduce((n, g) => n + g.items.length, 0);
  return (
    <div>
      <PageHeader title="🗺 Mapa de la plataforma" subtitle={`${total} sistemas en ${all.length} áreas, según sus permisos. Busque o entre directamente a cualquiera.`} />
      <MapView groups={all} />
    </div>
  );
}
