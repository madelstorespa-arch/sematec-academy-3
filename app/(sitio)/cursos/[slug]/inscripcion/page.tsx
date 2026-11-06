import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicSite, anonClient } from '@/lib/site';
import { availableProviders } from '@/lib/payments';
import { ApplicationForm, CheckoutForm } from '@/components/public-forms';
import { fmtMoney } from '@/lib/format';
import { applyToCourse, startCheckout } from '../../../actions';

export const metadata = { title: 'Inscripción' };

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ codigo?: string }> }) {
  const { slug } = await params;
  const { codigo } = await searchParams;
  const site = await getPublicSite();
  if (!site) notFound();
  const sb = anonClient();
  const [{ data: c }, { data: countries }] = await Promise.all([
    sb.from('catalog_offerings').select('*').eq('organization_id', site.organization_id).eq('slug', slug).eq('is_published', true).maybeSingle(),
    sb.from('countries').select('code, name').order('name'),
  ]);
  if (!c) notFound();
  const payStep = c.admission_mode === 'direct' || !!codigo;
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href={`/cursos/${c.slug}`} className="link text-sm">← {c.title}</Link>
      <h1 className="mt-3 text-3xl font-bold">{payStep ? 'Inscripción y pago' : 'Postulación'}</h1>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-4">
        <span className="font-semibold">{c.title}</span><span className="text-xl font-black">{fmtMoney(c.price, c.currency)}</span>
      </div>
      <div className="mt-8">
        {payStep ? (
          <>
            {codigo && <p className="mb-4 rounded-lg bg-brand-50 p-3 text-sm">Pago de la postulación aprobada <b>{codigo}</b>. Use el mismo correo de la postulación.</p>}
            <CheckoutForm action={startCheckout} offeringId={c.id} providers={availableProviders(c.currency)} countries={countries ?? []} trackingCode={codigo} />
          </>
        ) : (
          <>
            <p className="mb-6 text-slate-600">Complete su postulación. Recibirá un código de seguimiento; cuando sea aprobada, podrá pagar en línea y obtendrá su acceso.</p>
            <ApplicationForm action={applyToCourse} offeringId={c.id} countries={countries ?? []} />
          </>
        )}
      </div>
    </main>
  );
}
