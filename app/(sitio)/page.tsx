import Link from 'next/link';
import { getPublicSite, anonClient, mediaUrl } from '@/lib/site';
import { offeringAvailability } from '@/lib/availability';
import { CourseCard } from '@/components/course-card';
import { PriceTag } from '@/components/price-tag';
import { getT } from '@/lib/site-i18n';

const FEAT_ICONS = ['🎥', '📱', '🎓', '🔒', '🔎', '🧭'];

export default async function Home() {
  const site = await getPublicSite();
  const t = await getT();
  if (!site) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">{t('home.notReady.title')}</h1>
        <p className="mt-3 text-slate-600">{t('home.notReady.text')}</p>
        <Link href="/login" className="btn-primary mt-6">{t('nav.login')}</Link>
      </main>
    );
  }
  const { data: all } = await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id)
    .eq('is_published', true).order('sort_order').order('created_at');
  const courses = (all ?? []).slice(0, 6);
  const featured = courses[0];
  const avail = await offeringAvailability(site.organization_id);
  const hero = mediaUrl(site.hero_asset_id);
  const areas = new Set((all ?? []).map((c: any) => c.category || c.kind || 'curso')).size;
  const stats: [string, string][] = [
    [String(all?.length ?? 0), t('home.stat.courses')],
    [String(Math.max(areas, all?.length ? 1 : 0)), t('home.stat.kinds')],
    ['🎥', t('home.stat.live')],
    ['🔒', t('home.stat.pay')],
  ];
  const steps = [1, 2, 3, 4].map((n) => [t(`home.step${n}.t`), t(`home.step${n}.d`)]);
  const feats = [1, 2, 3, 4, 5, 6].map((n) => [t(`home.feat${n}.t`), t(`home.feat${n}.d`)]);
  const faqs = [1, 2, 3, 4, 5].map((n) => [t(`home.faq${n}.q`), t(`home.faq${n}.a`)]);
  return (
    <main>
      {/* Portada */}
      <section className="relative overflow-hidden bg-ink text-white" data-testid="portada">
        {hero
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
          : null}
        <div className="absolute inset-0 bg-gradient-to-br from-ink via-ink/90 to-brand-700/80" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 md:py-28 lg:grid-cols-5 lg:px-8">
          <div className="lg:col-span-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-sky-100">
              <span className="h-2 w-2 rounded-full bg-accent" />{site.site_name}
            </p>
            <h1 className="mt-6 text-4xl font-black leading-[1.05] md:text-6xl">{site.hero_title || site.tagline}</h1>
            {site.hero_subtitle && <p className="mt-6 max-w-2xl text-lg text-sky-100/85 md:text-xl">{site.hero_subtitle}</p>}
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/cursos" className="btn bg-white px-6 py-3 text-base text-ink shadow-lg hover:bg-sky-50">{t('home.ctaCourses')}</Link>
              <Link href="/contacto" className="btn border border-white/40 px-6 py-3 text-base text-white hover:bg-white/10">{t('home.ctaContact')}</Link>
              <Link href="/estado" className="btn px-4 py-3 text-base text-sky-100 underline-offset-4 hover:underline">{t('home.ctaStatus')} →</Link>
            </div>
          </div>
          {featured && (
            <Link href={`/cursos/${featured.slug}`} className="group hidden rounded-3xl border border-white/15 bg-white/10 p-3 shadow-2xl backdrop-blur-md transition hover:-translate-y-1 lg:col-span-2 lg:block">
              {mediaUrl(featured.image_asset_id)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={mediaUrl(featured.image_asset_id)!} alt="" className="h-48 w-full rounded-2xl object-cover" />
                : <div className="h-48 w-full rounded-2xl bg-gradient-to-br from-brand-500 to-accent" />}
              <div className="rounded-2xl bg-white p-5 text-ink">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{t(`kind.${featured.kind ?? 'curso'}`)}</p>
                <p className="mt-1 text-lg font-bold group-hover:text-brand-700">{featured.title}</p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <PriceTag c={featured} t={t} />
                  <span className="btn-primary btn-sm">{featured.admission_mode === 'application' ? t('card.apply') : t('card.enroll')}</span>
                </div>
              </div>
            </Link>
          )}
        </div>
      </section>

      {/* Cifras reales del catálogo */}
      <section className="relative z-10 mx-auto -mt-10 max-w-6xl px-4 lg:px-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-slate-200 bg-slate-200 shadow-xl md:grid-cols-4">
          {stats.map(([v, l]) => (
            <div key={l} className="bg-white px-6 py-6 text-center">
              <p className="text-3xl font-black text-brand-700">{v}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{l}</p>
            </div>))}
        </div>
      </section>

      {site.highlights?.length > 0 && (
        <section className="mx-auto grid max-w-7xl gap-6 px-4 pt-20 md:grid-cols-3 lg:px-8">
          {site.highlights.map((h, i) => (
            <div key={i} className="rounded-3xl border border-slate-200 p-7 transition hover:shadow-lg">
              <div className="mb-4 h-1.5 w-12 rounded-full bg-accent" />
              <h3 className="text-lg font-bold">{h.title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{h.text}</p>
            </div>))}
        </section>
      )}

      {/* Cómo inscribirte */}
      <section className="mx-auto max-w-7xl px-4 pt-20 lg:px-8" data-testid="pasos-inscripcion">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-600">{t('home.steps.kicker')}</p>
        <h2 className="mt-2 text-3xl font-black md:text-4xl">{t('home.steps.title')}</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, text], i) => (
            <li key={title} className="relative rounded-3xl bg-slate-50 p-7">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600 text-lg font-black text-white shadow-md">{i + 1}</span>
              <h3 className="mt-5 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
            </li>))}
        </ol>
      </section>

      {/* Catálogo */}
      <section className="mx-auto max-w-7xl px-4 pt-20 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-3xl font-black md:text-4xl">{t('home.courses.title')}</h2>
          <Link className="btn-secondary" href="/cursos">{t('home.courses.all')} →</Link>
        </div>
        {courses.length ? <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">{courses.map((c: any) => <CourseCard key={c.id} c={c} avail={avail.get(c.id)} t={t} />)}</div>
          : <p className="text-slate-500">{t('home.courses.empty')}</p>}
      </section>

      {/* Plataforma */}
      <section className="mt-24 bg-gradient-to-b from-brand-50 to-white py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-600">{t('home.feat.kicker')}</p>
          <h2 className="mt-2 text-3xl font-black md:text-4xl">{t('home.feat.title')}</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {feats.map(([title, text], i) => (
              <div key={title} className="rounded-3xl border border-white bg-white/80 p-7 shadow-sm backdrop-blur transition hover:shadow-lg">
                <span className="text-3xl" aria-hidden>{FEAT_ICONS[i]}</span>
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>))}
          </div>
        </div>
      </section>

      {/* App */}
      <section className="mx-auto max-w-7xl px-4 pt-8 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-ink p-8 text-white md:flex-row md:items-center md:p-12">
          <div>
            <h2 className="text-2xl font-black md:text-3xl">📱 {t('home.app.title')}</h2>
            <p className="mt-2 max-w-xl text-sky-100/85">{t('home.app.text')}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-sky-200">Android · iPhone · Windows · Mac · Linux</p>
          </div>
          <Link href="/descargar" className="btn shrink-0 bg-white px-6 py-3 text-base text-ink hover:bg-sky-50">{t('home.app.cta')}</Link>
        </div>
      </section>

      {site.about_text && (
        <section className="mx-auto max-w-7xl px-4 pt-20 lg:px-8">
          <div className="grid gap-8 rounded-3xl border border-slate-200 p-8 md:grid-cols-3 md:p-12">
            <h2 className="text-2xl font-black md:text-3xl">{t('home.about.title', { name: site.site_name })}</h2>
            <div className="md:col-span-2">
              <p className="whitespace-pre-line leading-relaxed text-slate-700">{site.about_text.slice(0, 700)}{site.about_text.length > 700 ? '…' : ''}</p>
              <Link href="/nosotros" className="btn-primary mt-6">{t('home.about.more')}</Link>
            </div>
          </div>
        </section>
      )}

      {/* Preguntas frecuentes */}
      <section className="mx-auto max-w-4xl px-4 pt-20 lg:px-8" data-testid="faq">
        <h2 className="text-center text-3xl font-black md:text-4xl">{t('home.faq.title')}</h2>
        <div className="mt-8 divide-y divide-slate-200 rounded-3xl border border-slate-200">
          {faqs.map(([q, a]) => (
            <details key={q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}<span className="text-brand-600 transition group-open:rotate-45">＋</span></summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{a}</p>
            </details>))}
        </div>
      </section>

      {/* Llamado final */}
      <section className="mx-auto max-w-7xl px-4 pt-20 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-accent p-10 text-center text-white md:p-16">
          <h2 className="text-3xl font-black md:text-4xl">{t('home.cta.title')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/90">{t('home.cta.text')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/cursos" className="btn bg-white px-6 py-3 text-base text-ink hover:bg-sky-50">{t('home.ctaCourses')}</Link>
            <Link href="/contacto" className="btn border border-white/50 px-6 py-3 text-base text-white hover:bg-white/10">{t('home.ctaContact')}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
