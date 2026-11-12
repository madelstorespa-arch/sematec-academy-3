import { getPublicSite, brandStyle } from '@/lib/site';
import { PublicHeader, PublicFooter } from '@/components/site-chrome';
import { getLang } from '@/lib/site-i18n';
import { SiteLangProvider } from '@/components/site-lang';
import { PageTranslator } from '@/components/page-translator';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const site = await getPublicSite();
  return { title: { default: site?.site_name ?? 'SEMATEC ACADEMY', template: `%s · ${site?.site_name ?? 'SEMATEC ACADEMY'}` }, description: site?.tagline };
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const site = await getPublicSite();
  const lang = await getLang();
  return (
    <SiteLangProvider lang={lang}>
      <div style={brandStyle(site?.primary_color, site?.accent_color)} className="relative min-h-screen bg-white" lang={lang} translate="no">
        <PublicHeader site={site} />
        {children}
        <PublicFooter site={site} />
        {/* Los textos fijos ya vienen traducidos; el contenido de la institución (cursos, descripciones) lo traduce el navegador */}
        {lang !== 'es' && <PageTranslator locale={lang} />}
      </div>
    </SiteLangProvider>
  );
}
