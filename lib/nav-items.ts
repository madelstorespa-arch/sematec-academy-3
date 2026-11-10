import 'server-only';
import { can, type Ctx } from '@/lib/context';
import type { NavItem } from '@/components/nav';
import { tNav } from '@/lib/i18n';
import { prefsOf } from '@/lib/prefs';

/** Opciones que nunca se pueden ocultar (para no quedar sin acceso). */
export const LOCKED = new Set(['/app', '/app/perfil', '/app/modulos']);
export type MenuCustom = { hidden?: string[]; labels?: Record<string, string> };

/** Menú completo según los permisos de la persona (sin personalizar). */
export function baseNav(ctx: Ctx): NavItem[] {
  const items: NavItem[] = [{ href: '/app', label: 'Inicio', icon: '⌂' }];
  if (ctx.studentId) items.push({ href: '/app/mi', label: 'Mi portal', icon: '🎓' });
  if (ctx.isGuardian) items.push({ href: '/app/apoderado', label: 'Mis pupilos', icon: '👪' });
  if (ctx.studentId) items.push({ href: '/app/credencial', label: 'Mi credencial', icon: '🪪' });
  if (ctx.studentId || ctx.isGuardian) items.push({ href: '/app/boletas', label: 'Mis boletas', icon: '🧾' });
  if (ctx.teacherId) items.push({ href: '/app/docencia', label: 'Mis secciones', icon: '📚' });
  if (can(ctx, 'students.view')) items.push({ href: '/app/estudiantes', label: 'Estudiantes', icon: '👥' });
  if (can(ctx, 'teachers.view')) items.push({ href: '/app/profesores', label: 'Profesores', icon: '🧑‍🏫' });
  if (can(ctx, 'academic.view')) items.push({ href: '/app/academico', label: 'Carreras y asignaturas', icon: '🏛' });
  if (can(ctx, 'sections.view') || can(ctx, 'grades.view')) items.push({ href: '/app/secciones', label: 'Secciones y notas', icon: '📝' });
  if (can(ctx, 'enrollments.view')) items.push({ href: '/app/matriculas', label: 'Matrículas', icon: '🗂' });
  if (can(ctx, 'finance.view')) items.push({ href: '/app/finanzas', label: 'Finanzas', icon: '💳' });
  if (can(ctx, 'store.view') || can(ctx, 'store.create')) items.push({ href: '/app/tienda', label: 'SEMATEC VENTA', icon: '🛒' });
  if (ctx.orgId && ctx.campuses.length > 0 && (ctx.isOwner || can(ctx, 'reports.view') || can(ctx, 'store.edit') || can(ctx, 'finance.view'))) items.push({ href: '/app/sucursales', label: 'Sucursales', icon: '🏢' });
  if (can(ctx, 'certificates.view')) items.push({ href: '/app/certificados', label: 'Certificados', icon: '🏅' });
  if (ctx.teacherId || ctx.studentId || can(ctx, 'sections.view')) items.push({ href: '/app/aula', label: 'Aula de aprendizaje', icon: '📚' });
  if (can(ctx, 'conferences.view') || ctx.teacherId || ctx.studentId) items.push({ href: '/app/conferencias', label: 'Aulas virtuales', icon: '🎥' });
  if (ctx.orgId) items.push(
    { href: '/app/anuncios', label: 'Anuncios', icon: '📢' },
    { href: '/app/mensajes', label: 'Mensajes', icon: '✉' },
    { href: '/app/biblioteca', label: 'Biblioteca', icon: '📖' },
    { href: '/app/soporte', label: 'Soporte técnico', icon: '🛟' },
  );
  if (ctx.studentId || can(ctx, 'students.view')) items.push({ href: '/app/punto-estudiantil', label: 'Punto estudiantil', icon: '🎒' });
  if (ctx.orgId) items.push({ href: '/app/oficinas', label: 'Oficinas y citas', icon: '🏢' });
  if (ctx.orgId) items.push({ href: '/app/encuestas', label: 'Encuestas', icon: '🗳' });
  if (ctx.studentId || can(ctx, 'alumni.view')) items.push({ href: '/app/egresados', label: 'Egresados', icon: '🎓' });
  if (ctx.studentId || can(ctx, 'alumni.view')) items.push({ href: '/app/empleos', label: 'Bolsa de empleo', icon: '💼' });
  if (ctx.orgId) items.push({ href: '/app/calendario', label: 'Calendario', icon: '📅' });
  if (ctx.orgId) items.push({ href: '/app/archivos', label: 'Archivos', icon: '📁' });
  if (ctx.orgId) items.push({ href: '/app/traducir', label: 'Traductor', icon: '🌐' });
  if (ctx.orgId && (ctx.studentId || ctx.teacherId || ctx.isOwner || can(ctx, 'grades.view') || can(ctx, 'reports.view'))) items.push({ href: '/app/calificaciones', label: 'Calificaciones', icon: '📝' });
  if (ctx.orgId && (ctx.studentId || ctx.teacherId || ctx.isOwner || can(ctx, 'attendance.view') || can(ctx, 'reports.view'))) items.push({ href: '/app/asistencia', label: 'Asistencia', icon: '✅' });
  if (ctx.teacherId || can(ctx, 'facilities.view')) items.push({ href: '/app/reservas', label: 'Salas y recursos', icon: '🏫' });
  if (can(ctx, 'employees.view') || ctx.isEmployee) items.push({ href: '/app/personal', label: 'Personal y RR. HH.', icon: '🧾' });
  if (can(ctx, 'inventory.view')) items.push({ href: '/app/inventario', label: 'Inventario', icon: '📦' });
  if (can(ctx, 'reports.view')) items.push({ href: '/app/reportes', label: 'Reportes', icon: '📊' });
  if (can(ctx, 'users.view')) items.push({ href: '/app/usuarios', label: 'Usuarios y roles', icon: '🔐' });
  if (ctx.orgId) items.push({ href: '/app/configuracion', label: 'Configuración', icon: '⚙' });
  if (can(ctx, 'security.admin') || can(ctx, 'audit.view') || ctx.isPlatformAdmin) items.push({ href: '/app/ciberseguridad', label: 'Centro de Ciberseguridad', icon: '🛡' });
  if (can(ctx, 'audit.view')) items.push({ href: '/app/auditoria', label: 'Auditoría', icon: '📜' });
  if (ctx.isOwner && ctx.orgId) items.push({ href: '/app/papelera', label: 'Papelera', icon: '🗑' });
  if (ctx.isPlatformAdmin) items.push({ href: '/app/actualizar', label: 'Actualizar sistema', icon: '⬆' });
  if (ctx.isPlatformAdmin) items.push({ href: '/app/instituciones', label: 'Instituciones', icon: '🌎' });
  if (can(ctx, 'settings.admin')) items.push({ href: '/app/sitio', label: 'Sitio web y marca', icon: '🌐' });
  if (can(ctx, 'admissions.view')) items.push({ href: '/app/admision', label: 'Admisión web', icon: '📨' });
  items.push({ href: '/app/perfil', label: 'Mi cuenta', icon: '👤' });
  if (ctx.isOwner && ctx.orgId) items.splice(items.length - 1, 0, { href: '/app/modulos', label: 'Módulos y menú', icon: '🧩' });
  return items;
}

