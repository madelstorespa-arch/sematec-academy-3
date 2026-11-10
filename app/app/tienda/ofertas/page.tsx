import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDate, fmtMoney } from '@/lib/format';
import { KINDS, PROMO_KINDS, kindLabel, promoLabel, type Promo } from '@/lib/store';
import { StoreTabs } from '../tabs';
import { PromoFields } from './promo-fields';
import { deleteCoupon, deletePromotion, saveCoupon, savePromotion } from '../actions';

export const metadata = { title: 'Ofertas y cupones' };

function state(p: { active: boolean; starts_at: string | null; ends_at: string | null }) {
  const now = Date.now();
  if (!p.active) return ['Pausada', 'gray'];
  if (p.starts_at && Date.parse(p.starts_at) > now) return ['Programada', 'blue'];
  if (p.ends_at && Date.parse(p.ends_at) <= now) return ['Terminada', 'gray'];
  return ['Vigente', 'green'];
}

export default async function Page() {
  const ctx = await getContext();
  if (!can(ctx, 'store.view') && !can(ctx, 'store.create')) redirect('/app');
  const orgId = requireOrg(ctx);
  const [{ data: promos }, { data: coupons }, { data: products }] = await Promise.all([
    ctx.supabase.from('store_promotions').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    ctx.supabase.from('store_coupons').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    ctx.supabase.from('products').select('id, name, sku, category, kind, price').eq('organization_id', orgId).eq('active', true).or(ctx.campusId ? `campus_id.eq.${ctx.campusId},campus_id.is.null` : 'id.not.is.null').order('name').limit(3000),
  ]);
  const edit = can(ctx, 'store.edit');
  const names = new Map((products ?? []).map((p: any) => [p.id, p.name]));
  const categories = [...new Set((products ?? []).map((p: any) => p.category).filter(Boolean))] as string[];
  const scopeText = (p: Promo) => p.scope === 'all' ? 'Toda la tienda' : p.scope === 'kind' ? kindLabel(p.scope_kind ?? '') : p.scope === 'category' ? `Categoría «${p.scope_category}»`
    : p.product_ids.map((id) => names.get(id) ?? '—').join(', ');
  return (
    <>
      <PageHeader title="SEMATEC VENTA" subtitle="Ofertas, promociones (3x2, % de descuento, precio oferta) y cupones: se aplican solos en la caja y en la tienda web" />
      <StoreTabs current="ofertas" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          {edit && <Card title="🏷 Nueva oferta o promoción"><ActionForm action={savePromotion} submitLabel="Crear oferta"><PromoFields products={(products ?? []) as any[]} categories={categories} /></ActionForm></Card>}
          <Card title={`Ofertas (${promos?.length ?? 0})`}>
            {promos?.length ? <ul className="divide-y divide-slate-100" data-testid="lista-ofertas">{(promos as Promo[]).map((p) => {
              const [st, color] = state(p);
              return (
                <li key={p.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><b>{p.name}</b> <Badge color="red">{promoLabel(p)}</Badge> <Badge color={color as any}>{st}</Badge></span>
                    <span className="text-xs text-slate-500">{p.channel === 'ambos' ? 'Caja y web' : p.channel === 'caja' ? 'Solo caja' : 'Solo web'}</span>
                  </div>
                  <p className="text-xs text-slate-500">{PROMO_KINDS.find(([k]) => k === p.kind)?.[1]}{p.kind === 'price' || p.kind === 'amount' ? ` · ${fmtMoney(p.value)}` : ''} · {scopeText(p)}
                    {(p.starts_at || p.ends_at) && ` · ${p.starts_at ? `desde ${fmtDate(p.starts_at)}` : ''} ${p.ends_at ? `hasta ${fmtDate(p.ends_at)}` : ''}`}</p>
                  {edit && <div className="mt-1 flex gap-3">
                    <details><summary className="link cursor-pointer text-xs">✏ Editar</summary>
                      <div className="mt-2 rounded-xl border border-slate-200 p-3"><ActionForm action={savePromotion} submitLabel="Guardar" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={p.id} /><PromoFields d={p} products={(products ?? []) as any[]} categories={categories} /></ActionForm></div></details>
                    <ActionForm action={deletePromotion} inline submitLabel="🗑 Eliminar" submitClass="text-xs text-red-600 hover:underline" confirm={`¿Eliminar la oferta «${p.name}»?`}><input type="hidden" name="id" value={p.id} /></ActionForm>
                  </div>}
                </li>);
            })}</ul> : <Empty>Sin ofertas. Cree la primera: por ejemplo «Lleva 3 paga 2» en bebidas o 20% en electrónica.</Empty>}
          </Card>
        </div>
        <div className="space-y-6">
          {edit && (
            <Card title="🎟 Nuevo cupón de descuento">
              <ActionForm action={saveCoupon} submitLabel="Crear cupón">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block"><span className="label">Código *</span><input name="code" required className="input uppercase" placeholder="BIENVENIDA10" /></label>
                  <label className="block"><span className="label">Tipo</span><select name="kind" className="input"><option value="percent">% de descuento</option><option value="amount">$ de descuento</option></select></label>
                  <label className="block"><span className="label">Valor *</span><input name="value" type="number" min={1} required className="input" /></label>
                  <label className="block"><span className="label">Compra mínima</span><input name="min_total" type="number" min={0} className="input" /></label>
                  <label className="block"><span className="label">Usos máximos</span><input name="max_uses" type="number" min={1} className="input" placeholder="Sin límite" /></label>
                  <label className="block"><span className="label">Vence el</span><input name="ends_at" type="date" className="input" /></label>
                  <label className="block"><span className="label">Dónde</span><select name="channel" className="input"><option value="ambos">Caja y web</option><option value="web">Solo web</option><option value="caja">Solo caja</option></select></label>
                </div>
              </ActionForm>
            </Card>)}
          <Card title={`Cupones (${coupons?.length ?? 0})`}>
            {coupons?.length ? <table className="table" data-testid="lista-cupones"><thead><tr><th>Código</th><th>Descuento</th><th>Usos</th><th>Estado</th><th></th></tr></thead>
              <tbody>{coupons.map((c: any) => { const [st, color] = state(c); return (
                <tr key={c.id}><td className="font-mono font-bold">{c.code}</td><td>{c.kind === 'percent' ? `${Number(c.value)}%` : fmtMoney(c.value)}{Number(c.min_total) > 0 && <span className="block text-xs text-slate-500">mín. {fmtMoney(c.min_total)}</span>}</td>
                  <td>{c.uses}{c.max_uses ? `/${c.max_uses}` : ''}</td><td><Badge color={color as any}>{st}</Badge>{c.ends_at && <span className="block text-xs text-slate-500">hasta {fmtDate(c.ends_at)}</span>}</td>
                  <td>{edit && <ActionForm action={deleteCoupon} inline submitLabel="🗑" submitClass="text-red-600" confirm={`¿Eliminar el cupón ${c.code}?`}><input type="hidden" name="id" value={c.id} /></ActionForm>}</td></tr>); })}</tbody></table>
              : <Empty>Sin cupones.</Empty>}
          </Card>
          <Card title="¿Cómo funcionan?">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>Las ofertas se aplican <b>solas</b> en la caja y en la tienda web; si hay varias, se usa la que más descuenta.</li>
              <li>«Lleva 3 paga 2»: por cada 3 unidades, una sale gratis.</li>
              <li>El cupón se escribe al cobrar o al confirmar el pedido web y descuenta del total.</li>
              <li>En la tienda web se muestra el precio normal tachado y la etiqueta de la oferta.</li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">Tipos de producto: {KINDS.map(([, l, i]) => `${i} ${l}`).join(' · ')}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
