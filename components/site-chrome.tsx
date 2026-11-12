import Link from 'next/link';
import type { Site } from '@/lib/site';
import { mediaUrl } from '@/lib/site';
import { getT } from '@/lib/site-i18n';
import { LangSwitcher } from '@/components/site-lang';
import { MobileNav } from '@/components/site-mobile-nav';

export function SiteLogo({ site, light = false }: { site: Pick<Site, 'site_name' | 'logo_asset_id' | 'tagline'> | null; light?: boolean }) {
  const name = site?.site_name ?? 'SEMATEC ACADEMY';
  const logo = mediaUrl(site?.logo_asset_id);
  const [first, ...rest] = name.split(' ');
  return (
    <div className="flex items-center gap-2.5">
      {logo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={logo} alt={name} className="h-10 w-auto max-w-[140px] object-contain" />
        : <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent text-sm font-black text-white">{name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>}
      <div className="leading-tight">
        <p className={`text-sm font-black tracking-wide ${light ? 'text-white' : 'text-ink'}`}>{first}</p>
        {rest.length > 0 && <p className={`text-[10px] font-bold tracking-[0.3em] ${light ? 'text-sky-200' : 'text-brand-600'}`}>{rest.join(' ')}</p>}
      </div>
    </div>
  );
}

export async function PublicHeader({ site }: { site: Site | null }) {
  const t = await getT();
  const links: [string, string][] = [['/', t('nav.home')], ['/cursos', t('nav.courses')], ['/tienda', `🛒 ${(site as any)?.store_name ?? 'SEMATEC VENTA'}`], ['/nosotros', t('nav.about')], ['/contacto', t('nav.contact')], ['/estado', t('nav.status')]];
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
        <Link href="/" className="shrink-0"><SiteLogo site={site} /></Link>
        <nav className="hidden items-center gap-0.5 text-sm font-semibold text-slate-600 xl:flex">
          {links.map(([h, l]) => <Link key={h} href={h} className="rounded-lg px-3 py-2 transition hover:bg-slate-100 hover:text-ink">{l}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <LangSwitcher />
          <Link href="/descargar" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 md:inline-flex">📱 {t('nav.app')}</Link>
          <Link href="/login" className="btn-primary hidden sm:inline-flex">{t('nav.login')}</Link>
          <MobileNav links={[...links, ['/descargar', `📱 ${t('footer.app')}`], ['/login', t('nav.login')]]} label={t('nav.menu')} />
        </div>
      </div>
    </header>
  );
}

export async function PublicFooter({ site }: { site: Site | null }) {
  const t = await getT();
  const social = Object.entries(site?.social_links ?? {}).filter(([, u]) => /^https:\/\//.test(u));
  return (
    <footer className="mt-24 bg-ink text-sky-100/80">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="lg:col-span-2"><SiteLogo site={site} light /><p className="mt-4 max-w-md text-sm leading-relaxed">{site?.tagline}</p>
          {social.length > 0 && <p className="mt-5 flex flex-wrap gap-2">{social.map(([k, u]) => <a key={k} href={u} target="_blank" rel="noopener noreferrer" className="rounded-full border border-white/15 px-3 py-1 text-xs capitalize hover:bg-white/10">{k}</a>)}</p>}
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-bold text-white">{t('footer.contact')}</p>
          {site?.contact_email && <p>✉ <a className="hover:underline" href={`mailto:${site.contact_email}`}>{site.contact_email}</a></p>}
          {site?.contact_phone && <p>☎ {site.contact_phone}</p>}
          {site?.whatsapp && <p>{t('footer.whatsapp')}: <a className="hover:underline" href={`https://wa.me/${site.whatsapp.replace(/\D/g, '')}`}>{site.whatsapp}</a></p>}
          {site?.address && <p>{site.address}</p>}
          {site?.office_hours && <p>{site.office_hours}</p>}
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-bold text-white">{t('footer.links')}</p>
          <p><Link className="hover:underline" href="/cursos">{t('nav.courses')}</Link></p>
          <p><Link className="hover:underline" href="/estado">{t('nav.status')}</Link></p>
          <p><Link className="hover:underline" href="/descargar">{t('footer.app')}</Link></p>
          <p><Link className="hover:underline" href="/verificar">{t('footer.verify')}</Link></p>
          <p><Link className="hover:underline" href="/legal#terminos">{t('footer.terms')}</Link></p>
          <p><Link className="hover:underline" href="/legal#privacidad">{t('footer.privacy')}</Link></p>
        </div>
      </div>
      <p className="border-t border-white/10 py-5 text-center text-xs">{site?.footer_text || `© ${new Date().getFullYear()} ${site?.site_name ?? 'SEMATEC ACADEMY'}`}</p>
    </footer>
  );
}