/** Menú final: el de los permisos + módulos creados sin código, con los nombres y ocultos que definió el propietario. */
export async function buildNav(ctx: Ctx): Promise<NavItem[]> {
  const items = baseNav(ctx);
  if (!ctx.orgId) return items;
  const [{ data: mods }, { data: menu }] = await Promise.all([
    ctx.supabase.rpc('my_custom_modules', { p_org: ctx.orgId }),
    ctx.supabase.from('organization_settings').select('value').eq('organization_id', ctx.orgId).eq('key', 'menu.custom').maybeSingle(),
  ]);
  const extra = ((mods ?? []) as { slug: string; name: string; icon: string }[]).map((m) => ({ href: `/app/m/${m.slug}`, label: m.name, icon: m.icon || '🧩' }));
  items.splice(items.length - 1, 0, ...extra);
  const c = (menu?.value ?? {}) as MenuCustom;
  const hidden = new Set(c.hidden ?? []);
  // 🔑 Aviso en el menú cuando hay personas pidiendo ayuda para recuperar su contraseña
  if (ctx.isOwner || can(ctx, 'security.admin') || can(ctx, 'users.admin')) {
    const { count } = await ctx.supabase.from('password_help_requests').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.orgId).eq('status', 'pendiente');
    const u = items.find((i) => i.href === '/app/usuarios');
    if (u && count) u.label = `${u.label} · 🔑 ${count}`;
  }
  const loc = prefsOf(ctx.profile).locale;
  return items.filter((i) => LOCKED.has(i.href) || !hidden.has(i.href)).map((i) => (c.labels?.[i.href] ? { ...i, label: c.labels[i.href] } : { ...i, label: tNav(loc, i.label) }));
}
