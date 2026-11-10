import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader } from '@/components/ui';
import { StoreTabs } from '../tabs';
import { Pos } from './pos';

export const metadata = { title: 'Caja' };

export default async function Page() {
  const ctx = await getContext();
  if (!can(ctx, 'store.create')) redirect('/app/tienda');
  const orgId = requireOrg(ctx);
  const [{ data: products }, { data: org }] = await Promise.all([
    ctx.supabase.from('products').select('id, sku, barcode, name, kind, category, unit, price, stock, track_stock, requires_serial, warranty_months, tax_rate, image_asset_id')
      .eq('organization_id', orgId).eq('active', true).order('name').limit(3000),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
  ]);
  return (
    <>
      <PageHeader title="Caja" subtitle="Escanee el código de barras o busque el producto, cobre y entregue el comprobante" />
      <StoreTabs current="caja" />
      <Pos products={(products ?? []) as any[]} currency={org?.base_currency ?? 'CLP'} />
    </>
  );
}
