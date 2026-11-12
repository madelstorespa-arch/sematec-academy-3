'use server';
import { revalidatePath } from 'next/cache';
import { can, getContext } from '@/lib/context';

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

export type EvalItem = { id: string; title: string; kind: 'quiz' | 'ext'; open: boolean; opens_at: string; closes_at: string };
export type EvalData = {
  ok: boolean; error?: string; sectionId: string | null; course?: string; manager?: boolean; closed?: boolean;
  scale?: { min: number; max: number; passing: number; decimals: number };
  assessments?: { id: string; name: string; weight_pct: number; published: boolean }[];
  students?: { id: string; name: string; user_id: string | null }[];
  grades?: { assessment_id: string; student_id: string; grade: number }[];
  items?: EvalItem[];
  mine?: { name: string; weight_pct: number; grade: number | null }[];
  average?: number | null;
};

async function sectionOf(session: string) {
  const ctx = await getContext();
  const { data: s } = await ctx.supabase.from('conference_sessions').select('id, conference_rooms(section_id)').eq('id', session).maybeSingle();
  const sectionId = ((s?.conference_rooms as { section_id?: string } | null)?.section_id) ?? null;
  if (!sectionId) return { ctx, sectionId: null, sec: null, manager: false };
  const { data: sec } = await ctx.supabase.from('sections')
    .select('id, teacher_id, grades_closed_at, courses(name), grade_scales(min_grade, max_grade, passing_grade, decimals)').eq('id', sectionId).maybeSingle();
  const manager = !!sec && ((!!ctx.teacherId && sec.teacher_id === ctx.teacherId) || can(ctx, 'grades.edit') || can(ctx, 'sections.edit'));
  return { ctx, sectionId, sec, manager };
}

