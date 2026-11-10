import Link from 'next/link';
import type { Site } from '@/lib/site';
import { mediaUrl } from '@/lib/site';

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

export function PublicHeader({ site }: { site: Site | null }) {
  const links = [['/', 'Inicio'], ['/cursos', 'Cursos'], ['/tienda', `🛒 ${(site as any)?.store_name ?? 'SEMATEC VENTA'}`], ['/nosotros', 'Nosotros'], ['/contacto', 'Contacto'], ['/estado', 'Estado de solicitud']];
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/"><SiteLogo site={site} /></Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-600">
          {links.map(([h, l]) => <Link key={h} href={h} className="rounded-lg px-3 py-2 hover:bg-slate-100 hover:text-ink">{l}</Link>)}
          <Link href="/login" className="btn-primary ml-2">Ingresar</Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter({ site }: { site: Site | null }) {
  const social = Object.entries(site?.social_links ?? {}).filter(([, u]) => /^https:\/\//.test(u));
  return (
    <footer className="mt-20 bg-ink text-sky-100/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
        <div><SiteLogo site={site} light /><p className="mt-3 text-sm">{site?.tagline}</p></div>
        <div className="space-y-1 text-sm">
          <p className="font-bold text-white">Contacto</p>
          {site?.contact_email && <p>✉ <a className="hover:underline" href={`mailto:${site.contact_email}`}>{site.contact_email}</a></p>}
          {site?.contact_phone && <p>☎ {site.contact_phone}</p>}
          {site?.whatsapp && <p>WhatsApp: <a className="hover:underline" href={`https://wa.me/${site.whatsapp.replace(/\D/g, '')}`}>{site.whatsapp}</a></p>}
          {site?.address && <p>{site.address}</p>}
          {site?.office_hours && <p>{site.office_hours}</p>}
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-bold text-white">Enlaces</p>
          <p><Link className="hover:underline" href="/verificar">Verificar un certificado</Link></p>
          <p><Link className="hover:underline" href="/legal#terminos">Términos y condiciones</Link></p>
          <p><Link className="hover:underline" href="/legal#privacidad">Política de privacidad</Link></p>
          {social.length > 0 && <p className="pt-2">{social.map(([k, u]) => <a key={k} href={u} target="_blank" rel="noopener noreferrer" className="mr-3 capitalize hover:underline">{k}</a>)}</p>}
        </div>
      </div>
      <p className="border-t border-white/10 py-4 text-center text-xs">{site?.footer_text || `© ${new Date().getFullYear()} ${site?.site_name ?? 'SEMATEC ACADEMY'}`}</p>
    </footer>
  );
}
