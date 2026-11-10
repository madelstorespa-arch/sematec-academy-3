import Link from 'next/link';
import { getPublicSite, anonClient, mediaUrl } from '@/lib/site';
import { offeringAvailability } from '@/lib/availability';
import { CourseCard } from '@/components/course-card';

export default async function Home() {
  const site = await getPublicSite();
  if (!site) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">Sitio en preparación</h1>
        <p className="mt-3 text-slate-600">La institución aún no publica su sitio web. Si ya tiene cuenta, puede ingresar a la plataforma.</p>
        <Link href="/login" className="btn-primary mt-6">Ingresar</Link>
      </main>
    );
  }
  const { data: courses } = await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id)
    .eq('is_published', true).order('sort_order').order('created_at').limit(6);
  const avail = await offeringAvailability(site.organization_id);
  const hero = mediaUrl(site.hero_asset_id);
  return (
    <main>
      <section className="relative overflow-hidden bg-ink text-white">
        {hero && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        )}
        <div className="relative mx-auto max-w-6xl px-4 py-24 md:py-32">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-sky-200">{site.site_name}</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight md:text-5xl">{site.hero_title || site.tagline}</h1>
          {site.hero_subtitle && <p className="mt-5 max-w-2xl text-lg text-sky-100/85">{site.hero_subtitle}</p>}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/cursos" className="btn bg-white text-ink hover:bg-sky-50">Ver cursos y precios</Link>
            <Link href="/contacto" className="btn border border-white/40 text-white hover:bg-white/10">Contáctanos</Link>
          </div>
        </div>
      </section>
      {site.highlights?.length > 0 && (
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
          {site.highlights.map((h, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 p-6">
              <div className="mb-3 h-1.5 w-10 rounded-full bg-accent" />
              <h3 className="text-lg font-bold">{h.title}</h3><p className="mt-2 text-sm text-slate-600">{h.text}</p>
            </div>))}
        </section>
      )}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6 flex items-end justify-between"><h2 className="text-2xl font-bold">Cursos y programas</h2><Link className="link" href="/cursos">Ver todos →</Link></div>
        {courses?.length ? <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{courses.map((c: any) => <CourseCard key={c.id} c={c} avail={avail.get(c.id)} />)}</div>
          : <p className="text-slate-500">Pronto publicaremos nuestra oferta.</p>}
      </section>
      {site.about_text && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="rounded-3xl bg-brand-50 p-8 md:p-12">
            <h2 className="text-2xl font-bold">Sobre {site.site_name}</h2>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-slate-700">{site.about_text.slice(0, 600)}{site.about_text.length > 600 ? '…' : ''}</p>
            <Link href="/nosotros" className="btn-primary mt-6">Conócenos</Link>
          </div>
        </section>
      )}
    </main>
  );
}
