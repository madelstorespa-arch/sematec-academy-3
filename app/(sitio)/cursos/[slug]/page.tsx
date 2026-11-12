import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicSite, anonClient, mediaUrl } from '@/lib/site';
import { availClass, availText } from '@/components/course-card';
import { fmtDate } from '@/lib/format';
import { PriceTag } from '@/components/price-tag';
import { offeringAvailability } from '@/lib/availability';
import { PriceBreakdown } from '@/components/price-breakdown';
import { getT } from '@/lib/site-i18n';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getPublicSite();
  if (!site) notFound();
  const { data: c } = await anonClient().from('catalog_offerings').select('*').eq('organization_id', site.organization_id).eq('slug', slug).eq('is_published', true).maybeSingle();
  if (!c) notFound();
  const t = await getT();
  const av = (await offeringAvailability(site.organization_id)).get(c.id);
  const img = mediaUrl(c.image_asset_id);
  const apply = c.admission_mode === 'application';
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>;
  return (
    <main>
      <section className="bg-gradient-to-br from-ink via-brand-700 to-brand-600 text-white">
        <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8 lg:py-20">
          <Link href="/cursos" className="text-sm font-semibold text-sky-200 hover:text-white">← {t('nav.courses')}</Link>
          <p className="mt-4 text-sm font-bold uppercase tracking-[0.2em] text-sky-200">{[t(`kind.${c.kind ?? 'curso'}`), c.category].filter(Boolean).join(' · ')}</p>
          <h1 className="mt-2 max-w-4xl text-4xl font-black leading-tight md:text-5xl">{c.title}</h1>
          {c.summary && <p className="mt-4 max-w-3xl text-lg text-sky-100/90">{c.summary}</p>}
          <div className="mt-6 flex flex-wrap gap-2 text-sm">
            {c.modality && <span className="rounded-full bg-white/15 px-3 py-1">{t(`mod.${c.modality}`)}</span>}
            {c.duration_text && <span className="rounded-full bg-white/15 px-3 py-1">⏱ {c.duration_text}</span>}
            {c.starts_on && <span className="rounded-full bg-white/15 px-3 py-1">📅 {fmtDate(c.starts_on)}</span>}
          </div>
        </div>
      </section>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 lg:grid-cols-3 lg:px-8">
        <article className="lg:col-span-2">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={c.title} className="mb-8 w-full rounded-3xl object-cover shadow-lg" />
          )}
          <div className="whitespace-pre-line text-lg leading-relaxed text-slate-700">{c.description}</div>
        </article>
        <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-xl lg:sticky lg:top-24 lg:-mt-32">
          <PriceTag c={c} size="lg" t={t} />
          <PriceBreakdown c={c} />
          <dl className="mt-5 space-y-2 text-sm">
            {c.modality && row(t('detail.modality'), t(`mod.${c.modality}`))}
            {c.duration_text && row(t('detail.duration'), c.duration_text)}
            {c.schedule_text && row(t('detail.schedule'), c.schedule_text)}
            {c.starts_on && row(t('detail.start'), fmtDate(c.starts_on))}
            {row(t('detail.admission'), apply ? t('detail.withApplication') : t('detail.immediate'))}
          </dl>
          {av && <p className={`mt-4 text-sm font-semibold ${availClass(av)}`} data-testid="cupos">{availText(av, t, true)}</p>}
          {av && (av.status === 'agotado' || av.status === 'cerrado')
            ? <p className="mt-4 rounded-lg bg-slate-100 p-3 text-center text-sm font-semibold text-slate-600" data-testid="no-disponible">{t('detail.unavailable')}</p>
            : <Link href={`/cursos/${c.slug}/inscripcion`} className="btn-primary mt-6 w-full py-3 text-base">{apply ? t('detail.apply') : t('detail.enrollPay')}</Link>}
          <p className="mt-3 text-center text-xs text-slate-500">{apply ? t('detail.applyNote') : t('detail.payNote')}</p>
          <Link href={`/contacto?curso=${c.id}`} className="mt-4 block text-center text-sm link">{t('detail.questions')}</Link>
        </aside>
      </div>
    </main>
  );
}
