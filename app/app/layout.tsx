import { redirect } from 'next/navigation';
import { getContext, can } from '@/lib/context';
import { SiteLogo } from '@/components/site-chrome';
import { brandStyle } from '@/lib/site';
import { Nav, type NavItem } from '@/components/nav';
import { switchOrg } from './actions';
import { MobileMenu } from '@/components/mobile-menu';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (ctx.needsMfa) redirect('/mfa');
  if (ctx.profile && ctx.profile.status !== 'active') redirect('/login');

  const items: NavItem[] = [{ href: '/app', label: 'Inicio', icon: '⌂' }];
  if (ctx.studentId) items.push({ href: '/app/mi', label: 'Mi portal', icon: '🎓' });
  if (ctx.teacherId) items.push({ href: '/app/docencia', label: 'Mis secciones', icon: '📚' });
  if (can(ctx, 'students.view')) items.push({ href: '/app/estudiantes', label: 'Estudiantes', icon: '👥' });
  if (can(ctx, 'teachers.view')) items.push({ href: '/app/profesores', label: 'Profesores', icon: '🧑‍🏫' });
  if (can(ctx, 'academic.view')) items.push({ href: '/app/academico', label: 'Oferta académica', icon: '🏛' });
  if (can(ctx, 'sections.view') || can(ctx, 'grades.view')) items.push({ href: '/app/secciones', label: 'Secciones y notas', icon: '📝' });
  if (can(ctx, 'enrollments.view')) items.push({ href: '/app/matriculas', label: 'Matrículas', icon: '🗂' });
  if (can(ctx, 'finance.view')) items.push({ href: '/app/finanzas', label: 'Finanzas', icon: '💳' });
  if (can(ctx, 'certificates.view')) items.push({ href: '/app/certificados', label: 'Certificados', icon: '🏅' });
  if (can(ctx, 'conferences.view') || ctx.teacherId || ctx.studentId) items.push({ href: '/app/conferencias', label: 'Aulas virtuales', icon: '🎥' });
  if (ctx.orgId) items.push(
    { href: '/app/anuncios', label: 'Anuncios', icon: '📢' },
    { href: '/app/mensajes', label: 'Mensajes', icon: '✉' },
    { href: '/app/biblioteca', label: 'Biblioteca', icon: '📖' },
    { href: '/app/soporte', label: 'Soporte técnico', icon: '🛟' },
  );
  if (can(ctx, 'reports.view')) items.push({ href: '/app/reportes', label: 'Reportes', icon: '📊' });
  if (can(ctx, 'users.view')) items.push({ href: '/app/usuarios', label: 'Usuarios y roles', icon: '🔐' });
  if (can(ctx, 'organization.admin') || can(ctx, 'settings.admin')) items.push({ href: '/app/configuracion', label: 'Configuración', icon: '⚙' });
  if (can(ctx, 'audit.view')) items.push({ href: '/app/auditoria', label: 'Auditoría', icon: '🛡' });
  if (ctx.isPlatformAdmin) items.push({ href: '/app/instituciones', label: 'Instituciones', icon: '🌎' });
  if (can(ctx, 'settings.admin')) items.push({ href: '/app/sitio', label: 'Sitio web y marca', icon: '🌐' });
  if (can(ctx, 'admissions.view')) items.push({ href: '/app/admision', label: 'Admisión web', icon: '📨' });
  items.push({ href: '/app/perfil', label: 'Mi cuenta', icon: '👤' });
  const { data: site } = ctx.orgId
    ? await ctx.supabase.from('site_settings').select('site_name, tagline, logo_asset_id, primary_color, accent_color').eq('organization_id', ctx.orgId).maybeSingle()
    : { data: null };
  const avatar = ctx.profile?.avatar_asset_id ? `/media/${ctx.profile.avatar_asset_id}` : null;

  return (
    <div className="lg:flex" style={brandStyle(site?.primary_color, site?.accent_color)}>
      <aside className="sticky top-0 z-30 flex max-h-screen flex-col overflow-y-auto bg-ink px-4 py-3 lg:fixed lg:inset-y-0 lg:w-64 lg:py-5">
        <MobileMenu header={<div className="px-2"><SiteLogo site={site} light /></div>}>
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
          <form action="/auth/salir" method="post"><button className="mt-2 text-sky-200 hover:underline">Cerrar sesión</button></form>
        </div>
        </MobileMenu>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 lg:ml-64 lg:px-10 lg:py-8">
        {!ctx.org && !ctx.isPlatformAdmin ? (
          <div className="card card-pad max-w-xl">
            <h1 className="text-xl font-bold">Cuenta sin institución asignada</h1>
            <p className="mt-2 text-sm text-slate-600">Su cuenta está activa, pero aún no tiene un rol en ninguna institución. Solicite acceso a la administración.</p>
          </div>
        ) : children}
      </main>
    </div>
  );
}
