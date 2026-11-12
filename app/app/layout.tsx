import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { aulaExcluded } from '@/lib/platform-mode';
import { getContext } from '@/lib/context';
import { SiteLogo } from '@/components/site-chrome';
import { brandStyle } from '@/lib/site';
import { Nav } from '@/components/nav';
import { buildNav } from '@/lib/nav-items';
import { switchOrg, switchBranch, setMyLocale } from './actions';
import { PageTranslator } from '@/components/page-translator';
import { prefsOf } from '@/lib/prefs';
import { BranchSelect } from '@/components/branch-select';
import { MobileMenu } from '@/components/mobile-menu';
import { OfflineBar, LogoutButton } from '@/components/offline-bar';
import { UndoBar } from '@/components/undo-bar';
import { VersionWatcher } from '@/components/version-watcher';
import { GlobalSearch } from '@/components/global-search';
import { ConferenceHost } from '@/components/conference/host';
import { WindowBar } from '@/components/window-bar';
import { cardThemeAttrs, resolveCardTheme } from '@/lib/card-theme';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (ctx.needsMfa) redirect('/mfa');
  if (ctx.profile && ctx.profile.status !== 'active') redirect('/login');

  const items = await buildNav(ctx);
  const locale = prefsOf(ctx.profile).locale ?? 'es';
  const [{ data: site }, { data: cardSetting }] = ctx.orgId
    ? await Promise.all([
      ctx.supabase.from('site_settings').select('site_name, tagline, logo_asset_id, primary_color, accent_color').eq('organization_id', ctx.orgId).maybeSingle(),
      ctx.supabase.from('organization_settings').select('value').eq('organization_id', ctx.orgId).eq('key', 'ui.cards').maybeSingle(),
    ])
    : [{ data: null }, { data: null }];
  const cards = cardThemeAttrs(resolveCardTheme((ctx.profile?.preferences as { cards?: unknown } | null)?.cards, cardSetting?.value));
  const path = (await headers()).get('x-sematec-path') ?? '';
  const blocked = ctx.orgMode === 'aula' && aulaExcluded(path);
  const avatar = ctx.profile?.avatar_asset_id ? `/media/${ctx.profile.avatar_asset_id}` : null;

  return (
    <ConferenceHost>
    <div className="lg:flex" data-cards={cards['data-cards']} data-card-panels={cards['data-card-panels']} style={{ ...brandStyle(site?.primary_color, site?.accent_color), ...cards.style } as React.CSSProperties}>
      <aside className="app-aside sticky top-0 z-30 flex max-h-screen flex-col overflow-y-auto bg-ink px-4 py-3 lg:fixed lg:inset-y-0 lg:w-64 lg:py-5">
        <MobileMenu header={<div className="px-2"><SiteLogo site={site} light /></div>} top={ctx.orgId ? <GlobalSearch items={items} /> : undefined}>
        {ctx.orgs.length > 0 && (
          <form action={switchOrg} className="mt-5 px-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-sky-200/70">Institución</label>
            <select name="org" defaultValue={ctx.orgId ?? ''} className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white"
              onChange={undefined}>
              {ctx.orgs.map((o) => <option key={o.organization_id} value={o.organization_id} className="text-ink">{o.display_name}</option>)}
            </select>
            {ctx.orgs.length > 1 && <button className="mt-1 text-xs text-sky-200 hover:underline">Cambiar</button>}
          </form>
        )}
        {ctx.orgId && <BranchSelect action={switchBranch} campuses={ctx.campuses} current={ctx.campusId} fixed={ctx.campusFixed} />}
        <div className="mt-5 flex-1 lg:overflow-y-auto"><Nav items={items} /></div>
        <div className="mt-4 border-t border-white/10 px-2 pt-4 text-xs text-sky-100/70">
          <div className="flex items-center gap-2">
            {avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
              : <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 font-bold text-white">{(ctx.profile?.full_name || '?')[0]}</span>}
            <p className="truncate font-semibold text-white">{ctx.profile?.full_name || ctx.user.email}</p>
          </div>
          <p className="truncate">{ctx.org?.roles.join(', ') ?? (ctx.isPlatformAdmin ? 'Superadministrador' : 'Sin rol')}</p>
          <p className="mt-1">{ctx.aal === 'aal2' ? '🔒 Sesión con MFA' : 'Sesión estándar'}</p>
          <LogoutButton className="mt-2 text-sky-200 hover:underline" />
        </div>
        </MobileMenu>
      </aside>
      <main data-density={(ctx.profile?.preferences as { density?: string } | null)?.density === 'compacta' ? 'compacta' : undefined} className="app-main min-w-0 flex-1 px-3 pb-16 pt-4 lg:ml-64 lg:px-8 lg:pt-5">
        <PageTranslator locale={locale} />
        <WindowBar items={items} locale={locale} setLocale={setMyLocale} />
        <OfflineBar userId={ctx.user.id} warmUrls={items.map((i) => i.href)} />
        <VersionWatcher />
        {ctx.orgId && <UndoBar />}
        {!ctx.org && !ctx.isPlatformAdmin ? (
          <div className="card card-pad max-w-xl">
            <h1 className="text-xl font-bold">Cuenta sin institución asignada</h1>
            <p className="mt-2 text-sm text-slate-600">Su cuenta está activa, pero aún no tiene un rol en ninguna institución. Solicite acceso a la administración.</p>
          </div>
        ) : blocked ? (
          <div className="card card-pad max-w-xl" data-testid="modulo-no-disponible">
            <h1 className="text-xl font-bold">Módulo no disponible en esta plataforma</h1>
            <p className="mt-2 text-sm text-slate-600">{ctx.org?.display_name} usa la plataforma de <b>aula virtual</b>. Este módulo administrativo no forma parte de ella.</p>
            <a className="btn-primary mt-4 inline-block" href="/app/conferencias">🎥 Ir a las aulas virtuales</a>
          </div>
        ) : children}
      </main>
    </div>
    </ConferenceHost>
  );
}
