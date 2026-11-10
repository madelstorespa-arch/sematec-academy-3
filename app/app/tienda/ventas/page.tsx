import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { fmtDateTime, fmtMoney, tzOffset } from '@/lib/format';
import { SALE_STATUS, methodLabel } from '@/lib/store';
import { StoreTabs } from '../tabs';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata = { title: 'Ventas' };

export default async function Page({ searchParams }: { searchParams: Promise<{ dia?: string; canal?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const sp = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.dia ?? '') ? sp.dia! : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  let q = ctx.supabase.from('sales').select('id, number, code, channel, status, customer_name, payment_method, total, cost_total, created_at, paid_at, seller_id, coupon_code, sale_items(count)')
    .eq('organization_id', orgId).gte('created_at', `${day}T00:00:00${tzOffset('America/Santiago', new Date(`${day}T12:00:00Z`))}`).lte('created_at', `${day}T23:59:59.999${tzOffset('America/Santiago', new Date(`${day}T12:00:00Z`))}`).order('created_at', { ascending: false }).limit(1000);
  if (sp.canal) q = q.eq('channel', sp.canal);
  const { data: rows } = await q;
  const sellerIds = [...new Set((rows ?? []).map((r: any) => r.seller_id).filter(Boolean))];
  const { data: sellers } = sellerIds.length ? await createAdminClient().from('profiles').select('id, full_name, id_document_number').in('id', sellerIds) : { data: [] };
  const sellerOf = new Map((sellers ?? []).map((p: any) => [p.id, `${p.full_name ?? ''}${p.id_document_number ? ` · ${p.id_document_number}` : ''}`]));
  const valid = (rows ?? []).filter((r: any) => r.status !== 'anulada' && r.paid_at);
  const byMethod: Record<string, number> = {};
  for (const r of valid) byMethod[r.payment_method ?? 'other'] = (byMethod[r.payment_method ?? 'other'] ?? 0) + Number(r.total);
  const total = valid.reduce((t: number, r: any) => t + Number(r.total), 0);
  const profit = valid.reduce((t: number, r: any) => t + Number(r.total) - Number(r.cost_total), 0);
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle="Ventas del día, quién atendió (nombre y RUT) y cuadratura de caja" />
      <StoreTabs current="ventas" />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label><span className="label">Día</span><input type="date" name="dia" defaultValue={day} className="input py-1.5" /></label>
        <label><span className="label">Canal</span><select name="canal" defaultValue={sp.canal ?? ''} className="input py-1.5"><option value="">Caja y web</option><option value="caja">Caja</option><option value="web">Web</option></select></label>
        <button className="btn-secondary">Ver</button>
      </form>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="cuadratura">
        <div className="card card-pad"><p className="label">Total vendido</p><p className="text-xl font-bold">{fmtMoney(total)}</p><p className="text-xs text-slate-500">{valid.length} venta(s)</p></div>
        <div className="card card-pad"><p className="label">Ganancia</p><p className="text-xl font-bold text-emerald-700">{fmtMoney(profit)}</p></div>
        {['cash', 'card', 'bank_transfer'].map((k) => <div key={k} className="card card-pad"><p className="label">{methodLabel(k)}</p><p className="text-xl font-bold">{fmtMoney(byMethod[k] ?? 0)}</p>{k === 'cash' && <p className="text-xs text-slate-500">Debe haber en caja</p>}</div>)}
      </div>
      <Card>
        {rows?.length ? <div className="overflow-x-auto"><table className="table" data-testid="tabla-ventas">
          <thead><tr><th>Boleta</th><th>Hora</th><th>Canal</th><th>Atendió (nombre · RUT)</th><th>Cliente</th><th>Productos</th><th>Pago</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.id} className={r.status === 'anulada' ? 'opacity-50 line-through' : ''}>
              <td><Link className="link font-mono" href={`/app/tienda/ventas/${r.id}`}>🧾 {r.code}</Link></td>
              <td className="text-xs">{fmtDateTime(r.created_at).split(' ').pop()}</td><td>{r.channel === 'web' ? '🌐 Web' : '🧾 Caja'}</td>
              <td className="text-xs">{sellerOf.get(r.seller_id) ?? (r.channel === 'web' ? 'Tienda web' : '—')}</td>
              <td>{r.customer_name ?? '—'}{r.coupon_code && <span className="block text-xs text-red-600">🎟 {r.coupon_code}</span>}</td><td>{r.sale_items?.[0]?.count ?? 0}</td><td>{methodLabel(r.payment_method)}</td>
              <td className="text-right font-semibold">{fmtMoney(r.total)}</td>
              <td><Badge color={(SALE_STATUS[r.status]?.[1] ?? 'gray') as any}>{SALE_STATUS[r.status]?.[0] ?? r.status}</Badge></td></tr>))}</tbody></table></div>
          : <Empty>Sin ventas este día.</Empty>}
      </Card>
    </>
  );
}
