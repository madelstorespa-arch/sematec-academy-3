import Link from 'next/link';
import { getContext, can } from '@/lib/context';
import { PageHeader, Stat, Card, Empty } from '@/components/ui';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { mailEnabled } from '@/lib/mailer';

export default async function Dashboard() {
  const ctx = await getContext();
  const { supabase, orgId } = ctx;
  const count = async (table: string, filter?: (q: any) => any) => {
    let q: any = supabase.from(table).select('*', { count: 'exact', head: true });
    if (orgId) q = q.eq('organization_id', orgId);
    if (filter) q = filter(q);
    const { count } = await q;
    return count ?? 0;
  };
  const stats: { label: string; value: string | number; href: string; hint?: string }[] = [];
  if (orgId && can(ctx, 'students.view')) stats.push({ label: 'Estudiantes activos', value: await count('students', (q) => q.eq('status', 'active')), href: '/app/estudiantes' });
  if (orgId && can(ctx, 'teachers.view')) stats.push({ label: 'Profesores', value: await count('teachers'), href: '/app/profesores' });
  if (orgId && can(ctx, 'enrollments.view')) stats.push({ label: 'Matrículas activas', value: await count('enrollments', (q) => q.eq('status', 'active')), href: '/app/matriculas' });
  if (orgId && can(ctx, 'academic.view')) stats.push({ label: 'Secciones', value: await count('sections', (q) => q.eq('status', 'active')), href: '/app/secciones' });
  if (orgId && can(ctx, 'finance.view')) {
    const { data } = await supabase.from('account_balances').select('currency, overdue').eq('organization_id', orgId);
    const overdue = (data ?? []).reduce((a: number, r: any) => a + Number(r.overdue ?? 0), 0);
    stats.push({ label: 'Deuda vencida', value: fmtMoney(overdue, data?.[0]?.currency ?? 'CLP'), href: '/app/finanzas', hint: `${(data ?? []).filter((r: any) => Number(r.overdue) > 0).length} cuentas con morosidad` });
  }
  if (orgId && can(ctx, 'certificates.view')) stats.push({ label: 'Certificados emitidos', value: await count('certificates', (q) => q.eq('status', 'issued')), href: '/app/certificados' });

  const { data: sessions } = orgId
    ? await supabase.from('conference_sessions').select('id, title, scheduled_start, status, timezone')
        .eq('organization_id', orgId).in('status', ['scheduled', 'live']).gte('scheduled_end', new Date().toISOString())
        .order('scheduled_start').limit(5)
    : { data: [] as any[] };

  return (
    <>
      {(ctx.isOwner || ctx.isPlatformAdmin) && !mailEnabled() && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="aviso-correo">
          <span className="text-2xl" aria-hidden>📧</span>
          <span className="min-w-0 flex-1"><b>Los correos todavía no salen de la plataforma.</b> Recuperar contraseña, avisos de inscripción y copias por correo necesitan el correo configurado (Gmail con contraseña de aplicación).</span>
          <Link href="/app/configuracion?t=institucion#correo" className="btn-primary btn-sm">Configurar y probar el correo</Link>
        </div>)}
      <section className="relative mb-7 overflow-hidden rounded-3xl bg-gradient-to-br from-ink via-brand-700 to-brand-600 p-6 text-white shadow-xl md:p-8" data-testid="portada-panel">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold capitalize text-sky-200">{new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' })}</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">{`Hola, ${ctx.profile?.full_name?.split(' ')[0] || 'bienvenido'}`}</h1>
            <p className="mt-1 text-sky-100/85">{ctx.org?.display_name ?? 'Administración de la plataforma'}</p>
          </div>
          <Link href="/app/mapa" className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25" data-testid="atajo-mapa">🗺 Mapa de la plataforma</Link>
          {ctx.orgId && <Link href="/app/configuracion#tarjetas" className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25" data-testid="atajo-colores">🎨 Colores de tarjetas</Link>}
        </div>
        {ctx.orgId && (
          <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([
              can(ctx, 'students.create') && ['/app/inscripciones', '📝', 'Inscribir'],
              can(ctx, 'enrollments.create') && ['/app/matriculas', '🗂', 'Matricular'],
              (ctx.teacherId || ctx.studentId || can(ctx, 'sections.view')) && ['/app/aula', '📚', 'Aula'],
              (can(ctx, 'conferences.view') || ctx.teacherId || ctx.studentId) && ['/app/conferencias', '🎥', 'Clases en vivo'],
              ['/app/oficina', '💼', 'Oficina'],
              can(ctx, 'finance.view') && ['/app/finanzas', '💳', 'Finanzas'],
              ctx.studentId && ['/app/mi', '🎓', 'Mi portal'],
              ['/app/archivos', '📁', 'Mis archivos'],
            ].filter(Boolean) as [string, string, string][]).slice(0, 6).map(([href, icon, label]) => (
              <Link key={href} href={href} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 font-semibold backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/20">
                <span className="text-2xl" aria-hidden>{icon}</span>{label}</Link>))}
          </div>)}
      </section>
      {ctx.isPlatformAdmin && !ctx.org && (
        <Card title="🌎 Plataformas para otras organizaciones"><p className="text-sm">Cree aulas virtuales separadas para institutos, asociaciones u organizaciones, o apruebe las que se registran, en <Link className="link" href="/app/instituciones" data-testid="plataformas-aula">Plataformas y organizaciones</Link>.</p></Card>
      )}
      {stats.length > 0 && <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">{stats.map((s) => <Stat key={s.label} {...s} />)}</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Próximas clases y conferencias">
          {sessions && sessions.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {sessions.map((s: any) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span><span className="font-semibold">{s.title}</span><br /><span className="text-slate-500">{fmtDateTime(s.scheduled_start, s.timezone)}</span></span>
                  <Link className="btn-secondary btn-sm" href={`/app/conferencias/sala/${s.id}`}>{s.status === 'live' ? 'Entrar (en vivo)' : 'Entrar'}</Link>
                </li>
              ))}
            </ul>
          ) : <Empty>No hay sesiones programadas.</Empty>}
        </Card>
        <Card title="Accesos rápidos">
          <div className="flex flex-wrap gap-2">
            {ctx.studentId && <Link className="btn-secondary" href="/app/mi">Mi portal</Link>}
            {ctx.isGuardian && <Link className="btn-secondary" href="/app/apoderado">👪 Mis pupilos</Link>}
            {ctx.studentId && <Link className="btn-secondary" href="/app/credencial">🪪 Mi credencial</Link>}
            {ctx.teacherId && <Link className="btn-secondary" href="/app/docencia">Mis secciones</Link>}
            {can(ctx, 'students.create') && <Link className="btn-secondary" href="/app/estudiantes?nuevo=1">Registrar estudiante</Link>}
            {can(ctx, 'enrollments.create') && <Link className="btn-secondary" href="/app/matriculas">Matricular</Link>}
            {can(ctx, 'finance.create') && <Link className="btn-secondary" href="/app/finanzas/pagos">Registrar pago</Link>}
            {can(ctx, 'certificates.create') && <Link className="btn-secondary" href="/app/certificados">Emitir certificado</Link>}
            <Link className="btn-secondary" href="/app/perfil">Mi cuenta</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
