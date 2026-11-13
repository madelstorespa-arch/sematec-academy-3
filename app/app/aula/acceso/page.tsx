import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Stat } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { ISSUE, type AccessRow, type Issue } from '@/lib/aula-access';
import { fixAulaAccess, publishDraftQuiz } from './actions';

export const metadata = { title: 'Acceso de estudiantes al Aula' };

export default async function Page({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!can(ctx, 'students.view')) redirect('/app/aula');
  const sp = await searchParams;
  const ver = sp.ver === 'todos' ? 'todos' : 'problemas';
  const term = String(sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const canFix = can(ctx, 'students.edit') && can(ctx, 'enrollments.create');

  const [rep, quizzes, exts] = await Promise.all([
    ctx.supabase.rpc('aula_access_report', { p_org: orgId }),
    ctx.supabase.from('quizzes').select('id, title, section_id, opens_at, closes_at, sections(code, courses(name)), quiz_questions(count)').eq('organization_id', orgId).eq('published', false).order('opens_at').limit(100),
    ctx.supabase.from('external_evaluations').select('id, title, section_id, opens_at, closes_at, published, sections(code, courses(name))').eq('organization_id', orgId).gte('closes_at', new Date().toISOString()).order('opens_at').limit(100),
  ]);
  if (rep.error) {
    return (<><PageHeader title="Acceso de estudiantes al Aula" />
      <Card><p className="text-sm text-amber-800">⚠ Falta instalar la actualización de base de datos <b>«Aula acceso»</b>. Vaya a <Link className="link" href="/app/actualizar">Actualizar base de datos</Link> e instálela.</p></Card></>);
  }
  const rows = (rep.data ?? []) as AccessRow[];
  const counts = rows.reduce<Record<string, number>>((a, r) => { a[r.issue] = (a[r.issue] ?? 0) + 1; return a; }, {});
  const bad = rows.length - (counts.ok ?? 0);
  const fixable = (counts.cuenta_sin_vincular ?? 0) + (counts.sin_acceso ?? 0) + (counts.sin_cursos ?? 0);
  const list = rows.filter((r) => (ver === 'todos' || r.issue !== 'ok')
    && (!term || `${r.full_name} ${r.email ?? ''} ${r.student_code ?? ''} ${r.account_email ?? ''}`.toLowerCase().includes(term)));
  const now = new Date().toISOString();
  const closedExt = (exts.data ?? []).filter((x: any) => !x.published);
  const futureExt = (exts.data ?? []).filter((x: any) => x.published && x.opens_at > now);
  const course = (s: any) => `${s?.courses?.name ?? 'Curso'} · Sección ${s?.code ?? ''}`;

  return (
    <>
      <Link href="/app/aula" className="link text-sm">← Aula de aprendizaje</Link>
      <PageHeader title="🩺 Acceso de estudiantes al Aula" subtitle="Por qué un estudiante no ve sus cursos o evaluaciones, y cómo repararlo" />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Estudiantes activos" value={rows.length} />
        <Stat label="Ven sus cursos" value={counts.ok ?? 0} />
        <Stat label="Con problemas" value={bad} hint={bad ? 'Revise la lista' : 'Todo en orden'} />
        <Stat label="Reparables con un clic" value={fixable} />
      </div>

      {canFix && bad > 0 && (
        <Card className="mb-6" title="Reparar automáticamente">
          <p className="mb-3 text-sm text-slate-600">Vincula las cuentas con el mismo correo, activa el acceso de estudiante y, a quien está matriculado sin cursos, lo inscribe en las asignaturas de su nivel que tengan sección abierta en su periodo (respeta cupos y prerrequisitos). No toca a quien ya tiene cursos.</p>
          <ActionForm action={fixAulaAccess} submitLabel="🩺 Reparar todo" confirm="¿Reparar el acceso al Aula de todos los estudiantes con problemas?" />
        </Card>)}

      <Card className="mb-6" title="Qué significa cada problema">
        <ul className="space-y-1 text-sm">{(Object.keys(ISSUE) as Issue[]).filter((k) => k !== 'ok').map((k) => (
          <li key={k}><Badge color={ISSUE[k].color}>{ISSUE[k].label}</Badge> <span className="text-slate-600">{ISSUE[k].why}</span>{counts[k] ? <b> · {counts[k]}</b> : null}</li>))}</ul>
      </Card>

      <Card className="mb-6" title={ver === 'todos' ? 'Todos los estudiantes' : 'Estudiantes que no ven sus cursos'}
        actions={<div className="flex gap-2 text-sm"><Link className={ver === 'problemas' ? 'font-bold' : 'link'} href="/app/aula/acceso">Con problemas</Link><span>·</span><Link className={ver === 'todos' ? 'font-bold' : 'link'} href="/app/aula/acceso?ver=todos">Todos</Link></div>}>
        <form className="mb-3 flex gap-2"><input type="hidden" name="ver" value={ver} /><input name="q" defaultValue={term} className="input max-w-xs" placeholder="Buscar nombre, correo o código" /><button className="btn-secondary">Buscar</button></form>
        {list.length ? (
          <div className="overflow-x-auto"><table className="table" data-testid="tabla-acceso"><thead><tr><th>Estudiante</th><th>Cuenta para entrar</th><th>Estado</th><th>Matrículas</th><th>Cursos</th><th>Qué hacer</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.student_id} data-testid="fila-acceso">
                <td><Link className="link" href={`/app/estudiantes/${r.student_id}`}>{r.full_name}</Link><div className="text-xs text-slate-500">{r.email ?? 'sin correo'}{r.student_code ? ` · ${r.student_code}` : ''}</div>{r.programa && <div className="text-xs text-slate-500">Eligió: {r.programa}</div>}</td>
                <td className="text-sm">{r.account_email ?? <span className="text-slate-400">—</span>}</td>
                <td><Badge color={ISSUE[r.issue].color}>{ISSUE[r.issue].label}</Badge></td>
                <td>{r.matriculas}</td><td>{r.secciones}</td>
                <td className="text-sm">
                  {r.issue === 'sin_cuenta' && <Link className="btn-secondary btn-sm" href={`/app/estudiantes/${r.student_id}`}>🔑 Crear contraseña</Link>}
                  {r.issue === 'cuenta_suspendida' && <Link className="btn-secondary btn-sm" href="/app/usuarios">Reactivar en Usuarios</Link>}
                  {r.issue === 'sin_matricula' && can(ctx, 'enrollments.create') && <Link className="btn-secondary btn-sm" href={`/app/matriculas?estudiante=${r.student_id}`}>🗂 Matricular</Link>}
                  {canFix && ['cuenta_sin_vincular', 'sin_acceso', 'sin_cursos'].includes(r.issue) && (
                    <ActionForm action={fixAulaAccess} inline submitLabel={r.issue === 'sin_cursos' ? '📚 Inscribir en sus asignaturas' : r.issue === 'sin_acceso' ? '✅ Dar acceso' : '🔗 Vincular cuenta'} submitClass="btn-primary btn-sm">
                      <input type="hidden" name="student_id" value={r.student_id} /></ActionForm>)}
                  {r.issue === 'ok' && <span className="text-xs text-emerald-700">✓</span>}
                </td>
              </tr>))}</tbody></table></div>
        ) : <Empty>{ver === 'todos' ? 'No hay estudiantes.' : '✓ Todos los estudiantes activos ven sus cursos.'}</Empty>}
      </Card>

      <Card title="Evaluaciones que los estudiantes todavía no ven">
        {(quizzes.data?.length || closedExt.length || futureExt.length) ? (
          <ul className="space-y-2 text-sm" data-testid="evaluaciones-ocultas">
            {(quizzes.data ?? []).map((q: any) => {
              const n = q.quiz_questions?.[0]?.count ?? 0;
              return (<li key={q.id} className="flex flex-wrap items-center gap-2">
                <Badge color="amber">Examen en borrador</Badge> <b>{q.title}</b> <span className="text-slate-500">{course(q.sections)} · {n} pregunta(s)</span>
                <Link className="link" href={`/app/aula/${q.section_id}/examen/${q.id}`}>Ver preguntas</Link>
                {n > 0 && <ActionForm action={publishDraftQuiz} inline submitLabel="📢 Publicar" submitClass="btn-primary btn-sm"><input type="hidden" name="id" value={q.id} /></ActionForm>}
              </li>);
            })}
            {closedExt.map((x: any) => <li key={x.id}><Badge color="amber">Evaluación oculta</Badge> <b>{x.title}</b> <span className="text-slate-500">{course(x.sections)}</span> <Link className="link" href={`/app/aula/${x.section_id}?t=examenes`}>Abrir curso</Link></li>)}
            {futureExt.map((x: any) => <li key={x.id}><Badge color="blue">Aún no abre</Badge> <b>{x.title}</b> <span className="text-slate-500">{course(x.sections)} · abre el {fmtDateTime(x.opens_at)}</span></li>)}
          </ul>
        ) : <Empty>✓ No hay exámenes en borrador ni evaluaciones ocultas.</Empty>}
        <p className="mt-3 text-xs text-slate-500">Un estudiante solo ve las evaluaciones de los cursos (secciones) en que está inscrito, y los exámenes de la plataforma solo cuando están publicados. El botón «Entrar» funciona entre la hora de apertura y la de cierre.</p>
      </Card>
    </>
  );
}
