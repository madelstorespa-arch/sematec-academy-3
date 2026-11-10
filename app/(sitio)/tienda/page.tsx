import { getPublicSite, anonClient } from '@/lib/site';
import { availableProviders } from '@/lib/payments';
import { Shop } from './shop';

export const metadata = { title: 'Tienda' };
export const dynamic = 'force-dynamic';

/** 🛍 Tienda web pública: aseo, comestibles, bebestibles, electrónica y más. */
export default async function Page() {
  const site = await getPublicSite();
  const { data } = site ? await anonClient().rpc('store_catalog', { p_org: site.organization_id }) : { data: [] };
  const products = (data ?? []) as any[];
  const currency = products[0]?.currency ?? 'CLP';
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-black">Tienda</h1>
      <p className="mt-1 text-slate-600">Compre en línea y retire en {site?.site_name ?? 'nuestra tienda'} o pida despacho.</p>
      <Shop products={products} currency={currency} providers={availableProviders(currency)} whatsapp={site?.whatsapp ?? null} />
    </main>
  );
}
