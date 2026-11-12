import { getT } from '@/lib/site-i18n';
import { getPublicSite, anonClient } from '@/lib/site';
import { ContactForm } from '@/components/public-forms';
import { sendContact } from '../actions';

export const metadata = { title: 'Contacto' };

export default async function Page({ searchParams }: { searchParams: Promise<{ curso?: string }> }) {
  const site = await getPublicSite();
  const { curso } = await searchParams;
  const t = await getT();
  const { data: c } = curso && /^[0-9a-f-]{36}$/.test(curso) ? await anonClient().from('catalog_offerings').select('id, title').eq('id', curso).maybeSingle() : { data: null };
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h1 className="text-3xl font-bold">{t('contact.title')}</h1>
        <p className="mt-2 text-slate-600">{t('contact.intro')}</p>
        <div className="mt-8"><ContactForm action={sendContact} offeringId={c?.id} offeringTitle={c?.title} /></div>
      </div>
      <aside className="h-fit space-y-3 rounded-2xl bg-slate-50 p-6 text-sm">
        <h2 className="font-bold">{site?.site_name}</h2>
        {site?.contact_email && <p>✉ {site.contact_email}</p>}
        {site?.contact_phone && <p>☎ {site.contact_phone}</p>}
        {site?.whatsapp && <p><a className="btn-primary btn-sm" href={`https://wa.me/${site.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">{t('contact.whatsapp')}</a></p>}
        {site?.address && <p>📍 {site.address}</p>}
        {site?.office_hours && <p>🕘 {site.office_hours}</p>}
      </aside>
    </main>
  );
}
