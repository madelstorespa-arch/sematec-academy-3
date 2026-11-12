'use client';
import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { DOC_TYPES } from '@/lib/identity';
import { useSiteT } from '@/components/site-lang';

type Result = { ok: boolean; message?: string; error?: string; data?: any };
type Action = (fd: FormData) => Promise<Result>;

/** Campo trampa: los bots lo completan, las personas no lo ven. */
const Honeypot = () => <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />;

function useSubmit(action: Action, onOk?: (r: Result) => void) {
  const { t } = useSiteT();
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setRes(null);
    start(async () => {
      try { const r = await action(fd); setRes(r); if (r.ok) onOk?.(r); }
      catch { setRes({ ok: false, error: t('form.offline') }); }
    });
  };
  return { res, pending, submit };
}

const Msg = ({ r }: { r: Result | null }) => r && (
  <p role="status" className={`mt-4 rounded-lg px-4 py-3 text-sm ${r.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{r.ok ? r.message : r.error}</p>
);

export function In({ label, name, type = 'text', required, defaultValue, placeholder }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return <label className="block"><span className="label">{label}{required && ' *'}</span><input className="input" name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} /></label>;
}

function PersonFields({ countries, withDoc = true }: { countries: { code: string; name: string }[]; withDoc?: boolean }) {
  const { t } = useSiteT();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <In label={t('form.name')} name="name" required />
      <In label={t('form.email')} name="email" type="email" required />
      <In label={t('form.phone')} name="phone" placeholder="+56 9 1234 5678" />
      {withDoc && <>
        <label className="block"><span className="label">{t('form.doc')} *</span>
          <select name="doc_type" required defaultValue="RUN" className="input">{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <In label={t('form.docNumber')} name="doc_number" required placeholder={t('form.docPh')} />
      </>}
    </div>
  );
}

const Consent = () => {
  const { t } = useSiteT();
  return (
    <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" name="consent" required className="mt-1" />
      <span>{t('form.accept')} <Link className="link" href="/legal#terminos" target="_blank">{t('form.terms')}</Link> {t('form.and')} <Link className="link" href="/legal#privacidad" target="_blank">{t('form.privacy')}</Link>.</span></label>
  );
};

export function ContactForm({ action, offeringId, offeringTitle }: { action: Action; offeringId?: string; offeringTitle?: string }) {
  const { t } = useSiteT();
  const { res, pending, submit } = useSubmit(action);
  if (res?.ok) return <Msg r={res} />;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Honeypot />{offeringId && <input type="hidden" name="offering_id" value={offeringId} />}
      <div className="grid gap-4 md:grid-cols-2">
        <In label={t('form.shortName')} name="name" required /><In label={t('form.shortEmail')} name="email" type="email" required />
        <In label={t('form.phone')} name="phone" /><In label={t('form.subject')} name="subject" required defaultValue={offeringTitle ? t('form.query', { title: offeringTitle }) : ''} />
      </div>
      <label className="block"><span className="label">{t('form.message')} *</span><textarea className="input" name="message" rows={5} required minLength={5} /></label>
      <Consent />
      <button className="btn-primary" disabled={pending}>{pending ? t('form.sending') : t('form.send')}</button>
      <Msg r={res} />
    </form>
  );
}

export function ApplicationForm({ action, offeringId, countries }: { action: Action; offeringId: string; countries: { code: string; name: string }[] }) {
  const { t } = useSiteT();
  const { res, pending, submit } = useSubmit(action);
  if (res?.ok) return (
    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6">
      <p className="text-lg font-bold text-emerald-800">{t('form.appReceived')}</p>
      <p className="mt-2 text-sm text-emerald-900">{res.message}</p>
      <p className="mt-4 text-3xl font-black tracking-widest text-emerald-900">{res.data}</p>
      <Link className="btn-primary mt-5" href={`/estado?codigo=${res.data}`}>{t('form.seeStatus')}</Link>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <Honeypot /><input type="hidden" name="offering_id" value={offeringId} />
      <PersonFields countries={countries} />
      <In label={t('form.education')} name="education" placeholder={t('form.educationPh')} />
      <label className="block"><span className="label">{t('form.motivation')}</span><textarea className="input" name="motivation" rows={4} /></label>
      <Consent />
      <button className="btn-primary" disabled={pending}>{pending ? t('form.sending') : t('form.sendApplication')}</button>
      <Msg r={res} />
    </form>
  );
}

/** Formulario de pago: crea el pedido en el servidor y redirige a la página segura del proveedor. */
export function CheckoutForm({ action, offeringId, providers, countries, trackingCode, children }: {
  action: Action; offeringId: string; providers: { id: string; label: string; description: string; banks?: { id: string; name: string }[] }[];
  countries: { code: string; name: string }[]; trackingCode?: string; children?: ReactNode;
}) {
  const go = (r: Result) => {
    const red = r.data as { method: 'GET' | 'POST'; url: string; fields?: Record<string, string> };
    if (red.method === 'GET') { window.location.href = red.url; return; }
    const f = document.createElement('form'); f.method = 'POST'; f.action = red.url;
    Object.entries(red.fields ?? {}).forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  };
  const { t } = useSiteT();
  const { res, pending, submit } = useSubmit(action, go);
  const [provider, setProvider] = useState(providers[0]?.id ?? '');
  const banks = providers.find((p) => p.id === provider)?.banks;
  if (!providers.length) return <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800" data-testid="pago-no-habilitado">{t('form.notEnabled')}</p>;
  return (
    <form onSubmit={submit} className="space-y-5">
      <Honeypot /><input type="hidden" name="offering_id" value={offeringId} />
      {trackingCode && <input type="hidden" name="tracking_code" value={trackingCode} />}
      <PersonFields countries={countries} withDoc={!trackingCode} />
      {children}
      <fieldset>
        <legend className="label">{t('form.payMethod')} *</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((p, i) => (
            <label key={p.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-300 p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} required className="mt-1" />
              <span><b>{p.banks ? '🏦 ' : p.id === 'flow' ? '' : '💳 '}{p.label}</b><br /><span className="text-xs text-slate-600">{p.description}</span></span>
            </label>))}
        </div>
      </fieldset>
      {banks && (
        <fieldset>
          <legend className="label">{t('form.chooseBank')} *</legend>
          <p className="mb-2 text-xs text-slate-500">{t('form.bankHelp')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {banks.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-2 py-3 text-center text-sm font-semibold has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                <input type="radio" name="bank" value={b.id} required className="sr-only" />{b.name}
              </label>))}
          </div>
        </fieldset>
      )}
      <Consent />
      <button className="btn-primary w-full py-3 text-base" disabled={pending || res?.ok}>{pending || res?.ok ? t('form.connecting') : t('form.goPay')}</button>
      <p className="text-center text-xs text-slate-500">{t('form.secure')}</p>
      <Msg r={res?.ok ? null : res} />
    </form>
  );
}

export function StatusForm({ action, defaultCode }: { action: Action; defaultCode?: string }) {
  const { t } = useSiteT();
  const { res, pending, submit } = useSubmit(action);
  const d = res?.ok ? res.data : null;
  const LBL = (k: string) => { const v = t(`app.${k}`); return v === `app.${k}` ? k : v; };
  const OLBL = (k: string) => { const v = t(`order.${k}`); return v === `order.${k}` ? k : v; };
  return (
    <div>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3 md:items-end">
        <In label={t('status.code')} name="code" required defaultValue={defaultCode} placeholder="SA-XXXXXXXX" />
        <In label={t('status.email')} name="email" type="email" required />
        <button className="btn-primary" disabled={pending}>{pending ? t('status.checking') : t('status.check')}</button>
      </form>
      {res && !res.ok && <Msg r={res} />}
      {d && (
        <div className="mt-6 rounded-2xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">{t('status.request', { code: d.code })}</p>
          <h2 className="text-xl font-bold">{d.course}</h2>
          <ol className="mt-5 space-y-3">
            {d.application_status && <li>📝 {t('status.application')}: <b>{LBL(d.application_status)}</b>{d.decision_notes && <span className="block text-sm text-slate-600">{t('status.observation')}: {d.decision_notes}</span>}</li>}
            {d.order_status && <li>💳 {t('status.payment')}: <b>{OLBL(d.order_status)}</b></li>}
            {d.enrolled && <li>🎓 <b>{t('status.enrolled')}</b> {t('status.enrolledD')}</li>}
          </ol>
          {d.can_pay && <Link className="btn-primary mt-5" href={`/cursos/${d.slug}/inscripcion?codigo=${d.code}`}>{t('status.payNow')}</Link>}
          {d.enrolled && <Link className="btn-primary mt-5" href="/login">{t('status.enter')}</Link>}
        </div>
      )}
    </div>
  );
}
