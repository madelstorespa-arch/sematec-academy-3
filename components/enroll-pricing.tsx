'use client';
import { useRef } from 'react';

type Offer = { id: string; title: string; program_id: string; period_id: string; price: number; fee: number; installments: number; currency: string };

/** Arancel y matrícula de una matrícula interna; puede copiar los precios de un curso publicado en el sitio. */
export function EnrollPricing({ offers, currency, benefits }: { offers: Offer[]; currency: string; benefits: { id: string; name: string }[] }) {
  const box = useRef<HTMLFieldSetElement>(null);
  const set = (name: string, v: string) => {
    const form = box.current?.form;
    const el = form?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const pick = (id: string) => {
    const o = offers.find((x) => x.id === id);
    if (!o) return;
    set('program_id', o.program_id); set('period_id', o.period_id);
    set('enrollment_fee', o.fee ? String(o.fee) : ''); set('amount', String(o.price));
    set('installments', String(o.installments)); set('currency', o.currency);
  };
  return (
    <fieldset ref={box} className="rounded-lg border border-slate-200 p-4" data-testid="arancel-interno">
      <legend className="px-1 text-xs font-bold uppercase text-slate-500">Matrícula y arancel (opcional)</legend>
      {offers.length > 0 && (
        <label className="mb-4 block"><span className="label">Usar los precios de un curso del sitio web</span>
          <select className="input" defaultValue="" onChange={(e) => pick(e.target.value)} data-testid="usar-precios-curso">
            <option value="">— Escribir los montos a mano —</option>
            {offers.map((o) => <option key={o.id} value={o.id}>{o.title} · {o.fee ? `matrícula ${o.fee.toLocaleString('es-CL')} + ` : ''}arancel {o.price.toLocaleString('es-CL')} {o.currency}</option>)}
          </select></label>
      )}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <label className="block"><span className="label">Matrícula</span><input className="input" name="enrollment_fee" type="number" min={0} step="0.01" placeholder="Ej.: 50000" /></label>
        <label className="block"><span className="label">Arancel total</span><input className="input" name="amount" type="number" min={0} step="0.01" /></label>
        <label className="block"><span className="label">Moneda</span><input className="input" name="currency" defaultValue={currency} /></label>
        <label className="block"><span className="label">N° de cuotas del arancel</span><input className="input" name="installments" type="number" min={1} max={36} defaultValue={10} /></label>
        <label className="block"><span className="label">Primer vencimiento</span><input className="input" name="first_due" type="date" /></label>
        <label className="block"><span className="label">Beca / descuento</span>
          <select className="input" name="benefit_id" defaultValue=""><option value="">Ninguno</option>{benefits.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </div>
      <p className="mt-3 text-xs text-slate-500">La matrícula se genera como un cargo de una cuota (vence hoy o en el primer vencimiento) y el arancel en las cuotas indicadas. El estudiante puede pagarlas en línea desde «Mis pagos», o usted registrarlas en Finanzas.</p>
    </fieldset>
  );
}
