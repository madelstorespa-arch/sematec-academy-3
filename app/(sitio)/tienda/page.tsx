import { getPublicSite, anonClient } from '@/lib/site';
import { availableProviders } from '@/lib/payments';
import { Shop } from './shop';

export const metadata = { title: 'SEMATEC VENTA' };
export const dynamic = 'force-dynamic';

/** 🛒 SEMATEC VENTA: supermercado en línea (aseo, comestibles, bebestibles, electrónica y más). */
export default async function Page() {
  const site = await getPublicSite();
  const { data } = site ? await anonClient().rpc('store_catalog', { p_org: site.organization_id }) : { data: [] };
  const products = (data ?? []) as any[];
  const currency = products[0]?.currency ?? 'CLP';
  const name = (site as any)?.store_name ?? 'SEMATEC VENTA';
  return (
    <main className="mx-auto max-w-[1600px] px-3 py-6 sm:px-6">
      <Shop products={products} currency={currency} providers={availableProviders(currency)} whatsapp={site?.whatsapp ?? null}
        storeName={name} orgId={site?.organization_id ?? ''} />
    </main>
  );
}
