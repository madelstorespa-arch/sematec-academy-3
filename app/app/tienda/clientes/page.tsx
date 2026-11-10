import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Stat } from '@/components/ui';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { methodLabel } from '@/lib/store';
import { StoreTabs } from '../tabs';

export const metadata = { title: 'Clientes' };
type C = { key: string; name: string; doc: string | null; email: string | null; phone: string | null; purchases: number; total: number; last_purchase: string; channels: string };

/** 👥 Clientes de SEMATEC VENTA: quiénes compran, cuánto y cuándo (a partir de las boletas con nombre, RUT o correo). */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const { q = '', c } = await searchParams;
  const { data } = await ctx.supabase.rpc('store_customers', { p_org: orgId, p_q: q.slice(0, 200) || null, p_campus: ctx.campusId });
  const list = (data ?? []) as C[];
  const sel = c ? list.find((x) => x.key === c) ?? null : null;
  let hist: any[] = [];
  if (sel) {
    const f = sel.doc ? `customer_doc_number.eq.${sel.doc}` : sel.email ? `customer_email.ilike.${sel.email}` : `customer_name.ilike.${sel.name}`;
    const { data: h } = await ctx.supabase.from('sales').select('id, code, created_at, total, payment_method, channel, status, sale_items(name, qty)')
      .eq('organization_id', orgId).or(f.replace(/[,()]/g, '')).match(ctx.campusId ? { campus_id: ctx.campusId } : {}).order('created_at', { ascending: false }).limit(200);
    hist = h ?? [];
  }
  const total = list.reduce((a, x) => a + Number(x.total), 0);
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle={`Clientes${ctx.campusName ? ` · Sucursal ${ctx.campusName}` : ''}`} />
      <StoreTabs current="clientes" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Clientes identificados" value={String(list.length)} />
        <Stat label="Total comprado" value={fmtMoney(total)} />
        <Stat label="Mejor cliente" value={list[0]?.name ?? '—'} hint={list[0] ? fmtMoney(list[0].total) : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_28rem]">
        <Card title="👥 Clientes">
          <form className="mb-3 flex gap-2" method="get"><input name="q" defaultValue={q} placeholder="🔍 Nombre, RUT, correo o teléfono" className="input" data-testid="buscar-cliente" /><button className="btn-secondary">Buscar</button></form>
          {list.length ? <div className="overflow-x-auto"><table className="table" data-testid="tabla-clientes">
            <thead><tr><th>Cliente</th><th>RUT / correo</th><th className="text-right">Compras</th><th className="text-right">Total</th><th>Última</th></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.key} className={sel?.key === x.key ? 'bg-brand-50' : ''}>
                <td><Link className="link" href={`/app/tienda/clientes?c=${encodeURIComponent(x.key)}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>{x.name || '—'}</Link>
                  {Number(x.purchases) >= 5 && <Badge color="amber">⭐ Frecuente</Badge>}</td>
                <td className="text-xs">{x.doc ?? ''}{x.email ? <span className="block text-slate-500">{x.email}</span> : null}</td>
                <td className="text-right">{x.purchases}</td>
                <td className="text-right font-semibold">{fmtMoney(x.total)}</td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(x.last_purchase)}</td>
              </tr>))}</tbody></table></div>
            : <Empty>{q ? 'Ningún cliente coincide.' : 'Aún no hay clientes identificados. En la caja, anote el nombre, RUT o correo del cliente para verlo aquí.'}</Empty>}
        </Card>
        <Card title={sel ? `🧾 Compras de ${sel.name}` : 'Historial'}>
          {sel ? (
            <div className="space-y-2 text-sm" data-testid="historial-cliente">
              <p className="text-slate-600">{[sel.doc, sel.email, sel.phone].filter(Boolean).join(' · ')}</p>
              <ul className="divide-y divide-slate-100">{hist.map((h) => (
                <li key={h.id} className="py-2"><div className="flex justify-between gap-2"><Link className="link font-mono text-xs" href={`/app/tienda/ventas/${h.id}`}>{h.code}</Link><b>{fmtMoney(h.total)}</b></div>
                  <p className="text-xs text-slate-500">{fmtDateTime(h.created_at)} · {methodLabel(h.payment_method)} · {h.channel === 'web' ? 'Web' : 'Caja'}{h.status === 'anulada' ? ' · anulada' : ''}</p>
                  <p className="text-xs">{(h.sale_items ?? []).map((i: any) => `${i.qty} × ${i.name}`).join(', ')}</p></li>))}</ul>
            </div>) : <p className="text-sm text-slate-500">Elija un cliente para ver todo lo que ha comprado.</p>}
        </Card>
      </div>
    </>
  );
}
