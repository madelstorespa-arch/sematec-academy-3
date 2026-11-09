import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Stat, Tabs } from '@/components/ui';
import { fmtNum } from '@/lib/format';
import { aggregate, gradesReport } from './data';

export const dynamic = 'force-dynamic';

type G = { section_id: string; course_code: string; course_name: string; credits: number | null; period_code: string; section_code: string;
  assessment: string | null; weight_pct: number | null; grade: number | null; due_on: string | null; average: number | null;
  final_grade: number | null; result: string; passing_grade: number };

const n = (v: number | null | undefined, d = 1) => (v == null ? '—' : fmtNum(v, d));
const RES: Record<string, [string, 'green' | 'red' | 'gray' | 'amber']> = {
  approved: ['Aprobada', 'green'], failed: ['Reprobada', 'red'], in_progress: ['En curso', 'gray'], withdrawn: ['Retirada', 'amber'],
};

export default async function CalificacionesPage({ searchParams }: { searchParams: Promise<{ t?: string; periodo?: string; seccion?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const staff = ctx.isOwner || can(ctx, 'grades.view') || can(ctx, 'reports.view') || !!ctx.teacherId;

  // ---------------- Estudiante: mis notas y promedios ----------------
  if (!staff) {
    const { data } = await ctx.supabase.rpc('my_grades');
    const rows = (data ?? []) as G[];
    const courses = new Map<string, G[]>();
    for (const r of rows) courses.set(r.section_id, [...(courses.get(r.section_id) ?? []), r]);
    const list = [...courses.values()].map((rs) => ({ ...rs[0], items: rs.filter((r) => r.assessment), grade: rs[0].final_grade ?? rs[0].average }));
    const graded = list.filter((c) => c.grade != null);
    const w = graded.reduce((a, c) => a + Number(c.credits || 1), 0);
    const gpa = w ? graded.reduce((a, c) => a + Number(c.grade) * Number(c.credits || 1), 0) / w : null;
    return (
      <div>
        <PageHeader title="📝 Mis calificaciones" subtitle="Notas de cada evaluación publicada, promedio por asignatura y promedio general." />
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Promedio general" value={<span data-testid="promedio-general">{n(gpa, 2)}</span>} hint="Ponderado por créditos" />
          <Stat label="Asignaturas" value={list.length} />
          <Stat label="Bajo la nota de aprobación" value={graded.filter((c) => Number(c.grade) < Number(c.passing_grade)).length} />
        </div>
        {list.length ? <div className="grid gap-4 lg:grid-cols-2">{list.map((c) => (
          <Card key={c.section_id} title={`${c.course_code} · ${c.course_name} (${c.period_code})`}
            actions={<Badge color={RES[c.result]?.[1]}>{RES[c.result]?.[0] ?? c.result}</Badge>}>
            {c.items.length ? <table className="table"><thead><tr><th>Evaluación</th><th>Ponderación</th><th>Nota</th></tr></thead>
              <tbody>{c.items.map((i, k) => <tr key={k}><td>{i.assessment}</td><td>{n(i.weight_pct, 0)} %</td>
                <td className={i.grade != null && Number(i.grade) < Number(c.passing_grade) ? 'font-semibold text-red-700' : 'font-semibold'}>{n(i.grade)}</td></tr>)}</tbody></table>
              : <Empty>Aún no hay evaluaciones publicadas.</Empty>}
            <p className="mt-3 text-sm">Promedio: <b className={c.grade != null && Number(c.grade) < Number(c.passing_grade) ? 'text-red-700' : 'text-emerald-700'}>{n(c.grade, 2)}</b>
              {c.final_grade != null && ' (nota final del acta)'} · aprueba con {n(c.passing_grade)}</p>
          </Card>))}</div> : <Empty>No tiene asignaturas inscritas.</Empty>}
      </div>
    );
  }

  // ---------------- Profesores y administración ----------------
  const t = sp.t ?? 'estudiantes';
  const { rows, error } = await gradesReport(ctx, sp);
  const a = aggregate(rows);
  const { data: periods } = await ctx.supabase.from('academic_periods').select('id, code, name').eq('organization_id', orgId).order('starts_on', { ascending: false });
  const q = new URLSearchParams(Object.entries({ periodo: sp.periodo ?? '', seccion: sp.seccion ?? '' }).filter(([, v]) => v)).toString();
  const tabs = [['estudiantes', 'Por estudiante'], ['asignaturas', 'Por asignatura'], ['carreras', 'Por carrera'], ['riesgo', '⚠ En riesgo'], ['detalle', 'Detalle']]
    .map(([key, label]) => ({ key, label, href: `/app/calificaciones?t=${key}${q ? `&${q}` : ''}` }));
  const all = rows.filter((r) => r.grade != null).map((r) => Number(r.grade));
  const exportTipo = t === 'asignaturas' ? 'asignaturas' : t === 'estudiantes' ? 'estudiantes' : 'detalle';

  return (
    <div>
      <PageHeader title="📝 Calificaciones" subtitle="Promedios por estudiante, asignatura y carrera; estudiantes en riesgo y descarga a Excel." />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Promedio de la institución" value={<span data-testid="promedio-institucion">{all.length ? fmtNum(all.reduce((x, y) => x + y, 0) / all.length, 2) : '—'}</span>} />
        <Stat label="Estudiantes" value={a.students.length} />
        <Stat label="Asignaturas / secciones" value={a.sections.length} />
        <Stat label="Notas en riesgo" value={rows.filter((r) => r.at_risk).length} hint="Bajo la nota de aprobación" />
      </div>
      <Tabs items={tabs} current={t} />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="t" value={t} />
        <label className="block"><span className="label">Periodo</span>
          <select name="periodo" defaultValue={sp.periodo ?? ''} className="input"><option value="">Todos</option>
            {(periods ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <button className="btn-secondary">Ver</button>
        <a className="btn-secondary" href={`/app/calificaciones/exportar?tipo=${exportTipo}${q ? `&${q}` : ''}`} data-testid="exportar-notas">⬇ Descargar Excel</a>
      </form>
      <Card>
        {error ? <p className="text-sm text-red-700">{error.message}</p> : !rows.length ? <Empty>No hay estudiantes inscritos en secciones.</Empty> : t === 'estudiantes' ? (
          <div className="overflow-x-auto"><table className="table" data-testid="tabla-notas">
            <thead><tr><th>#</th><th>Estudiante</th><th>Carrera</th><th>Asignaturas</th><th>Promedio general</th><th>En riesgo</th></tr></thead>
            <tbody>{a.students.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.name} <span className="text-xs text-slate-500">{s.code}</span></td><td className="text-xs">{s.program}</td>
              <td>{s.graded} / {s.courses}</td><td><b className={s.gpa != null && s.gpa < s.passing ? 'text-red-700' : 'text-emerald-700'}>{n(s.gpa, 2)}</b></td>
              <td>{s.failing ? <Badge color="red">{s.failing}</Badge> : '—'}</td></tr>)}</tbody></table></div>
        ) : t === 'asignaturas' ? (
          <div className="overflow-x-auto"><table className="table" data-testid="tabla-notas">
            <thead><tr><th>Asignatura</th><th>Periodo</th><th>Estudiantes</th><th>Promedio</th><th>Aprobando</th><th>En riesgo</th></tr></thead>
            <tbody>{a.sections.map((s) => <tr key={s.id}><td><Link className="link" href={`/app/secciones/${s.id}?t=notas`}>{s.label}</Link></td><td>{s.period}</td><td>{s.students}</td>
              <td><b>{n(s.avg, 2)}</b></td><td>{s.graded ? `${Math.round((100 * s.approved) / s.graded)} %` : '—'}</td><td>{s.risk ? <Badge color="red">{s.risk}</Badge> : '—'}</td></tr>)}</tbody></table></div>
        ) : t === 'carreras' ? (
          <div className="overflow-x-auto"><table className="table" data-testid="tabla-notas">
            <thead><tr><th>Carrera</th><th>Estudiantes</th><th>Promedio</th><th>Notas en riesgo</th></tr></thead>
            <tbody>{a.programs.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.students}</td><td><b>{n(p.avg, 2)}</b></td><td>{p.risk || '—'}</td></tr>)}</tbody></table></div>
        ) : (
          <div className="overflow-x-auto"><table className="table" data-testid="tabla-notas">
            <thead><tr><th>Asignatura</th><th>Estudiante</th><th>Evaluado</th><th>Promedio</th><th>Final</th><th>Estado</th></tr></thead>
            <tbody>{(t === 'riesgo' ? rows.filter((r) => r.at_risk) : rows).map((r) => (
              <tr key={`${r.section_id}-${r.student_id}`} className={r.at_risk ? 'bg-red-50' : ''}>
                <td className="text-xs"><Link className="link" href={`/app/secciones/${r.section_id}?t=notas`}>{r.section_label}</Link></td>
                <td>{r.student_name}</td><td>{n(r.graded_weight, 0)} %</td><td>{n(r.average, 2)}</td><td>{n(r.final_grade, 2)}</td>
                <td>{r.at_risk ? <Badge color="red">En riesgo</Badge> : r.grade != null ? <Badge color="green">Aprobando</Badge> : <Badge>Sin notas</Badge>}</td></tr>))}</tbody></table></div>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">El promedio parcial pondera solo las evaluaciones ya calificadas. Al cerrar el acta se usa la nota final. El promedio general pondera cada asignatura por sus créditos. Las notas se ingresan en cada sección → «Evaluaciones y notas».</p>
    </div>
  );
}
