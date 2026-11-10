'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { KINDS, kindIcon, SALE_METHODS, bestPromo, type Promo } from '@/lib/store';
import { DOC_TYPES } from '@/lib/identity';
import { checkCoupon, sell, type CartLine } from '../actions';
import { notifyChanged } from '@/components/undo-bar';

type P = { id: string; sku: string; barcode: string | null; name: string; kind: string; category: string | null; unit: string; price: number; stock: number;
  track_stock: boolean; requires_serial: boolean; warranty_months: number | null; tax_rate: number; image_asset_id: string | null };
type Line = { p: P; qty: number; discount: number; serial: string };

const money = (n: number, c: string) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: c, maximumFractionDigits: c === 'CLP' ? 0 : 2 }).format(n);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** 🧾 Punto de venta: lector de código de barras (o cámara), carrito, descuentos, efectivo con vuelto y comprobante. */
export function Pos({ products: initial, currency, promos = [], prefs }: { products: P[]; currency: string; promos?: Promo[]; prefs?: { method?: string; auto_print?: boolean } }) {
  const [products, setProducts] = useState(initial);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [method, setMethod] = useState(prefs?.method ?? 'cash');
  const [cash, setCash] = useState('');
  const [discount, setDiscount] = useState('');
  const [customer, setCustomer] = useState({ name: '', doc_type: 'RUN', doc_number: '', email: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<{ id: string; number: number; code?: string; total: number; change: number | null } | null>(null);
  const [couponText, setCouponText] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const promoOf = (l: Line) => bestPromo(promos, { ...l.p, currency }, l.qty, 'caja');
  const lineTotal = (l: Line) => Math.max(0, Math.round(l.p.price * l.qty - (promoOf(l)?.discount ?? 0) - l.discount));
  const [pending, start] = useTransition();
  const [scan, setScan] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const list = useMemo(() => {
    const t = norm(q.trim());
    return products.filter((p) => (!kind || p.kind === kind) && (!t || norm(`${p.name} ${p.sku} ${p.category ?? ''}`).includes(t) || p.barcode === q.trim())).slice(0, 60);
  }, [products, q, kind]);
  const inCart = (id: string) => cart.find((l) => l.p.id === id)?.qty ?? 0;

  const add = (p: P, qty = 1) => {
    if (p.track_stock && inCart(p.id) + qty > Number(p.stock)) { setMsg({ ok: false, text: `Sin stock suficiente de «${p.name}» (quedan ${Number(p.stock)}).` }); return; }
    setMsg(null);
    setCart((c) => { const i = c.findIndex((l) => l.p.id === p.id); if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: Math.round((l.qty + qty) * 1000) / 1000 } : l)); return [...c, { p, qty, discount: 0, serial: '' }]; });
  };
  /** Lector de código de barras = teclado que escribe el código y presiona Enter. */
  const enter = () => {
    const code = q.trim(); if (!code) return;
    const exact = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    if (exact) { add(exact); setQ(''); return; }
    if (list.length === 1) { add(list[0]); setQ(''); return; }
    setMsg({ ok: false, text: list.length ? 'Hay varios productos: toque el que corresponde.' : `No se encontró «${code}».` });
  };

  // 📷 Escanear con la cámara (celular o tablet con Chrome)
  useEffect(() => {
    if (!scan) return;
    let stream: MediaStream | null = null, timer: ReturnType<typeof setInterval> | undefined, stop = false;
    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        if (!BD) { setMsg({ ok: false, text: 'Este navegador no lee códigos con la cámara. Use un lector USB/Bluetooth o escriba el código.' }); setScan(false); return; }
        const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop || !video.current) return;
        video.current.srcObject = stream; await video.current.play();
        timer = setInterval(async () => {
          const codes = await det.detect(video.current!).catch(() => []);
          if (codes[0]?.rawValue) {
            const p = products.find((x) => x.barcode === codes[0].rawValue || x.sku === codes[0].rawValue);
            if (p) { add(p); setScan(false); } else setMsg({ ok: false, text: `Código ${codes[0].rawValue} no registrado.` });
          }
        }, 400);
      } catch { setMsg({ ok: false, text: 'No se pudo usar la cámara.' }); setScan(false); }
    })();
    return () => { stop = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [scan]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = cart.reduce((t, l) => t + lineTotal(l), 0);
  const disc = Math.min(Math.max(0, Number(discount) || 0), subtotal);
  const couponD = coupon ? Math.min(coupon.discount, subtotal - disc) : 0;
  const total = subtotal - disc - couponD;
  const saved = cart.reduce((t, l) => t + (promoOf(l)?.discount ?? 0), 0);
  const cashN = Number(cash) || 0;
  const change = method === 'cash' ? cashN - total : 0;
  const canPay = cart.length > 0 && !pending && (method !== 'cash' || cashN >= total) && cart.every((l) => !l.p.requires_serial || l.serial.trim());

  const pay = () => start(async () => {
    setMsg(null);
    const items: CartLine[] = cart.map((l) => ({ product: l.p.id, qty: l.qty, discount: l.discount || 0, serial: l.serial || undefined }));
    const r = await sell({ items, method, discount: disc, cash: method === 'cash' ? cashN : null, customer: customer.name || customer.doc_number || customer.email ? customer : {}, coupon: coupon?.code });
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'No se pudo registrar la venta.' }); return; }
    const d = r.data as { id: string; number: number; code?: string; total: number; change: number | null };
    setProducts((ps) => ps.map((p) => { const l = cart.find((x) => x.p.id === p.id); return l ? { ...p, stock: Number(p.stock) - l.qty } : p; }));
    if (prefs?.auto_print) window.open(`/app/tienda/ventas/${d.id}/pdf?ver=1`, '_blank', 'noopener');
    notifyChanged(); setDone(d); setCart([]); setCash(''); setDiscount(''); setCoupon(null); setCouponText(''); setCustomer({ name: '', doc_type: 'RUN', doc_number: '', email: '' });
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]" data-testid="caja">
      <section className="card card-pad">
        <div className="flex gap-2">
          <input ref={search} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enter(); } }}
            placeholder="🔍 Escanee el código de barras o escriba el nombre…" className="input flex-1 text-base" data-testid="caja-buscar" />
          <button type="button" className="btn-secondary" onClick={() => setScan((v) => !v)} title="Leer código con la cámara">📷</button>
        </div>
        {scan && <video ref={video} className="mt-2 h-48 w-full rounded-lg bg-black object-cover" muted playsInline />}
        <div className="mt-3 flex flex-wrap gap-1 text-sm">
          <button className={`rounded-full px-3 py-1 ${!kind ? 'bg-ink text-white' : 'bg-slate-100'}`} onClick={() => setKind('')}>Todos</button>
          {KINDS.map(([k, l, i]) => <button key={k} className={`rounded-full px-3 py-1 ${kind === k ? 'bg-ink text-white' : 'bg-slate-100'}`} onClick={() => setKind(k)}>{i} {l}</button>)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {list.map((p) => {
            const left = Number(p.stock) - inCart(p.id); const out = p.track_stock && left <= 0;
            return (
              <button key={p.id} type="button" disabled={out} onClick={() => add(p)} data-testid="caja-producto"
                className="flex flex-col rounded-xl border border-slate-200 p-2 text-left transition hover:border-brand-600 hover:shadow disabled:opacity-40">
                {p.image_asset_id
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/media/${p.image_asset_id}`} alt="" className="mb-1 h-16 w-full rounded object-cover" />
                  : <span className="mb-1 grid h-16 place-items-center rounded bg-slate-50 text-2xl">{kindIcon(p.kind)}</span>}
                <span className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</span>
                <span className="mt-auto flex items-end justify-between pt-1"><b>{money(p.price, currency)}</b>
                  <span className={`text-[11px] ${out ? 'text-red-600' : 'text-slate-500'}`}>{p.track_stock ? (out ? 'Agotado' : `${left} ${p.unit === 'unidad' ? 'u.' : p.unit}`) : ''}</span></span>
              </button>);
          })}
          {!list.length && <p className="col-span-full py-8 text-center text-sm text-slate-500">{products.length ? 'Sin coincidencias.' : 'Aún no hay productos activos. Créelos en «📦 Productos».'}</p>}
        </div>
      </section>

      <aside className="card card-pad flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">🛒 Venta actual</h2>
        <ul className="max-h-[40vh] space-y-2 overflow-y-auto" data-testid="carrito">
          {cart.map((l, i) => (
            <li key={l.p.id} className="rounded-lg bg-slate-50 p-2 text-sm">
              <div className="flex justify-between gap-2"><span className="font-medium">{l.p.name}</span>
                <button className="text-slate-400 hover:text-red-600" onClick={() => setCart((c) => c.filter((_, j) => j !== i))} aria-label="Quitar">✕</button></div>
              <div className="mt-1 flex items-center gap-1">
                <button className="h-7 w-7 rounded bg-white ring-1 ring-slate-200" onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.max(l.p.unit === 'unidad' ? 1 : 0.1, Math.round((x.qty - 1) * 1000) / 1000) } : x)))}>−</button>
                <input value={l.qty} inputMode="decimal" aria-label="Cantidad" className="w-16 rounded border border-slate-200 px-1 py-0.5 text-center"
                  onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (v > 0) setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: l.p.unit === 'unidad' ? Math.round(v) || 1 : v } : x))); }} />
                <button className="h-7 w-7 rounded bg-white ring-1 ring-slate-200" onClick={() => add(l.p)}>+</button>
                <span className="text-xs text-slate-500">{l.p.unit === 'unidad' ? '' : l.p.unit} × {money(l.p.price, currency)}</span>
                <b className="ml-auto">{money(lineTotal(l), currency)}</b>
              </div>
              {promoOf(l) && promoOf(l)!.discount > 0 && <p className="mt-1 text-xs font-semibold text-red-600" data-testid="oferta-linea">🏷 {promoOf(l)!.label}: −{money(promoOf(l)!.discount, currency)}</p>}
              {promoOf(l) && promoOf(l)!.discount === 0 && promoOf(l)!.promo.kind === 'nxm' && <p className="mt-1 text-xs text-slate-500">🏷 {promoOf(l)!.label}</p>}
              <div className="mt-1 flex gap-1 text-xs">
                <input value={l.discount || ''} inputMode="numeric" placeholder="Descuento $" className="w-24 rounded border border-slate-200 px-1 py-0.5"
                  onChange={(e) => setCart((c) => c.map((x, j) => (j === i ? { ...x, discount: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                {l.p.requires_serial && <input value={l.serial} placeholder="N° de serie *" className="min-w-0 flex-1 rounded border border-amber-300 px-1 py-0.5" data-testid="serie"
                  onChange={(e) => setCart((c) => c.map((x, j) => (j === i ? { ...x, serial: e.target.value } : x)))} />}
              </div>
            </li>))}
          {!cart.length && <li className="py-6 text-center text-sm text-slate-400">Escanee o toque un producto para agregarlo.</li>}
        </ul>
        <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal, currency)}</span></div>
          <div className="flex items-center justify-between gap-2"><span>Descuento general</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" placeholder="0" className="w-24 rounded border border-slate-200 px-2 py-0.5 text-right" /></div>
          {saved > 0 && <div className="flex justify-between text-red-600"><span>🏷 Ahorro por ofertas</span><span>−{money(saved, currency)}</span></div>}
          <div className="flex items-center justify-between gap-2"><span>🎟 Cupón</span>
            {coupon ? <span className="text-red-600">{coupon.code} −{money(couponD, currency)} <button className="text-xs text-slate-400" onClick={() => setCoupon(null)}>✕</button></span>
              : <span className="flex gap-1"><input value={couponText} onChange={(e) => setCouponText(e.target.value.toUpperCase())} placeholder="CÓDIGO" className="w-28 rounded border border-slate-200 px-2 py-0.5 text-right uppercase" data-testid="caja-cupon" />
                <button type="button" className="rounded bg-slate-100 px-2 text-xs" data-testid="aplicar-cupon" onClick={async () => {
                  const r = await checkCoupon(couponText, subtotal - disc);
                  if (r.valid) { setCoupon({ code: r.code ?? couponText, discount: Number(r.discount ?? 0) }); setMsg(null); } else setMsg({ ok: false, text: 'Cupón no válido, vencido o sin compra mínima.' });
                }}>Aplicar</button></span>}</div>
          <div className="flex justify-between text-2xl font-black"><span>Total</span><span data-testid="caja-total">{money(total, currency)}</span></div>
          <p className="text-right text-[11px] text-slate-500">IVA incluido</p>
        </div>
        <div className="grid grid-cols-2 gap-1 text-sm">
          {SALE_METHODS.map(([k, l]) => <button key={k} type="button" onClick={() => setMethod(k)} className={`rounded-lg px-2 py-2 ${method === k ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}>{l}</button>)}
        </div>
        {method === 'cash' && (
          <div className="space-y-1 text-sm">
            <label className="flex items-center justify-between gap-2"><span>Recibe</span>
              <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="numeric" className="w-32 rounded border border-slate-200 px-2 py-1 text-right text-lg" data-testid="caja-efectivo" /></label>
            <div className="flex flex-wrap justify-end gap-1">{[total, 1000, 2000, 5000, 10000, 20000].filter((v, i, a) => v >= total && a.indexOf(v) === i).slice(0, 4).map((v) =>
              <button key={v} type="button" className="rounded bg-slate-100 px-2 py-0.5 text-xs" onClick={() => setCash(String(v))}>{v === total ? 'Exacto' : money(v, currency)}</button>)}</div>
            <div className={`flex justify-between text-lg font-bold ${change < 0 ? 'text-red-600' : 'text-emerald-700'}`}><span>Vuelto</span><span data-testid="caja-vuelto">{cash ? money(Math.max(change, 0), currency) : '—'}</span></div>
          </div>)}
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">👤 Datos del cliente (opcional)</summary>
          <div className="mt-2 space-y-1">
            <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Nombre" className="input py-1" />
            <div className="flex gap-1">
              <select value={customer.doc_type} onChange={(e) => setCustomer({ ...customer, doc_type: e.target.value })} className="input w-28 py-1">{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l.split(' ')[0]}</option>)}</select>
              <input value={customer.doc_number} onChange={(e) => setCustomer({ ...customer, doc_number: e.target.value })} placeholder="RUT / pasaporte" className="input py-1" />
            </div>
            <input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="Correo (para enviar el comprobante)" type="email" className="input py-1" />
          </div>
        </details>
        {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} data-testid="caja-mensaje">{msg.text}</p>}
        <button type="button" disabled={!canPay} onClick={pay} className="btn-primary py-3 text-lg disabled:opacity-50" data-testid="cobrar">{pending ? 'Registrando…' : `💰 Cobrar ${money(total, currency)}`}</button>
      </aside>

      {done && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4" role="dialog">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl" data-testid="venta-lista">
            <p className="text-4xl">✅</p>
            <h2 className="mt-2 text-xl font-bold">Boleta {done.code ?? `N° ${done.number}`}</h2>
            <p className="mt-1 text-2xl font-black">{money(Number(done.total), currency)}</p>
            {done.change !== null && <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-lg font-bold text-emerald-800">Vuelto: {money(Number(done.change), currency)}</p>}
            <div className="mt-5 grid gap-2">
              <a className="btn-primary" href={`/app/tienda/ventas/${done.id}/pdf?ver=1`} target="_blank" rel="noopener noreferrer">🖨 Imprimir ticket</a>
              <a className="btn-secondary" href={`/app/tienda/ventas/${done.id}`}>🧾 Ver, enviar o descargar comprobante</a>
              <button className="btn-secondary" onClick={() => { setDone(null); setTimeout(() => search.current?.focus(), 50); }} data-testid="nueva-venta">➕ Nueva venta</button>
            </div>
          </div>
        </div>)}
    </div>
  );
}
