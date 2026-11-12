import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicSite, anonClient } from '@/lib/site';
import { availableProviders } from '@/lib/payments';
import { CheckoutForm } from '@/components/public-forms';
import { fmtMoney } from '@/lib/format';
import { getT } from '@/lib/site-i18n';
import { startRegistration } from '../actions';

export const metadata = { title: 'Inscripción' };

type Cfg = { enabled: boolean; fee: number; currency: string; title: string; intro: string; ask_birth: boolean; ask_address: boolean; ask_education: boolean; ask_guardian: boolean };

export default async function Page() {
  const site = await getPublicSite();
  if (!site) notFound();
  const t = await getT();
  const sb = anonClient();
  const [{ data: cfg }, { data: countries }] = await Promise.all([
    sb.rpc('registration_info', { p_org: site.organization_id }),
    sb.from('countries').select('code, name').order('name'),
  ]);
  const c = cfg as Cfg | null;
  const fee = Number(c?.fee ?? 0);
  const money = fmtMoney(fee, c?.currency ?? 'CLP');
  const steps = [t('reg.step1'), fee > 0 ? t('reg.step2') : null, t('reg.step3'), t('reg.step4')].filter(Boolean) as string[];
  const In = ({ name, label, type = 'text' }: { name: string; label: string; type?: string }) => (
    <label className="block"><span className="label">{label}</span><input className="input" name={name} type={type} /></label>);
  return (
    <main>
      <section className="bg-gradient-to-br from-ink via-brand-700 to-brand-600 text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8">
          <h1 className="text-4xl font-black md:text-5xl" translate="yes">{c?.title || t('nav.register')}</h1>
          <p className="mt-3 max-w-2xl text-lg text-sky-100/90" translate={c?.intro ? 'yes' : undefined}>{c?.intro || t('reg.intro')}</p>
          <ol className="mt-8 flex flex-wrap gap-2 text-sm">
            {steps.map((s, i) => <li key={s} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-xs font-bold">{i + 1}</span>{s}</li>)}
          </ol>
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-3 lg:px-8">
        <div className="lg:col-span-2">
          {!c?.enabled ? <p className="rounded-xl bg-amber-50 p-5 text-amber-900" data-testid="inscripcion-cerrada">{t('reg.disabled')} <Link className="link" href="/contacto">{t('nav.contact')}</Link></p> : (
            <CheckoutForm action={startRegistration} offeringId="" providers={fee > 0 ? availableProviders(c.currency) : []} countries={countries ?? []}
              free={fee <= 0} submitLabel={fee > 0 ? t('reg.pay', { amount: money }) : t('reg.send')}>
              {(c.ask_birth || c.ask_address || c.ask_education || c.ask_guardian) && (
                <fieldset className="space-y-4 rounded-2xl border border-slate-200 p-5" data-testid="datos-inscripcion">
                  <legend className="px-1 text-sm font-bold">{t('reg.more')}</legend>
                  <div className="grid gap-4 md:grid-cols-2">
                    {c.ask_birth && <In name="birth_date" type="date" label={t('reg.birth')} />}
                    {c.ask_education && <In name="education" label={t('reg.education')} />}
                    {c.ask_address && <In name="address" label={t('reg.address')} />}
                    {c.ask_address && <In name="city" label={t('reg.city')} />}
                    {c.ask_guardian && <In name="guardian_name" label={t('reg.guardian')} />}
                    {c.ask_guardian && <In name="guardian_phone" label={t('reg.guardianPhone')} />}
                    <In name="how_found" label={t('reg.how')} />
                  </div>
                  <label className="block"><span className="label">{t('reg.notes')}</span><textarea className="input" name="notes" rows={2} maxLength={500} /></label>
                </fieldset>)}
            </CheckoutForm>)}
        </div>
        <aside className="h-fit rounded-3xl border border-slate-200 p-6 shadow-sm lg:sticky lg:top-24">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{fee > 0 ? t('reg.fee') : t('reg.free')}</p>
          <p className="mt-1 text-4xl font-black" data-testid="monto-inscripcion">{fee > 0 ? money : '—'}</p>
          <ul className="mt-5 space-y-2 text-sm text-slate-600">{steps.map((s) => <li key={s}>✓ {s}</li>)}</ul>
          <Link href="/cursos" className="btn-secondary mt-6 w-full">{t('reg.done.courses')}</Link>
        </aside>
      </div>
    </main>
  );
}
