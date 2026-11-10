import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { StoreTabs } from '../tabs';
import { PurchaseForm } from './purchase-form';

export const metadata = { title: 'Compras' };

export default async function Page() {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const [{ data: products }, { data: rows }] = await Promise.all([
    ctx.supabase.from('products').select('id, sku, name, cost, unit, track_expiry').eq('organization_id', orgId).eq('active', true).or(ctx.campusId ? `campus_id.eq.${ctx.campusId},campus_id.is.null` : 'id.not.is.null').order('name').limit(3000),
    ctx.supabase.from('purchases').select('id, supplier, document_number, purchased_on, total, currency, expense_id, purchase_items(qty, unit_cost, expires_on, products(name))')
      .eq('organization_id', orgId).match(ctx.campusId ? { campus_id: ctx.campusId } : {}).order('created_at', { ascending: false }).limit(100),
  ]);
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle="Ingreso de mercadería: suma stock (con lote y vencimiento) y registra el gasto" />
      <StoreTabs current="compras" />
      {can(ctx, 'store.edit') && <Card title="📥 Registrar compra a proveedor" className="mb-6"><PurchaseForm products={(products ?? []) as any[]} /></Card>}
      <Card title="Compras registradas">
        {rows?.length ? <div className="overflow-x-auto"><table className="table" data-testid="tabla-compras">
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Productos</th><th className="text-right">Total</th><th>Gasto</th></tr></thead>
          <tbody>{rows.map((p: any) => (
            <tr key={p.id} className="align-top"><td>{fmtDate(p.purchased_on)}</td><td>{p.supplier ?? '—'}</td><td>{p.document_number ?? '—'}</td>
              <td className="text-xs">{p.purchase_items.map((i: any, k: number) => <span key={k} className="block">{Number(i.qty)} × {i.products?.name} a {fmtMoney(i.unit_cost)}{i.expires_on ? ` · vence ${fmtDate(i.expires_on)}` : ''}</span>)}</td>
              <td className="text-right font-semibold">{fmtMoney(p.total, p.currency)}</td><td>{p.expense_id ? '✓ registrado' : '—'}</td></tr>))}</tbody></table></div>
          : <Empty>Aún no hay compras registradas.</Empty>}
      </Card>
    </>
  );
}
