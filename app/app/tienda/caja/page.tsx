import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import Link from 'next/link';
import { PageHeader, Card } from '@/components/ui';
import { StoreTabs } from '../tabs';
import { Pos } from './pos';

export const metadata = { title: 'Caja' };

export default async function Page() {
  const ctx = await getContext();
  if (!can(ctx, 'store.create')) redirect('/app/tienda');
  const orgId = requireOrg(ctx);
  const me = ctx.profile as any;
  if (!me?.full_name || !me?.id_document_number) return (
    <>
      <PageHeader title="Caja" subtitle="SEMATEC VENTA" />
      <StoreTabs current="caja" />
      <Card><div className="py-6 text-center" data-testid="caja-sin-identidad">
        <p className="text-4xl">🪪</p><p className="mt-2 text-lg font-bold">Antes de vender, registre su nombre y RUT</p>
        <p className="mt-1 text-sm text-slate-600">En SEMATEC VENTA cada venta, compra o cambio queda registrado con el nombre y RUT de quien lo hizo.</p>
        <Link className="btn-primary mt-4 inline-block" href="/app/perfil">Completar en «Mi cuenta»</Link></div></Card>
    </>);
  const [{ data: products }, { data: org }, { data: promos }] = await Promise.all([
    ctx.supabase.from('products').select('id, sku, barcode, name, kind, category, unit, price, stock, track_stock, requires_serial, warranty_months, tax_rate, image_asset_id')
      .eq('organization_id', orgId).eq('active', true).order('name').limit(3000),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
    ctx.supabase.from('store_promotions').select('*').eq('organization_id', orgId).eq('active', true),
  ]);
  return (
    <>
      <PageHeader title="Caja · SEMATEC VENTA" subtitle={`Atiende: ${me.full_name} · ${me.id_document_number}${me.user_code ? ` · ${me.user_code}` : ''}`} />
      <StoreTabs current="caja" />
      <Pos products={(products ?? []) as any[]} currency={org?.base_currency ?? 'CLP'} promos={(promos ?? []) as any[]} />
    </>
  );
}
