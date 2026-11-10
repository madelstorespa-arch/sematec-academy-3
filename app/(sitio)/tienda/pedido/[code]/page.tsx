import Link from 'next/link';
import { loadSaleByTracking } from '@/lib/sale-receipt';
import { getPublicSite } from '@/lib/site';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { methodLabel } from '@/lib/store';

export const metadata = { title: 'Mi pedido', robots: { index: false } };
export const dynamic = 'force-dynamic';

const STEPS: [string, string][] = [['pendiente_pago', 'Recibido'], ['pagada', 'Pagado'], ['lista', 'Listo'], ['entregada', 'Entregado']];

/** Seguimiento del pedido con su código (sin cuenta). */
export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const { code } = await params;
  const { aviso } = await searchParams;
  const [s, site] = await Promise.all([loadSaleByTracking(code), getPublicSite()]);
  if (!s || s.channel !== 'web') return <main className="mx-auto max-w-xl px-4 py-16 text-center"><p>No encontramos un pedido con ese código.</p><Link className="link" href="/tienda">Volver a la tienda</Link></main>;
  const idx = STEPS.findIndex(([k]) => k === s.status);
  const m = (n: number) => fmtMoney(n, s.currency);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12" data-testid="seguimiento">
      <p className="text-sm text-slate-500">Código de seguimiento <b className="font-mono">{s.tracking}</b></p>
      <h1 className="text-3xl font-black">Pedido N° {s.number}</h1>
      <p className="text-sm text-slate-500">{fmtDateTime(s.createdAt)} · {s.customer.name}</p>
      {aviso === 'pago' && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No pudimos conectar con el pago en línea. Su pedido quedó registrado: puede pagarlo por transferencia o al retirar.</p>}
      {s.status === 'anulada' ? <p className="mt-6 rounded-xl bg-red-50 p-4 font-semibold text-red-700">Pedido anulado{s.cancelReason ? `: ${s.cancelReason}` : ''}</p> : (
        <ol className="mt-6 grid grid-cols-4 gap-1 text-center text-xs" data-testid="estado-pedido">{STEPS.map(([k, l], i) => (
          <li key={k} className={`rounded-lg py-2 ${i <= idx ? 'bg-brand-600 font-semibold text-white' : 'bg-slate-100 text-slate-500'}`}>{i <= idx ? '✓ ' : ''}{l}</li>))}</ol>)}
      {s.status === 'pendiente_pago' && (
        <div className="mt-6 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
          {s.method === 'bank_transfer' ? <>
            <p className="font-semibold">🏦 Pague por transferencia: {m(s.total)}</p>
            <p className="mt-1">Indique el N° de pedido <b>{s.number}</b> en el comentario. {site?.contact_email && <>Envíe el comprobante a <a className="link" href={`mailto:${site.contact_email}`}>{site.contact_email}</a></>}{site?.whatsapp && <> o por <a className="link" href={`https://wa.me/${site.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Pedido N° ${s.number} (${s.tracking})`)}`}>WhatsApp</a></>} para pedir los datos bancarios.</p>
          </> : s.method === 'cash' ? <p>💵 Pague {m(s.total)} al {s.delivery === 'despacho' ? 'recibir su pedido' : 'retirar en la tienda'}.</p>
            : <p>Esperando la confirmación del pago en línea…</p>}
        </div>)}
      <div className="mt-6 rounded-2xl border border-slate-200 p-5">
        <ul className="space-y-2 text-sm">{s.items.map((i, k) => <li key={k} className="flex justify-between"><span>{i.qty} × {i.name}</span><span>{m(i.total)}</span></li>)}</ul>
        <p className="mt-3 flex justify-between border-t pt-3 text-xl font-black"><span>Total</span><span>{m(s.total)}</span></p>
        <p className="mt-2 text-sm text-slate-600">{s.delivery === 'despacho' ? `🚚 Despacho a: ${s.address}` : '🏪 Retiro en tienda'} · Pago: {methodLabel(s.method)}</p>
      </div>
      {s.paidAt && <a className="btn-secondary mt-4 inline-block" href={`/tienda/pedido/${s.tracking}/pdf`}>⬇ Descargar comprobante</a>}
      <p className="mt-6 text-center"><Link className="link" href="/tienda">← Seguir comprando</Link></p>
    </main>
  );
}
