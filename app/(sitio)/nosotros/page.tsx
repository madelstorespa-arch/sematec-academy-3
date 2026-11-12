import { getT } from '@/lib/site-i18n';
import { getPublicSite } from '@/lib/site';

export const metadata = { title: 'Nosotros' };

export default async function Page() {
  const site = await getPublicSite();
  const t = await getT();
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t('about.title', { name: site?.site_name ?? '' })}</h1>
      {site?.tagline && <p className="mt-2 text-lg text-slate-600" translate="yes">{site.tagline}</p>}
      <div className="mt-8 whitespace-pre-line leading-relaxed text-slate-700" translate="yes">{site?.about_text}</div>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {site?.mission && <div className="rounded-2xl bg-brand-50 p-6"><h2 className="font-bold text-brand-700">{t('about.mission')}</h2><p className="mt-2 whitespace-pre-line text-slate-700" translate="yes">{site.mission}</p></div>}
        {site?.vision && <div className="rounded-2xl bg-slate-50 p-6"><h2 className="font-bold">{t('about.vision')}</h2><p className="mt-2 whitespace-pre-line text-slate-700" translate="yes">{site.vision}</p></div>}
      </div>
    </main>
  );
}