/** 📝 Evaluaciones y notas de la asignatura de esta clase en vivo. */
export async function getRoomEval(session: string): Promise<EvalData> {
  if (!uuid(session)) return { ok: false, error: 'Sesión inválida', sectionId: null };
  try {
    const { ctx, sectionId, sec, manager } = await sectionOf(session);
    if (!sectionId || !sec) return { ok: true, sectionId: null };
    const now = Date.now(); const isOpen = (a: string, b: string) => Date.parse(a) <= now && Date.parse(b) > now;
    const [{ data: assessments }, { data: quizzes }, { data: exts }] = await Promise.all([
      ctx.supabase.from('assessments').select('id, name, weight_pct, published').eq('section_id', sectionId).order('due_on', { nullsFirst: false }).order('created_at'),
      ctx.supabase.from('quizzes').select('id, title, opens_at, closes_at, published').eq('section_id', sectionId).order('opens_at'),
      ctx.supabase.from('external_evaluations').select('id, title, opens_at, closes_at, published').eq('section_id', sectionId).order('opens_at'),
    ]);
    const items: EvalItem[] = [
      ...(quizzes ?? []).filter((q) => manager || q.published).map((q) => ({ id: q.id, title: q.title, kind: 'quiz' as const, opens_at: q.opens_at, closes_at: q.closes_at, open: q.published && isOpen(q.opens_at, q.closes_at) })),
      ...(exts ?? []).filter((x) => manager || x.published).map((x) => ({ id: x.id, title: x.title, kind: 'ext' as const, opens_at: x.opens_at, closes_at: x.closes_at, open: x.published && isOpen(x.opens_at, x.closes_at) })),
    ];
    const gs = (sec.grade_scales ?? {}) as { min_grade?: number; max_grade?: number; passing_grade?: number; decimals?: number };
    const scale = { min: Number(gs.min_grade ?? 1), max: Number(gs.max_grade ?? 7), passing: Number(gs.passing_grade ?? 4), decimals: Number(gs.decimals ?? 1) };
    const base = { ok: true, sectionId, course: (sec.courses as { name?: string } | null)?.name ?? '', manager, closed: !!sec.grades_closed_at, scale, items,
      assessments: (assessments ?? []).map((a) => ({ id: a.id, name: a.name, weight_pct: Number(a.weight_pct), published: a.published })) };
    if (manager) {
      const { data: roster } = await ctx.supabase.from('section_enrollments').select('student_id, students(id, first_names, last_names, user_id)')
        .eq('section_id', sectionId).neq('status', 'dropped');
      const students = (roster ?? []).map((r) => r.students as unknown as { id: string; first_names: string; last_names: string; user_id: string | null })
        .filter(Boolean).map((s) => ({ id: s.id, name: `${s.last_names}, ${s.first_names}`, user_id: s.user_id })).sort((a, b) => a.name.localeCompare(b.name));
      const ids = base.assessments.map((a) => a.id);
      const { data: grades } = ids.length ? await ctx.supabase.from('grades').select('assessment_id, student_id, grade').in('assessment_id', ids) : { data: [] };
      return { ...base, students, grades: (grades ?? []).map((g) => ({ ...g, grade: Number(g.grade) })) };
    }
    if (!ctx.studentId) return base;
    const ids = base.assessments.map((a) => a.id);
    const { data: grades } = ids.length ? await ctx.supabase.from('grades').select('assessment_id, grade').eq('student_id', ctx.studentId).in('assessment_id', ids) : { data: [] };
    const mine = base.assessments.map((a) => ({ name: a.name, weight_pct: a.weight_pct, grade: (grades ?? []).find((g) => g.assessment_id === a.id)?.grade ?? null }))
      .map((m) => ({ ...m, grade: m.grade == null ? null : Number(m.grade) }));
    const done = mine.filter((m) => m.grade != null);
    const w = done.reduce((s, m) => s + m.weight_pct, 0);
    return { ...base, mine, average: w ? done.reduce((s, m) => s + (m.grade as number) * m.weight_pct, 0) / w : null };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.', sectionId: null }; }
}

/** ✍ Guarda notas desde la clase en vivo (mismo libro de notas de la sección). */
export async function saveRoomGrades(session: string, assessmentId: string, rows: { student_id: string; grade: string }[]) {
  if (!uuid(session) || !uuid(assessmentId) || !Array.isArray(rows)) return { ok: false, error: 'Datos inválidos' };
  try {
    const { ctx, sectionId, sec, manager } = await sectionOf(session);
    if (!sectionId || !sec || !manager) return { ok: false, error: 'Solo el profesor de la asignatura puede calificar.' };
    if (sec.grades_closed_at) return { ok: false, error: 'El acta de esta asignatura está cerrada.' };
    const gs = (sec.grade_scales ?? {}) as { min_grade?: number; max_grade?: number };
    const min = Number(gs.min_grade ?? 1), max = Number(gs.max_grade ?? 7);
    const out: { organization_id: string | null; assessment_id: string; student_id: string; grade: number }[] = [];
    for (const r of rows.slice(0, 500)) {
      const raw = String(r.grade ?? '').trim();
      if (!raw || !uuid(r.student_id)) continue;
      const g = Number(raw.replace(',', '.'));
      if (!Number.isFinite(g) || g < min || g > max) return { ok: false, error: `Nota inválida «${raw}»: debe estar entre ${min} y ${max}.` };
      out.push({ organization_id: ctx.orgId, assessment_id: assessmentId, student_id: r.student_id, grade: g });
    }
    if (!out.length) return { ok: false, error: 'Escriba al menos una nota.' };
    const { error } = await ctx.supabase.from('grades').upsert(out, { onConflict: 'assessment_id,student_id' });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/app/secciones/${sectionId}`); revalidatePath(`/app/aula/${sectionId}`);
    return { ok: true, count: out.length };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}

/** + Crea una evaluación (por ejemplo «Participación en clase») sin salir de la sala. */
export async function createRoomAssessment(session: string, name: string, weight: number, publish: boolean) {
  if (!uuid(session)) return { ok: false, error: 'Sesión inválida' };
  const n = String(name ?? '').trim().slice(0, 120);
  const w = Number(weight);
  if (!n) return { ok: false, error: 'Escriba el nombre de la evaluación.' };
  if (!Number.isFinite(w) || w <= 0 || w > 100) return { ok: false, error: 'La ponderación debe estar entre 0,5 y 100 %.' };
  try {
    const { ctx, sectionId, manager } = await sectionOf(session);
    if (!sectionId || !manager) return { ok: false, error: 'Solo el profesor de la asignatura puede crear evaluaciones.' };
    const { data, error } = await ctx.supabase.from('assessments').insert({ organization_id: ctx.orgId, section_id: sectionId, name: n, weight_pct: w, published: !!publish, due_on: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }) }).select('id').single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/app/secciones/${sectionId}`); revalidatePath(`/app/aula/${sectionId}`);
    return { ok: true, id: data.id as string };
  } catch { return { ok: false, error: 'Sin conexión con el servidor.' }; }
}
