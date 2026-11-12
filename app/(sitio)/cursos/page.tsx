import { getPublicSite, anonClient } from '@/lib/site';
import { offeringAvailability } from '@/lib/availability';
import { CourseCard } from '@/components/course-card';
import { offeringPricing } from '@/lib/pricing';
import { getT } from '@/lib/site-i18n';

export const metadata = { title: 'Cursos y carreras disponibles' };

const KINDS = ['curso', 'carrera', 'diplomado', 'taller'];

export default async function Page({ searchParams }: { searchParams: Promise<{ tipo?: string; ofertas?: string; q?: string }> }) {
  const sp = await searchParams;
  const site = await getPublicSite();
  const t = await getT();
  const { data: all } = site ? await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id)
    .eq('is_published', true).order('sort_order').order('created_at') : { data: [] as any[] };
  const avail = site ? await offeringAvailability(site.organization_id) : new Map();
  const kinds = new Set((all ?? []).map((c: any) => c.kind ?? 'curso'));
  const q = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const data = (all ?? []).filter((c: any) => (!sp.tipo || (c.kind ?? 'curso') === sp.tipo) && (!sp.ofertas || offeringPricing(c).discounted)
    && (!q || `${c.title} ${c.summary ?? ''} ${c.category ?? ''}`.toLowerCase().includes(q)));
  const deals = (all ?? []).filter((c: any) => offeringPricing(c).discounted).length;
  const tab = (k: string, label: string, href: string, active: boolean) =>
    <a key={k} href={href} className={active ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{label}</a>;
  return (
    <main>
      <section className="bg-gradient-to-br from-ink via-brand-700 to-brand-600 text-white">
        <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8">
          <h1 className="text-4xl font-black md:text-5xl">{t('courses.title')}</h1>
          <p className="mt-3 max-w-2xl text-sky-100/90">{t('courses.subtitle')}</p>
          <form className="mt-8 flex max-w-xl gap-2" role="search">
            {sp.tipo && <input type="hidden" name="tipo" value={sp.tipo} />}
            <input name="q" defaultValue={sp.q ?? ''} placeholder={t('courses.search')} className="input flex-1 border-0 py-3 text-ink" aria-label={t('courses.search')} />
            <button className="btn bg-white px-5 text-ink hover:bg-sky-50" aria-label={t('courses.search')}>🔎</button>
          </form>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8">
        <nav className="flex flex-wrap gap-2">
          {tab('', t('courses.tab.all'), '?', !sp.tipo && !sp.ofertas)}
          {KINDS.filter((k) => kinds.has(k)).map((k) => tab(k, t(`courses.tab.${k}`), `?tipo=${k}`, sp.tipo === k && !sp.ofertas))}
          {deals > 0 && tab('ofertas', `🔥 ${t('courses.deals')} (${deals})`, '?ofertas=1', !!sp.ofertas)}
        </nav>
        <div className="mt-8 grid gap-7 md:grid-cols-2 lg:grid-cols-3">{data.map((c: any) => <CourseCard key={c.id} c={c} avail={avail.get(c.id)} t={t} />)}</div>
        {!data.length && <p className="mt-8 text-slate-500">{all?.length ? t('courses.noResults') : t('courses.none')}</p>}
      </div>
    </main>
  );
}
