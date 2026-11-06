import Link from 'next/link';
import { getPublicSite, brandStyle } from '@/lib/site';
import { SiteLogo } from '@/components/site-chrome';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent text-sm font-black text-white">SA</div>
      <div className="leading-tight">
        <p className={`text-sm font-black tracking-wide ${light ? 'text-white' : 'text-ink'}`}>SEMATEC</p>
        <p className={`text-[10px] font-bold tracking-[0.3em] ${light ? 'text-sky-200' : 'text-brand-600'}`}>ACADEMY</p>
      </div>
    </div>
  );
}

export async function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const site = await getPublicSite();
  // Fondo editable sin código: usa la "Imagen de portada" de Sitio web y marca
  const bg = site?.hero_asset_id ? `/media/${site.hero_asset_id}` : null;
  const style: React.CSSProperties = { ...brandStyle(site?.primary_color, site?.accent_color) };
  if (bg) Object.assign(style, {
    backgroundImage: `linear-gradient(rgba(11,18,40,.62), rgba(11,18,40,.62)), url("${bg}")`,
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed',
  });
  return (
    <main className="grid min-h-screen lg:grid-cols-2" style={style}>
      <div className={`hidden flex-col justify-between p-10 text-white lg:flex ${bg ? '' : 'bg-ink'}`}>
        <Link href="/"><SiteLogo site={site} light /></Link>
        <div>
          <h2 className="text-3xl font-bold leading-tight">Gestión académica, financiera y aulas virtuales en una sola plataforma.</h2>
          <p className="mt-4 max-w-md text-sky-100/80">Datos protegidos en la nube, separados por institución y disponibles desde cualquier dispositivo autorizado.</p>
        </div>
        <p className="text-xs text-sky-100/60">© {new Date().getFullYear()} {site?.site_name ?? 'SEMATEC ACADEMY'}</p>
      </div>
      <div className="flex items-center justify-center p-4 sm:p-6">
        <div className={`w-full max-w-sm ${bg ? 'rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur sm:p-8' : ''}`}>
          <div className="mb-8 lg:hidden"><Link href="/"><SiteLogo site={site} /></Link></div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
