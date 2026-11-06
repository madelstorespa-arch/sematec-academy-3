'use client';
import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';

type Result = { ok: boolean; message?: string; error?: string; data?: any };
type Action = (fd: FormData) => Promise<Result>;

/** Campo trampa: los bots lo completan, las personas no lo ven. */
const Honeypot = () => <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />;

function useSubmit(action: Action, onOk?: (r: Result) => void) {
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setRes(null);
    start(async () => {
      try { const r = await action(fd); setRes(r); if (r.ok) onOk?.(r); }
      catch { setRes({ ok: false, error: 'Sin conexión con el servidor: no se envió nada y no se realizó ningún cobro. Revise su conexión y reintente.' }); }
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

function PersonFields({ countries }: { countries: { code: string; name: string }[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <In label="Nombre completo" name="name" required />
      <In label="Correo electrónico" name="email" type="email" required />
      <In label="Teléfono" name="phone" placeholder="+56 9 1234 5678" />
      <label className="block"><span className="label">País del documento *</span>
        <select className="input" name="doc_country" defaultValue="CL" required>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <In label="Tipo de documento" name="doc_type" required defaultValue="RUN" placeholder="RUN, DNI, Pasaporte" />
      <In label="Número de documento" name="doc_number" required />
    </div>
  );
}

const Consent = () => (
  <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" name="consent" required className="mt-1" />
    <span>Acepto los <Link className="link" href="/legal#terminos" target="_blank">términos y condiciones</Link> y la <Link className="link" href="/legal#privacidad" target="_blank">política de privacidad</Link>.</span></label>
);

export function ContactForm({ action, offeringId, offeringTitle }: { action: Action; offeringId?: string; offeringTitle?: string }) {
  const { res, pending, submit } = useSubmit(action);
  if (res?.ok) return <Msg r={res} />;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Honeypot />{offeringId && <input type="hidden" name="offering_id" value={offeringId} />}
      <div className="grid gap-4 md:grid-cols-2">
        <In label="Nombre" name="name" required /><In label="Correo" name="email" type="email" required />
        <In label="Teléfono" name="phone" /><In label="Asunto" name="subject" required defaultValue={offeringTitle ? `Consulta: ${offeringTitle}` : ''} />
      </div>
      <label className="block"><span className="label">Mensaje *</span><textarea className="input" name="message" rows={5} required minLength={5} /></label>
      <Consent />
      <button className="btn-primary" disabled={pending}>{pending ? 'Enviando…' : 'Enviar mensaje'}</button>
      <Msg r={res} />
    </form>
  );
}

export function ApplicationForm({ action, offeringId, countries }: { action: Action; offeringId: string; countries: { code: string; name: string }[] }) {
  const { res, pending, submit } = useSubmit(action);
  if (res?.ok) return (
    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6">
      <p className="text-lg font-bold text-emerald-800">✓ Postulación recibida</p>
      <p className="mt-2 text-sm text-emerald-900">{res.message}</p>
      <p className="mt-4 text-3xl font-black tracking-widest text-emerald-900">{res.data}</p>
      <Link className="btn-primary mt-5" href={`/estado?codigo=${res.data}`}>Ver estado de mi solicitud</Link>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <Honeypot /><input type="hidden" name="offering_id" value={offeringId} />
      <PersonFields countries={countries} />
      <In label="Estudios previos" name="education" placeholder="Último nivel de estudios completado" />
      <label className="block"><span className="label">¿Por qué quiere estudiar este programa?</span><textarea className="input" name="motivation" rows={4} /></label>
      <Consent />
      <button className="btn-primary" disabled={pending}>{pending ? 'Enviando…' : 'Enviar postulación'}</button>
      <Msg r={res} />
    </form>
  );
}

/** Formulario de pago: crea el pedido en el servidor y redirige a la página segura del proveedor. */
export function CheckoutForm({ action, offeringId, providers, countries, trackingCode, children }: {
  action: Action; offeringId: string; providers: { id: string; label: string; description: string }[];
  countries: { code: string; name: string }[]; trackingCode?: string; children?: ReactNode;
}) {
  const go = (r: Result) => {
    const red = r.data as { method: 'GET' | 'POST'; url: string; fields?: Record<string, string> };
    if (red.method === 'GET') { window.location.href = red.url; return; }
    const f = document.createElement('form'); f.method = 'POST'; f.action = red.url;
    Object.entries(red.fields ?? {}).forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  };
  const { res, pending, submit } = useSubmit(action, go);
  if (!providers.length) return <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">El pago en línea aún no está habilitado. Escríbanos desde Contacto para inscribirse.</p>;
  return (
    <form onSubmit={submit} className="space-y-5">
      <Honeypot /><input type="hidden" name="offering_id" value={offeringId} />
      {trackingCode && <input type="hidden" name="tracking_code" value={trackingCode} />}
      <PersonFields countries={countries} />
      {children}
      <fieldset>
        <legend className="label">Medio de pago *</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((p, i) => (
            <label key={p.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-300 p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="radio" name="provider" value={p.id} defaultChecked={i === 0} required className="mt-1" />
              <span><b>{p.label}</b><br /><span className="text-xs text-slate-600">{p.description}</span></span>
            </label>))}
        </div>
      </fieldset>
      <Consent />
      <button className="btn-primary w-full py-3 text-base" disabled={pending || res?.ok}>{pending || res?.ok ? 'Conectando con el pago seguro…' : 'Ir a pagar'}</button>
      <p className="text-center text-xs text-slate-500">🔒 Los datos de su tarjeta se ingresan en la página del medio de pago; SEMATEC ACADEMY nunca los recibe ni almacena.</p>
      <Msg r={res?.ok ? null : res} />
    </form>
  );
}

export function StatusForm({ action, defaultCode }: { action: Action; defaultCode?: string }) {
  const { res, pending, submit } = useSubmit(action);
  const d = res?.ok ? res.data : null;
  const LBL: Record<string, string> = { submitted: 'Recibida, en revisión', under_review: 'En revisión', approved: 'Aprobada', rejected: 'No aprobada', withdrawn: 'Retirada', draft: 'Borrador' };
  const OLBL: Record<string, string> = { pending: 'Pago pendiente', paid: 'Pagado', failed: 'Pago rechazado', cancelled: 'Pago anulado', expired: 'Pago vencido' };
  return (
    <div>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3 md:items-end">
        <In label="Código de seguimiento" name="code" required defaultValue={defaultCode} placeholder="SA-XXXXXXXX" />
        <In label="Correo usado en la solicitud" name="email" type="email" required />
        <button className="btn-primary" disabled={pending}>{pending ? 'Consultando…' : 'Consultar'}</button>
      </form>
      {res && !res.ok && <Msg r={res} />}
      {d && (
        <div className="mt-6 rounded-2xl border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Solicitud {d.code}</p>
          <h2 className="text-xl font-bold">{d.course}</h2>
          <ol className="mt-5 space-y-3">
            {d.application_status && <li>📝 Postulación: <b>{LBL[d.application_status] ?? d.application_status}</b>{d.decision_notes && <span className="block text-sm text-slate-600">Observación: {d.decision_notes}</span>}</li>}
            {d.order_status && <li>💳 Pago: <b>{OLBL[d.order_status] ?? d.order_status}</b></li>}
            {d.enrolled && <li>🎓 <b>Matrícula activa.</b> Ingrese a la plataforma con su correo.</li>}
          </ol>
          {d.can_pay && <Link className="btn-primary mt-5" href={`/cursos/${d.slug}/inscripcion?codigo=${d.code}`}>Pagar ahora</Link>}
          {d.enrolled && <Link className="btn-primary mt-5" href="/login">Ingresar a la plataforma</Link>}
        </div>
      )}
    </div>
  );
}
