'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KINDS, kindIcon } from '@/lib/store';
import { DOC_TYPES } from '@/lib/identity';

type P = { id: string; name: string; description: string | null; kind: string; category: string | null; brand: string | null; unit: string;
  price: number; currency: string; available: boolean; stock: number | null; image_asset_id: string | null; warranty_months: number | null };
type Provider = { id: string; label: string; description: string };
const KEY = 'sematec-carro';
const money = (n: number, c: string) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: c, maximumFractionDigits: c === 'CLP' ? 0 : 2 }).format(n);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Shop({ products, currency, providers, whatsapp }: { products: P[]; currency: string; providers: Provider[]; whatsapp: string | null }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [delivery, setDelivery] = useState('retiro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { try { setCart(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* */ } }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* */ } }, [cart]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: byId.get(id), qty })).filter((l): l is { p: P; qty: number } => !!l.p && l.qty > 0);
  const total = lines.reduce((t, l) => t + Math.round(Number(l.p.price) * l.qty), 0);
  const count = lines.reduce((t, l) => t + l.qty, 0);
  const list = products.filter((p) => (!kind || p.kind === kind) && (!q || norm(`${p.name} ${p.brand ?? ''} ${p.category ?? ''}`).includes(norm(q))));
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
      const r = await fetch('/api/tienda/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, items: lines.map((l) => ({ product: l.p.id, qty: l.qty })) }) });
      const j = await r.json();
      if (j.redirect) {
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
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar producto" className="input max-w-xs" />
        <button className={`rounded-full px-4 py-1.5 text-sm ${!kind ? 'bg-ink text-white' : 'bg-slate-100'}`} onClick={() => setKind('')}>Todo</button>
        {kinds.map(([k, l, i]) => <button key={k} className={`rounded-full px-4 py-1.5 text-sm ${kind === k ? 'bg-ink text-white' : 'bg-slate-100'}`} onClick={() => setKind(k)}>{i} {l}</button>)}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="catalogo">
        {list.map((p) => {
          const n = cart[p.id] ?? 0;
          return (
            <article key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="producto-web">
              {p.image_asset_id
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/media/${p.image_asset_id}`} alt={p.name} className="aspect-square w-full object-cover" />
                : <div className="grid aspect-square place-items-center bg-gradient-to-br from-slate-50 to-slate-100 text-5xl">{kindIcon(p.kind)}</div>}
              <div className="flex flex-1 flex-col p-3">
                <p className="text-xs text-slate-500">{[p.brand, p.category].filter(Boolean).join(' · ')}</p>
                <h2 className="font-semibold leading-tight">{p.name}</h2>
                {p.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</p>}
                {p.warranty_months ? <p className="mt-1 text-xs text-emerald-700">✓ Garantía {p.warranty_months} meses</p> : null}
                <p className="mt-auto pt-2 text-lg font-black">{money(Number(p.price), p.currency)}{p.unit !== 'unidad' && <span className="text-xs font-normal"> / {p.unit}</span>}</p>
                {!p.available ? <p className="mt-2 rounded-lg bg-slate-100 py-2 text-center text-sm text-slate-500">Agotado</p>
                  : n ? (
                    <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-50 p-1">
                      <button className="h-8 w-8 rounded bg-white" onClick={() => setQty(p, n - 1)} aria-label="Quitar uno">−</button><b>{n}</b>
                      <button className="h-8 w-8 rounded bg-white disabled:opacity-40" disabled={p.stock !== null && n >= Number(p.stock)} onClick={() => setQty(p, n + 1)} aria-label="Agregar uno">+</button>
                    </div>)
                  : <button className="btn-primary mt-2 w-full" onClick={() => setQty(p, 1)} data-testid="agregar">Agregar al carro</button>}
              </div>
            </article>);
        })}
      </div>

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
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.p.name}</span><span className="text-xs text-slate-500">{money(Number(l.p.price), currency)} c/u</span></span>
                  <span className="flex items-center gap-1"><button className="h-7 w-7 rounded bg-slate-100" onClick={() => setQty(l.p, l.qty - 1)}>−</button><b className="w-6 text-center">{l.qty}</b><button className="h-7 w-7 rounded bg-slate-100" onClick={() => setQty(l.p, l.qty + 1)}>+</button></span>
                </li>))}</ul>
              <div className="border-t p-4"><p className="flex justify-between text-xl font-black"><span>Total</span><span>{money(total, currency)}</span></p>
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
