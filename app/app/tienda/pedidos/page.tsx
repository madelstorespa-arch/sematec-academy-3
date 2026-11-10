import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { SALE_STATUS, methodLabel } from '@/lib/store';
import { StoreTabs } from '../tabs';
import { cancelSale, setOrderStatus } from '../actions';

export const metadata = { title: 'Pedidos web' };

export default async function Page({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  let q = ctx.supabase.from('sales').select('id, number, status, customer_name, customer_email, customer_phone, delivery, address, payment_method, total, created_at, paid_at, notes, sale_items(name, qty)')
    .eq('organization_id', orgId).eq('channel', 'web').order('created_at', { ascending: false }).limit(300);
  if (sp.ver !== 'todos') q = q.in('status', ['pendiente_pago', 'pagada', 'lista']);
  const { data: rows } = await q;
  const act = can(ctx, 'store.create');
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle="Pedidos de la tienda web: confirme el pago, prepare y entregue" actions={<a className="btn-secondary" href="/tienda" target="_blank" rel="noopener noreferrer">🌐 Ver tienda web</a>} />
      <StoreTabs current="pedidos" />
      <p className="mb-4 text-sm"><Link className="link" href={sp.ver === 'todos' ? '/app/tienda/pedidos' : '/app/tienda/pedidos?ver=todos'}>{sp.ver === 'todos' ? 'Ver solo los por atender' : 'Ver también entregados y anulados'}</Link></p>
      {rows?.length ? <div className="grid gap-4 lg:grid-cols-2" data-testid="pedidos">{rows.map((o: any) => (
        <Card key={o.id} title={`Pedido N° ${o.number}`} actions={<Badge color={(SALE_STATUS[o.status]?.[1] ?? 'gray') as any}>{SALE_STATUS[o.status]?.[0]}</Badge>}>
          <p className="text-sm font-semibold">{o.customer_name} <span className="font-normal text-slate-500">· {[o.customer_phone, o.customer_email].filter(Boolean).join(' · ')}</span></p>
          <p className="text-xs text-slate-500">{fmtDateTime(o.created_at)} · {o.delivery === 'despacho' ? `🚚 Despacho: ${o.address}` : '🏪 Retiro en tienda'} · Pago: {methodLabel(o.payment_method)}</p>
          <ul className="my-3 text-sm">{o.sale_items.map((i: any, k: number) => <li key={k}>• {Number(i.qty)} × {i.name}</li>)}</ul>
          {o.notes && <p className="mb-2 rounded bg-slate-50 p-2 text-xs">📝 {o.notes}</p>}
          <p className="text-lg font-bold">{fmtMoney(o.total)}</p>
          {act && o.status !== 'anulada' && o.status !== 'entregada' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!o.paid_at && (
                <ActionForm action={setOrderStatus} inline submitLabel="💰 Registrar pago" submitClass="btn-primary btn-sm">
                  <input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="pagada" />
                  <select name="method" defaultValue={o.payment_method === 'cash' ? 'cash' : 'bank_transfer'} className="input py-1 text-xs">
                    <option value="bank_transfer">Transferencia</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option></select>
                </ActionForm>)}
              {o.paid_at && o.status === 'pagada' && <ActionForm action={setOrderStatus} inline submitLabel="📦 Listo" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="lista" /></ActionForm>}
              {o.paid_at && <ActionForm action={setOrderStatus} inline submitLabel="✅ Entregado" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="entregada" /></ActionForm>}
              <ActionForm action={cancelSale} inline submitLabel="Anular" submitClass="text-xs text-red-600 hover:underline" confirm="¿Anular el pedido? Los productos vuelven al stock.">
                <input type="hidden" name="id" value={o.id} /><input name="reason" required placeholder="Motivo" className="input w-28 py-1 text-xs" />
              </ActionForm>
            </div>)}
          <p className="mt-2 text-xs"><Link className="link" href={`/app/tienda/ventas/${o.id}`}>🧾 Comprobante</Link></p>
        </Card>))}</div> : <Card><Empty>No hay pedidos web por atender.</Empty></Card>}
    </>
  );
}
