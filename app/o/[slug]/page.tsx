import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { brandStyle } from '@/lib/site';

export const dynamic = 'force-dynamic';

type Landing = { id: string; display_name: string; platform_mode: string; site_name: string | null; tagline: string | null; logo_asset_id: string | null; primary_color: string | null; accent_color: string | null };

async function load(slug: string): Promise<Landing | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  try {
    const { data } = await (await createClient()).rpc('org_landing', { p_slug: slug });
    return ((data ?? []) as Landing[])[0] ?? null;
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const o = await load((await params).slug);
  return { title: o ? `${o.site_name || o.display_name} · Aula virtual` : 'Organización' };
}

/** 🌐 Enlace propio de cada organización: su marca y el acceso a su aula virtual. */
export default async function OrgLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = await load(slug);
  if (!o) notFound();
  const name = o.site_name || o.display_name;
  return (
    <main style={brandStyle(o.primary_color ?? undefined, o.accent_color ?? undefined)} className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 to-white px-4 py-10">
      <div className="card card-pad w-full max-w-md text-center" data-testid="org-landing">
        {o.logo_asset_id
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/media/${o.logo_asset_id}`} alt="" className="mx-auto h-20 w-20 rounded-2xl object-contain" />
          : <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl bg-brand-600 text-3xl font-bold text-white">{name[0]}</div>}
        <h1 className="mt-4 text-2xl font-bold">{name}</h1>
        {o.tagline && <p className="mt-1 text-sm text-slate-600">{o.tagline}</p>}
        <p className="mt-4 text-sm text-slate-600">{o.platform_mode === 'aula' ? 'Aula virtual: clases en vivo, grabaciones, pizarra, archivos y más.' : 'Plataforma académica y aula virtual.'}</p>
        <Link className="btn-primary mt-6 block w-full py-3" href={`/login?next=${encodeURIComponent(`/app/ir/${slug}`)}`} data-testid="org-ingresar">Ingresar a {name}</Link>
        <p className="mt-3 text-xs text-slate-500">¿Le invitaron a una clase como invitado? Use el enlace que le enviaron.</p>
        <p className="mt-6 text-[11px] text-slate-400">Plataforma independiente: los datos de {name} están separados de las demás organizaciones.</p>
      </div>
    </main>
  );
}
