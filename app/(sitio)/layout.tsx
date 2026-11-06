import { getPublicSite, brandStyle } from '@/lib/site';
import { PublicHeader, PublicFooter } from '@/components/site-chrome';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const site = await getPublicSite();
  return { title: { default: site?.site_name ?? 'SEMATEC ACADEMY', template: `%s · ${site?.site_name ?? 'SEMATEC ACADEMY'}` }, description: site?.tagline };
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const site = await getPublicSite();
  return (
    <div style={brandStyle(site?.primary_color, site?.accent_color)} className="min-h-screen bg-white">
      <PublicHeader site={site} />
      {children}
      <PublicFooter site={site} />
    </div>
  );
}
