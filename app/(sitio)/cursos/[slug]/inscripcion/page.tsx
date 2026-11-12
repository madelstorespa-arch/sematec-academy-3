import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicSite, anonClient, mediaUrl } from '@/lib/site';
import { availableProviders } from '@/lib/payments';
import { ApplicationForm, CheckoutForm } from '@/components/public-forms';
import { PriceTag } from '@/components/price-tag';
import { PriceBreakdown } from '@/components/price-breakdown';
import { offeringBreakdown } from '@/lib/pricing';
import { fmtMoney } from '@/lib/format';
import { getT } from '@/lib/site-i18n';
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
  const t = await getT();
  const payStep = c.admission_mode === 'direct' || !!codigo;
  const b = offeringBreakdown(c);
  const img = mediaUrl(c.image_asset_id);
  const money = (n: number) => fmtMoney(n, c.currency);
  const steps = c.admission_mode === 'application' ? [t('insc.titleApply'), t('form.payMethod'), t('home.step4.t')] : [t('insc.titlePay'), t('form.payMethod'), t('home.step4.t')];
  const current = payStep && c.admission_mode === 'application' ? 1 : 0;
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 lg:px-8">
      <Link href={`/cursos/${c.slug}`} className="link text-sm">← {c.title}</Link>
      <h1 className="mt-3 text-3xl font-black md:text-4xl">{payStep ? t('insc.titlePay') : t('insc.titleApply')}</h1>
      <ol className="mt-5 flex flex-wrap gap-2 text-sm" aria-label="Pasos">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold ${i === current ? 'bg-brand-600 text-white' : i < current ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-xs">{i < current ? '✓' : i + 1}</span>{s}
          </li>))}
      </ol>
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {payStep ? (
            <>
              {codigo && <p className="mb-4 rounded-lg bg-brand-50 p-3 text-sm">{t('insc.approved', { code: codigo })}</p>}
              <CheckoutForm action={startCheckout} offeringId={c.id} providers={availableProviders(c.currency)} countries={countries ?? []} trackingCode={codigo}>
                {b.canSplit && (
                  <fieldset data-testid="plan-pago">
                    <legend className="label">{t('insc.plan')}</legend>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-300 p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                        <input type="radio" name="plan" value="total" defaultChecked className="mt-1" data-testid="plan-total" />
                        <span><b>{t('insc.plan.total')}</b><br /><span className="text-xs text-slate-600">{t('insc.plan.totalD', { amount: money(b.total) })}</span></span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-300 p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                        <input type="radio" name="plan" value="matricula" className="mt-1" data-testid="plan-matricula" />
                        <span><b>{t('insc.plan.fee')}</b><br /><span className="text-xs text-slate-600">{t('insc.plan.feeD', { fee: money(b.fee), n: b.installments, each: money(b.each) })}</span></span>
                      </label>
                    </div>
                  </fieldset>
                )}
              </CheckoutForm>
            </>
          ) : (
            <>
              <p className="mb-6 text-slate-600">{t('insc.applyIntro')}</p>
              <ApplicationForm action={applyToCourse} offeringId={c.id} countries={countries ?? []} />
            </>
          )}
        </div>
        <aside className="h-fit overflow-hidden rounded-3xl border border-slate-200 shadow-sm lg:sticky lg:top-24">
          {img
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={img} alt="" className="h-36 w-full object-cover" />
            : <div className="h-24 w-full bg-gradient-to-br from-brand-600 to-accent" />}
          <div className="p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{t(`kind.${c.kind ?? 'curso'}`)}</p>
            <p className="mt-1 text-lg font-bold">{c.title}</p>
            <div className="mt-4"><PriceTag c={c} t={t} /></div>
            <PriceBreakdown c={c} />
          </div>
        </aside>
      </div>
    </main>
  );
}
