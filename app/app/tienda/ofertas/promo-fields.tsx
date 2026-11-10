'use client';
import { useState } from 'react';
import { KINDS, PROMO_KINDS, type Promo } from '@/lib/store';

type P = { id: string; name: string; sku: string; category: string | null; kind: string; price: number };

/** Campos de una oferta: tipo, valor, a qué productos se aplica y vigencia. */
export function PromoFields({ d, products, categories }: { d?: Partial<Promo>; products: P[]; categories: string[] }) {
  const [kind, setKind] = useState<string>(d?.kind ?? 'percent');
  const [scope, setScope] = useState<string>(d?.scope ?? 'products');
  const [filter, setFilter] = useState('');
  const date = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }) : '');
  const list = products.filter((p) => !filter || `${p.name} ${p.sku}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block md:col-span-2"><span className="label">Nombre *</span><input name="name" required defaultValue={d?.name} className="input" placeholder="Ej.: Bebidas 3x2 de verano" /></label>
        <label className="block"><span className="label">Etiqueta (opcional)</span><input name="badge" maxLength={30} defaultValue={d?.badge ?? ''} className="input" placeholder="Ej.: ¡Liquidación!" /></label>
        <label className="block"><span className="label">Tipo</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">{PROMO_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {kind === 'nxm' ? (<>
          <label className="block"><span className="label">Lleva</span><input name="buy_qty" type="number" min={2} required defaultValue={d?.buy_qty ?? 3} className="input" /></label>
          <label className="block"><span className="label">Paga</span><input name="pay_qty" type="number" min={1} required defaultValue={d?.pay_qty ?? 2} className="input" /></label>
        </>) : (
          <label className="block"><span className="label">{kind === 'percent' ? '% de descuento' : kind === 'amount' ? '$ de descuento por unidad' : 'Precio oferta ($)'}</span>
            <input name="value" type="number" min={1} max={kind === 'percent' ? 100 : undefined} required defaultValue={d?.value} className="input" /></label>)}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block"><span className="label">Aplica a</span>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className="input">
            <option value="products">Productos elegidos</option><option value="category">Una categoría</option><option value="kind">Un tipo de producto</option><option value="all">Toda la tienda</option></select></label>
        {scope === 'kind' && <label className="block"><span className="label">Tipo de producto</span><select name="scope_kind" defaultValue={d?.scope_kind ?? 'bebestible'} className="input">{KINDS.map(([v, l, i]) => <option key={v} value={v}>{i} {l}</option>)}</select></label>}
        {scope === 'category' && <label className="block"><span className="label">Categoría</span><input name="scope_category" list="cat-ofertas" required defaultValue={d?.scope_category ?? ''} className="input" />
          <datalist id="cat-ofertas">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>}
        <label className="block"><span className="label">Dónde</span><select name="channel" defaultValue={d?.channel ?? 'ambos'} className="input"><option value="ambos">Caja y tienda web</option><option value="caja">Solo caja</option><option value="web">Solo tienda web</option></select></label>
      </div>
      {scope === 'products' && (
        <div className="rounded-lg border border-slate-200 p-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar productos…" className="input mb-2 py-1 text-sm" />
          <div className="grid max-h-48 gap-1 overflow-y-auto text-sm sm:grid-cols-2" data-testid="productos-oferta">
            {list.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="product_ids" value={p.id} defaultChecked={d?.product_ids?.includes(p.id)} />{p.name}</label>)}
          </div>
        </div>)}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block"><span className="label">Desde (opcional)</span><input name="starts_at" type="date" defaultValue={date(d?.starts_at)} className="input" /></label>
        <label className="block"><span className="label">Hasta (opcional)</span><input name="ends_at" type="date" defaultValue={date(d?.ends_at)} className="input" /></label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" value="off" defaultChecked={d?.active === false} /> Pausar oferta</label>
      </div>
    </div>
  );
}
