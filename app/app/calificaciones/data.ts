import 'server-only';
import type { getContext } from '@/lib/context';

type Ctx = Awaited<ReturnType<typeof getContext>>;
export type Row = { section_id: string; section_label: string; course_credits: number | null; period_code: string; program_name: string | null;
  student_id: string; student_name: string; student_code: string; graded_weight: number; average: number | null; final_grade: number | null;
  result: string; passing_grade: number; min_grade: number; max_grade: number; at_risk: boolean };

const u = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
export async function gradesReport(ctx: Ctx, f: { periodo?: string; seccion?: string }) {
  const { data, error } = await ctx.supabase.rpc('grades_report', { p_org: ctx.orgId, p_period: u(f.periodo), p_section: u(f.seccion) });
  return { rows: ((data ?? []) as Row[]).map((r) => ({ ...r, grade: r.final_grade ?? r.average })), error };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Promedio por estudiante (ponderado por créditos), por sección y por carrera. */
export function aggregate(rows: (Row & { grade: number | null })[]) {
  const by = <K extends string>(key: (r: Row) => K) => {
    const m = new Map<K, (Row & { grade: number | null })[]>();
    for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const students = [...by((r) => r.student_id)].map(([, rs]) => {
    const graded = rs.filter((r) => r.grade != null);
    const w = graded.reduce((a, r) => a + Number(r.course_credits || 1), 0);
    const gpa = w ? graded.reduce((a, r) => a + Number(r.grade) * Number(r.course_credits || 1), 0) / w : null;
    return { id: rs[0].student_id, name: rs[0].student_name, code: rs[0].student_code, program: rs.find((r) => r.program_name)?.program_name ?? '—',
      courses: rs.length, graded: graded.length, gpa, failing: rs.filter((r) => r.at_risk).length, passing: Number(rs[0].passing_grade) };
  }).sort((a, b) => (b.gpa ?? -1) - (a.gpa ?? -1));
  const sections = [...by((r) => r.section_id)].map(([, rs]) => {
    const g = rs.filter((r) => r.grade != null).map((r) => Number(r.grade));
    return { id: rs[0].section_id, label: rs[0].section_label, period: rs[0].period_code, students: rs.length, avg: avg(g),
      approved: rs.filter((r) => r.grade != null && !r.at_risk).length, risk: rs.filter((r) => r.at_risk).length, graded: g.length };
  });
  const programs = [...by((r) => (r.program_name ?? 'Sin carrera') as string)].map(([name, rs]) => {
    const g = rs.filter((r) => r.grade != null).map((r) => Number(r.grade));
    return { name, students: new Set(rs.map((r) => r.student_id)).size, avg: avg(g), risk: rs.filter((r) => r.at_risk).length };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { students, sections, programs };
}
