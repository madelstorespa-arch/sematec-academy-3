import { getPublicSite, anonClient } from '@/lib/site';
import { offeringAvailability } from '@/lib/availability';
import { CourseCard } from '@/components/course-card';
import { offeringPricing } from '@/lib/pricing';

export const metadata = { title: 'Cursos y carreras disponibles' };

const TABS = [['', 'Todo'], ['curso', 'Cursos disponibles'], ['carrera', 'Carreras disponibles'], ['diplomado', 'Diplomados'], ['taller', 'Talleres']];

export default async function Page({ searchParams }: { searchParams: Promise<{ tipo?: string; ofertas?: string }> }) {
  const sp = await searchParams;
  const site = await getPublicSite();
  const { data: all } = site ? await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id)
    .eq('is_published', true).order('sort_order').order('created_at') : { data: [] as any[] };
  const avail = site ? await offeringAvailability(site.organization_id) : new Map();
  const kinds = new Set((all ?? []).map((c: any) => c.kind ?? 'curso'));
  const data = (all ?? []).filter((c: any) => (!sp.tipo || (c.kind ?? 'curso') === sp.tipo) && (!sp.ofertas || offeringPricing(c).discounted));
  const deals = (all ?? []).filter((c: any) => offeringPricing(c).discounted).length;
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Cursos y carreras</h1>
      <p className="mt-2 text-slate-600">Precios finales. Pague con tarjeta de crédito o débito, o directo desde su banco.</p>
      <nav className="mt-6 flex flex-wrap gap-2">
        {TABS.filter(([k]) => !k || kinds.has(k)).map(([k, l]) => (
          <a key={k} href={k ? `?tipo=${k}` : '?'} className={(sp.tipo ?? '') === k && !sp.ofertas ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{l}</a>))}
        {deals > 0 && <a href="?ofertas=1" className={sp.ofertas ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>🔥 Con descuento ({deals})</a>}
      </nav>
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{data.map((c: any) => <CourseCard key={c.id} c={c} avail={avail.get(c.id)} />)}</div>
      {!data.length && <p className="mt-8 text-slate-500">{all?.length ? 'No hay resultados en esta categoría.' : 'Aún no hay cursos publicados.'}</p>}
    </main>
  );
}
