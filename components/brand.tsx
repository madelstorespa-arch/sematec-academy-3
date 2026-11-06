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
  return (
    <main className="grid min-h-screen lg:grid-cols-2" style={brandStyle(site?.primary_color, site?.accent_color)}>
      <div className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex">
        <Link href="/"><SiteLogo site={site} light /></Link>
        <div>
          <h2 className="text-3xl font-bold leading-tight">Gestión académica, financiera y aulas virtuales en una sola plataforma.</h2>
          <p className="mt-4 max-w-md text-sky-100/80">Datos protegidos en la nube, separados por institución y disponibles desde cualquier dispositivo autorizado.</p>
        </div>
        <p className="text-xs text-sky-100/60">© {new Date().getFullYear()} {site?.site_name ?? 'SEMATEC ACADEMY'}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Link href="/"><SiteLogo site={site} /></Link></div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
