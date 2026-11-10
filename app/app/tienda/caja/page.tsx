import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import Link from 'next/link';
import { fmtMoney } from '@/lib/format';
import { PageHeader, Card } from '@/components/ui';
import { StoreTabs } from '../tabs';
import { Pos } from './pos';
import { prefsOf } from '@/lib/prefs';

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
  const [{ data: products }, { data: org }, { data: promos }, { data: cash }] = await Promise.all([
    ctx.supabase.from('products').select('id, sku, barcode, name, kind, category, unit, price, stock, track_stock, requires_serial, warranty_months, tax_rate, image_asset_id')
      .eq('organization_id', orgId).eq('active', true).or(ctx.campusId ? `campus_id.eq.${ctx.campusId},campus_id.is.null` : 'id.not.is.null').order('name').limit(3000),
    ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
    ctx.supabase.from('store_promotions').select('*').eq('organization_id', orgId).eq('active', true),
    ctx.supabase.rpc('cash_status', { p_org: orgId }),
  ]);
  const cs = cash as null | { opened_at: string; count: number; total: number; expected: number };
  return (
    <>
      <PageHeader title="Caja · SEMATEC VENTA" subtitle={`Atiende: ${me.full_name} · ${me.id_document_number}${me.user_code ? ` · ${me.user_code}` : ''}`} />
      <StoreTabs current="caja" />
      <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${cs ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`} data-testid="estado-caja">
        {cs ? <>🟢 Caja abierta desde {new Date(cs.opened_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })} · {cs.count} venta(s) · efectivo esperado {fmtMoney(cs.expected)} · <Link className="link" href="/app/tienda/cierre">Cerrar caja</Link></>
          : <>💵 Su caja no está abierta. <Link className="link" href="/app/tienda/cierre">Abra su caja</Link> con el dinero inicial para llevar el arqueo del turno.</>}
        {ctx.campusName && <b className="ml-2">· 🏢 {ctx.campusName}</b>}
        {!ctx.campusId && ctx.campuses.length > 1 && <span className="ml-2">· ⚠ Elija su sucursal en el menú (🏢) para vender solo sus productos.</span>}
      </p>
      <Pos products={(products ?? []) as any[]} currency={org?.base_currency ?? 'CLP'} promos={(promos ?? []) as any[]} prefs={prefsOf(ctx.profile).pos} />
    </>
  );
}
