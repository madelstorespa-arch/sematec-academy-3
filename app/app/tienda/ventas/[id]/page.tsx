import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can } from '@/lib/context';
import { Card, Badge } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { loadSale } from '@/lib/sale-receipt';
import { mailEnabled } from '@/lib/mailer';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { SALE_STATUS, methodLabel } from '@/lib/store';
import { cancelSale, sendSaleReceipt } from '../../actions';

export const metadata = { title: 'Comprobante de venta' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const s = await loadSale(ctx.supabase, id);
  if (!s) notFound();
  const m = (n: number) => fmtMoney(n, s.currency);
  const wa = `https://wa.me/${(s.customer.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(`${s.org.name}: boleta ${s.code} por ${m(s.total)}. ¡Gracias por su compra!`)}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link className="btn-secondary" href={s.channel === 'web' ? '/app/tienda/pedidos' : '/app/tienda/ventas'}>← Volver</Link>
        <a className="btn-primary" href={`/app/tienda/ventas/${s.id}/pdf`}>⬇ Descargar PDF</a>
        <a className="btn-secondary" href={`/app/tienda/ventas/${s.id}/pdf?ver=1`} target="_blank" rel="noopener noreferrer">🖨 Ticket para impresora</a>
        <PrintButton />
        <a className="btn-secondary" href={wa} target="_blank" rel="noopener noreferrer">📲 WhatsApp</a>
      </div>
      <article className="card mx-auto max-w-md p-6 font-mono text-sm print:shadow-none" data-testid="comprobante-venta">
        <p className="text-center text-base font-bold">{s.org.name}</p>
        {s.org.taxId && <p className="text-center text-xs">RUT {s.org.taxId}</p>}
        <p className="mt-3 text-center font-bold" data-testid="codigo-boleta">BOLETA {s.code}</p>
        <p className="text-center text-xs">{fmtDateTime(s.paidAt ?? s.createdAt)} · {s.channel === 'web' ? 'Pedido web' : 'Caja'}</p>
        {s.status !== 'entregada' && <p className="mt-2 text-center"><Badge color={(SALE_STATUS[s.status]?.[1] ?? 'gray') as any}>{SALE_STATUS[s.status]?.[0]}</Badge></p>}
        {s.seller && <p className="mt-2 text-xs" data-testid="vendedor">Atendido por: {s.seller.name}{s.seller.doc && ` · RUT ${s.seller.doc}`}{s.seller.code && ` · ${s.seller.code}`}</p>}
        {(s.customer.name || s.customer.doc) && <p className="mt-2 text-xs">Cliente: {[s.customer.name, s.customer.doc].filter(Boolean).join(' · ')}</p>}
        <hr className="my-3 border-dashed" />
        {s.items.map((i, k) => (
          <div key={k} className="mb-2">
            <p className="font-bold">{i.name}</p>
            <p className="flex justify-between"><span>{i.qty} {i.unit === 'unidad' ? 'x' : `${i.unit} x`} {m(i.unitPrice)}</span><span>{m(i.total)}</span></p>
            {i.promoDiscount > 0 && <p className="text-xs font-bold text-red-600">🏷 Oferta {i.promo} −{m(i.promoDiscount)}</p>}
            {i.discount - i.promoDiscount > 0 && <p className="text-xs">Descuento −{m(i.discount - i.promoDiscount)}</p>}
            {i.serial && <p className="text-xs">N° serie: {i.serial}</p>}
            {i.warranty && <p className="text-xs">Garantía hasta {fmtDate(i.warranty)}</p>}
          </div>))}
        <hr className="my-3 border-dashed" />
        {s.discount > 0 && <><p className="flex justify-between"><span>Subtotal</span><span>{m(s.subtotal)}</span></p>
          {s.discount - (s.coupon?.discount ?? 0) > 0 && <p className="flex justify-between"><span>Descuento</span><span>−{m(s.discount - (s.coupon?.discount ?? 0))}</span></p>}
          {s.coupon && <p className="flex justify-between"><span>🎟 Cupón {s.coupon.code}</span><span>−{m(s.coupon.discount)}</span></p>}</>}
        <p className="flex justify-between"><span>Neto</span><span>{m(s.total - s.tax)}</span></p>
        <p className="flex justify-between"><span>IVA 19%</span><span>{m(s.tax)}</span></p>
        <p className="flex justify-between text-lg font-bold"><span>TOTAL</span><span>{m(s.total)}</span></p>
        <p className="mt-1">Pago: {methodLabel(s.method)}{!s.paidAt && ' (pendiente)'}</p>
        {s.cash !== null && <><p className="flex justify-between"><span>Efectivo</span><span>{m(s.cash)}</span></p><p className="flex justify-between font-bold"><span>Vuelto</span><span>{m(s.change ?? 0)}</span></p></>}
        {s.channel === 'web' && <p className="mt-2 text-xs">{s.delivery === 'despacho' ? `Despacho a: ${s.address}` : 'Retiro en tienda'} · Seguimiento {s.tracking}</p>}
        {s.status === 'anulada' && <p className="mt-3 rounded bg-red-50 p-2 text-center font-bold text-red-700">ANULADA · {s.cancelReason}</p>}
        <p className="mt-4 text-center text-[10px] text-slate-400">Documento interno. No reemplaza la boleta electrónica del SII.</p>
      </article>
      <div className="mx-auto mt-6 grid max-w-3xl gap-4 md:grid-cols-2 print:hidden">
        <Card title="✉ Enviar por correo">
          {mailEnabled() ? (
            <ActionForm action={sendSaleReceipt} submitLabel="Enviar comprobante" resetOnSuccess={false}>
              <input type="hidden" name="id" value={s.id} /><Field label="Correo" name="email" type="email" required defaultValue={s.customer.email ?? ''} />
            </ActionForm>) : <p className="text-sm text-amber-700">El correo no está configurado (SMTP_* en Vercel). Use PDF o WhatsApp.</p>}
        </Card>
        {s.status !== 'anulada' && (can(ctx, 'store.void') || (s.status === 'pendiente_pago' && can(ctx, 'store.create'))) && (
          <Card title="Anular venta">
            <ActionForm action={cancelSale} submitLabel="Anular y devolver al inventario" submitClass="btn-secondary" confirm="¿Anular esta venta? Los productos vuelven al stock.">
              <input type="hidden" name="id" value={s.id} /><Field label="Motivo" name="reason" required placeholder="Ej.: devolución del cliente" />
            </ActionForm>
          </Card>)}
      </div>
    </>
  );
}
