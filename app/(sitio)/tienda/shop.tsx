'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KINDS, kindIcon } from '@/lib/store';
import { DOC_TYPES } from '@/lib/identity';

type P = { id: string; name: string; description: string | null; kind: string; category: string | null; brand: string | null; unit: string;
  price: number; currency: string; available: boolean; stock: number | null; image_asset_id: string | null; warranty_months: number | null;
  sku: string; availability: 'disponible' | 'pocas' | 'agotado'; promo_label: string | null; promo_price: number | null; promo_kind: string | null; promo_ends: string | null };
type Provider = { id: string; label: string; description: string };
const KEY = 'sematec-carro';
const money = (n: number, c: string) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: c, maximumFractionDigits: c === 'CLP' ? 0 : 2 }).format(n);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Shop({ products, currency, providers, whatsapp, storeName, orgId }: { products: P[]; currency: string; providers: Provider[]; whatsapp: string | null; storeName: string; orgId: string }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [delivery, setDelivery] = useState('retiro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState('relevancia');
  const [cat, setCat] = useState('');
  const [onlyOffers, setOnlyOffers] = useState(false);
  const [view, setView] = useState<P | null>(null);
  const [couponText, setCouponText] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  useEffect(() => { try { setCart(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* */ } }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* */ } }, [cart]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: byId.get(id), qty })).filter((l): l is { p: P; qty: number } => !!l.p && l.qty > 0);
  const lineDisc = (p: P, qty: number) => {
    if (p.promo_kind === 'nxm' && p.promo_label) { const m = /Lleva (\d+) paga (\d+)/.exec(p.promo_label); if (m) return Math.floor(qty / Number(m[1])) * (Number(m[1]) - Number(m[2])) * Number(p.price); }
    return p.promo_price !== null && p.promo_price !== undefined ? (Number(p.price) - Number(p.promo_price)) * qty : 0;
  };
  const lineTotal = (p: P, qty: number) => Math.round(Number(p.price) * qty - lineDisc(p, qty));
  const subtotal = lines.reduce((t, l) => t + lineTotal(l.p, l.qty), 0);
  const saved = lines.reduce((t, l) => t + lineDisc(l.p, l.qty), 0);
  const total = Math.max(0, subtotal - (coupon?.discount ?? 0));
  const count = lines.reduce((t, l) => t + l.qty, 0);
  const list = products.filter((p) => (!kind || p.kind === kind) && (!cat || p.category === cat) && (!onlyOffers || p.promo_label)
      && (!q || norm(`${p.name} ${p.brand ?? ''} ${p.category ?? ''} ${p.sku}`).includes(norm(q))))
    .sort((a, b) => sort === 'menor' ? (a.promo_price ?? a.price) - (b.promo_price ?? b.price) : sort === 'mayor' ? (b.promo_price ?? b.price) - (a.promo_price ?? a.price)
      : sort === 'nombre' ? a.name.localeCompare(b.name) : (Number(!!b.promo_label) - Number(!!a.promo_label)) || (Number(a.availability === 'agotado') - Number(b.availability === 'agotado')));
  const offers = products.filter((p) => p.promo_label && p.available).slice(0, 12);
  const catsOf = (k: string) => [...new Set(products.filter((p) => p.kind === k && p.category).map((p) => p.category as string))].sort();
  const kinds = KINDS.filter(([k]) => products.some((p) => p.kind === k));
  const setQty = (p: P, qty: number) => setCart((c) => {
    const max = p.stock === null ? 999 : Number(p.stock);
    const v = Math.max(0, Math.min(qty, max));
    const n = { ...c }; if (v) n[p.id] = v; else delete n[p.id]; return n;
  });

  const submit = async (fd: FormData) => {
    setBusy(true); setError(null);
    const body = Object.fromEntries(fd.entries());
    try {
      const r = await fetch('/api/tienda/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, coupon: coupon?.code, items: lines.map((l) => ({ product: l.p.id, qty: l.qty })) }) });
      const j = await r.json();
      if (j.redirect) {
        setCoupon(null);
        setCart({});
        const red = j.redirect as { method: 'GET' | 'POST'; url: string; fields?: Record<string, string> };
        if (red.method === 'GET') { window.location.href = red.url; return; }
        const f = document.createElement('form'); f.method = 'POST'; f.action = red.url;
        Object.entries(red.fields ?? {}).forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); });
        document.body.appendChild(f); f.submit(); return;
      }
      if (!r.ok && !j.tracking) throw new Error(j.error ?? 'No se pudo enviar el pedido.');
      setCart({}); router.push(`/tienda/pedido/${j.tracking}${j.error ? '?aviso=pago' : ''}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (!products.length) return <p className="mt-10 rounded-2xl bg-slate-50 p-10 text-center text-slate-600">Pronto publicaremos nuestros productos. {whatsapp && <>Consúltenos por <a className="link" href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}>WhatsApp</a>.</>}</p>;
  const Card = ({ p }: { p: P }) => {
    const n = cart[p.id] ?? 0;
    return (
      <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg" data-testid="producto-web">
        {p.promo_label && <span className="absolute left-2 top-2 z-10 rounded-lg bg-red-600 px-2 py-1 text-xs font-black text-white shadow" data-testid="etiqueta-oferta">{p.promo_label}</span>}
        <button type="button" onClick={() => setView(p)} className="block" aria-label={`Ver ${p.name}`}>
          {p.image_asset_id
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/media/${p.image_asset_id}`} alt={p.name} className="aspect-square w-full object-cover transition group-hover:scale-[1.02]" />
            : <div className="grid aspect-square place-items-center bg-gradient-to-br from-slate-50 to-slate-100 text-6xl">{kindIcon(p.kind)}</div>}
        </button>
        <div className="flex flex-1 flex-col p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">{p.brand ?? p.category ?? ''}</p>
          <h3 className="line-clamp-2 font-semibold leading-tight">{p.name}</h3>
          <p className="mt-1 text-[11px]" data-testid="disponibilidad">{p.availability === 'agotado' ? <span className="font-semibold text-red-600">● Agotado</span>
            : p.availability === 'pocas' ? <span className="font-semibold text-amber-600">● ¡Últimas unidades!</span> : <span className="text-emerald-700">● Disponible</span>}</p>
          <div className="mt-auto pt-2">
            {p.promo_price !== null && p.promo_price !== undefined ? (<>
              <p className="text-xs text-slate-400 line-through">{money(Number(p.price), p.currency)}</p>
              <p className="text-xl font-black text-red-600">{money(Number(p.promo_price), p.currency)}{p.unit !== 'unidad' && <span className="text-xs font-normal"> / {p.unit}</span>}</p>
            </>) : <p className="text-xl font-black">{money(Number(p.price), p.currency)}{p.unit !== 'unidad' && <span className="text-xs font-normal"> / {p.unit}</span>}</p>}
          </div>
          {!p.available ? <p className="mt-2 rounded-lg bg-slate-100 py-2 text-center text-sm text-slate-500">Sin stock</p>
            : n ? (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-50 p-1">
                <button className="h-9 w-9 rounded-lg bg-white text-lg" onClick={() => setQty(p, n - 1)} aria-label="Quitar uno">−</button><b>{n}</b>
                <button className="h-9 w-9 rounded-lg bg-white text-lg disabled:opacity-40" disabled={p.stock !== null && n >= Number(p.stock)} onClick={() => setQty(p, n + 1)} aria-label="Agregar uno">+</button>
              </div>)
            : <button className="btn-primary mt-2 w-full" onClick={() => setQty(p, 1)} data-testid="agregar">Agregar</button>}
        </div>
      </article>);
  };

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#0b3d91] via-[#1d4ed8] to-[#0ea5e9] px-6 py-8 text-white shadow-xl sm:px-10">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-sky-200">Supermercado en línea</p>
        <h1 className="mt-1 text-3xl font-black sm:text-5xl" data-testid="nombre-tienda">{storeName}</h1>
        <p className="mt-2 max-w-xl text-sky-100">Aseo, comestibles, bebestibles, electrónica y más. Compre en línea y retire en tienda o pida despacho.</p>
        <div className="mt-5 flex max-w-2xl gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ¿Qué está buscando? Ej.: detergente, leche, audífonos" className="w-full rounded-xl px-4 py-3 text-ink shadow-inner outline-none" aria-label="Buscar productos" />
        </div>
        {offers.length > 0 && <p className="mt-3 text-sm font-semibold">🔥 {offers.length} oferta(s) vigente(s) · <button className="underline" onClick={() => { setOnlyOffers(true); setKind(''); setCat(''); }}>Ver ofertas</button></p>}
      </section>

      {offers.length > 0 && !q && !kind && !onlyOffers && (
        <section className="mt-8">
          <h2 className="mb-3 text-2xl font-black">🔥 Ofertas de la semana</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" data-testid="ofertas">{offers.map((p) => <Card key={p.id} p={p} />)}</div>
        </section>)}

      <div className="mt-8 grid gap-6 lg:grid-cols-[15rem_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <nav className="rounded-2xl border border-slate-200 bg-white p-3 text-sm" aria-label="Categorías">
            <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wide text-slate-500">Categorías</p>
            <button className={`block w-full rounded-lg px-3 py-2 text-left ${!kind && !onlyOffers ? 'bg-brand-50 font-bold text-brand-700' : 'hover:bg-slate-50'}`} onClick={() => { setKind(''); setCat(''); setOnlyOffers(false); }}>🛒 Todo ({products.length})</button>
            <button className={`block w-full rounded-lg px-3 py-2 text-left ${onlyOffers ? 'bg-red-50 font-bold text-red-700' : 'hover:bg-slate-50'}`} onClick={() => { setOnlyOffers(true); setKind(''); setCat(''); }}>🔥 Ofertas ({products.filter((p) => p.promo_label).length})</button>
            {kinds.map(([k, l, i]) => (
              <div key={k}>
                <button className={`block w-full rounded-lg px-3 py-2 text-left ${kind === k && !cat ? 'bg-brand-50 font-bold text-brand-700' : 'hover:bg-slate-50'}`} onClick={() => { setKind(k); setCat(''); setOnlyOffers(false); }}>
                  {i} {l} ({products.filter((p) => p.kind === k).length})</button>
                {kind === k && catsOf(k).map((c) => (
                  <button key={c} className={`block w-full rounded-lg py-1.5 pl-9 pr-3 text-left text-xs ${cat === c ? 'font-bold text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setCat(c)}>{c}</button>))}
              </div>))}
          </nav>
        </aside>
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">{list.length} producto(s){onlyOffers ? ' en oferta' : ''}</p>
            <label className="text-sm">Ordenar: <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1">
              <option value="relevancia">Ofertas primero</option><option value="menor">Menor precio</option><option value="mayor">Mayor precio</option><option value="nombre">Nombre</option></select></label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5" data-testid="catalogo">
            {list.map((p) => <Card key={p.id} p={p} />)}
            {!list.length && <p className="col-span-full rounded-2xl bg-slate-50 p-10 text-center text-slate-500">No encontramos productos con ese filtro.</p>}
          </div>
        </section>
      </div>

      {view && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onMouseDown={() => setView(null)}>
          <div className="grid w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-2" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={view.name}>
            {view.image_asset_id
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/media/${view.image_asset_id}`} alt={view.name} className="h-full max-h-96 w-full object-cover" />
              : <div className="grid min-h-64 place-items-center bg-slate-100 text-8xl">{kindIcon(view.kind)}</div>}
            <div className="flex flex-col p-6">
              <button className="self-end text-slate-400" onClick={() => setView(null)} aria-label="Cerrar">✕</button>
              <p className="text-xs uppercase text-slate-500">{[view.brand, view.category].filter(Boolean).join(' · ')} · Código {view.sku}</p>
              <h2 className="text-2xl font-black">{view.name}</h2>
              {view.promo_label && <span className="mt-2 self-start rounded-lg bg-red-600 px-2 py-1 text-xs font-black text-white">{view.promo_label}</span>}
              {view.description && <p className="mt-3 text-sm text-slate-600">{view.description}</p>}
              {view.warranty_months ? <p className="mt-2 text-sm text-emerald-700">✓ Garantía de {view.warranty_months} meses</p> : null}
              <p className="mt-auto pt-4 text-3xl font-black">{money(Number(view.promo_price ?? view.price), view.currency)}</p>
              {view.available && <button className="btn-primary mt-3 py-3" onClick={() => { setQty(view, (cart[view.id] ?? 0) + 1); setView(null); }}>Agregar al carro</button>}
            </div>
          </div>
        </div>)}

      {count > 0 && !open && (
        <button onClick={() => { setOpen(true); setStep('cart'); }} className="fixed bottom-5 right-5 z-40 rounded-full bg-ink px-5 py-3 font-semibold text-white shadow-2xl" data-testid="ver-carro">
          🛒 {count} · {money(total, currency)}</button>)}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={() => setOpen(false)}>
          <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} data-testid="carro">
            <div className="flex items-center justify-between border-b p-4"><h2 className="text-lg font-bold">{step === 'cart' ? '🛒 Su carro' : '📦 Datos del pedido'}</h2><button onClick={() => setOpen(false)} aria-label="Cerrar">✕</button></div>
            {step === 'cart' ? (<>
              <ul className="flex-1 space-y-3 overflow-y-auto p-4">{lines.map((l) => (
                <li key={l.p.id} className="flex items-center gap-3">
                  <span className="text-2xl">{kindIcon(l.p.kind)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.p.name}</span><span className="text-xs text-slate-500">{money(Number(l.p.price), currency)} c/u</span>
                    {lineDisc(l.p, l.qty) > 0 && <span className="block text-xs font-semibold text-red-600">🏷 {l.p.promo_label}: −{money(lineDisc(l.p, l.qty), currency)}</span>}</span>
                  <span className="flex items-center gap-1"><button className="h-7 w-7 rounded bg-slate-100" onClick={() => setQty(l.p, l.qty - 1)}>−</button><b className="w-6 text-center">{l.qty}</b><button className="h-7 w-7 rounded bg-slate-100" onClick={() => setQty(l.p, l.qty + 1)}>+</button></span>
                </li>))}</ul>
              <div className="border-t p-4">
                {saved > 0 && <p className="flex justify-between text-sm font-semibold text-red-600"><span>🏷 Usted ahorra</span><span>−{money(saved, currency)}</span></p>}
                <div className="my-2 flex gap-2">
                  {coupon ? <p className="flex-1 text-sm text-red-600">🎟 Cupón {coupon.code}: −{money(coupon.discount, currency)} <button className="text-xs text-slate-400" onClick={() => setCoupon(null)}>quitar</button></p> : (<>
                    <input value={couponText} onChange={(e) => setCouponText(e.target.value.toUpperCase())} placeholder="¿Tiene un cupón?" className="input flex-1 py-1.5 uppercase" data-testid="cupon-web" />
                    <button type="button" className="btn-secondary btn-sm" onClick={async () => {
                      const r = await fetch(`/api/tienda/cupon?org=${orgId}&code=${encodeURIComponent(couponText)}&total=${subtotal}`).then((x) => x.json()).catch(() => ({ valid: false }));
                      if (r.valid) { setCoupon({ code: r.code, discount: Number(r.discount) }); setError(null); } else setError('El cupón no es válido, venció o requiere una compra mayor.');
                    }}>Aplicar</button></>)}
                </div>
                {error && step === 'cart' && <p className="mb-2 text-xs text-red-600">{error}</p>}
                <p className="flex justify-between text-xl font-black"><span>Total</span><span data-testid="total-carro">{money(total, currency)}</span></p>
                <button className="btn-primary mt-3 w-full py-3" onClick={() => setStep('checkout')} data-testid="continuar">Continuar →</button></div>
            </>) : (
              <form className="flex-1 space-y-3 overflow-y-auto p-4" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} data-testid="form-pedido">
                <label className="block"><span className="label">Nombre completo *</span><input name="name" required minLength={3} className="input" autoComplete="name" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label">Correo *</span><input name="email" type="email" required className="input" autoComplete="email" /></label>
                  <label className="block"><span className="label">Teléfono</span><input name="phone" className="input" autoComplete="tel" /></label>
                  <label className="block"><span className="label">Documento</span><select name="doc_type" className="input">{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l.split(' ')[0]}</option>)}</select></label>
                  <label className="block"><span className="label">RUT / pasaporte</span><input name="doc_number" className="input" /></label>
                </div>
                <fieldset><legend className="label">Entrega</legend>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <label className={`cursor-pointer rounded-lg border-2 p-2 ${delivery === 'retiro' ? 'border-brand-600' : 'border-slate-200'}`}><input type="radio" name="delivery" value="retiro" checked={delivery === 'retiro'} onChange={() => setDelivery('retiro')} className="sr-only" />🏪 Retiro en tienda</label>
                    <label className={`cursor-pointer rounded-lg border-2 p-2 ${delivery === 'despacho' ? 'border-brand-600' : 'border-slate-200'}`}><input type="radio" name="delivery" value="despacho" checked={delivery === 'despacho'} onChange={() => setDelivery('despacho')} className="sr-only" />🚚 Despacho</label>
                  </div></fieldset>
                {delivery === 'despacho' && <label className="block"><span className="label">Dirección de despacho *</span><input name="address" required minLength={5} className="input" placeholder="Calle, número, comuna" /></label>}
                <fieldset><legend className="label">Pago</legend>
                  <div className="space-y-1 text-sm">
                    {providers.map((p, i) => <label key={p.id} className="flex items-center gap-2 rounded-lg border p-2"><input type="radio" name="payment" value={`online:${p.id}`} defaultChecked={i === 0} />💳 {p.label}<span className="text-xs text-slate-500">{p.description}</span></label>)}
                    <label className="flex items-center gap-2 rounded-lg border p-2"><input type="radio" name="payment" value="bank_transfer" defaultChecked={!providers.length} />🏦 Transferencia bancaria (le enviaremos los datos)</label>
                    <label className="flex items-center gap-2 rounded-lg border p-2"><input type="radio" name="payment" value="cash" />💵 Pagar al retirar o recibir</label>
                  </div></fieldset>
                <label className="block"><span className="label">Nota</span><input name="notes" className="input" placeholder="Ej.: horario de entrega" /></label>
                <p className="flex justify-between text-xl font-black"><span>Total</span><span>{money(total, currency)}</span></p>
                {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700" data-testid="error-pedido">{error}</p>}
                <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => setStep('cart')}>← Carro</button>
                  <button className="btn-primary flex-1 py-3" disabled={busy} data-testid="confirmar-pedido">{busy ? 'Enviando…' : 'Confirmar pedido'}</button></div>
              </form>)}
          </aside>
        </div>)}
    </>
  );
}
