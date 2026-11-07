'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { localToIso, saveLmsFile } from '@/lib/lms';

const back = (s: string) => revalidatePath(`/app/aula/${s}`, 'layout');

// ---------- Contenidos ----------
export async function addUnit(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { error } = await ctx.supabase.from('course_units').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), description: str(fd, 'description'), position: num(fd, 'position') ?? 0,
    });
    if (error) return fail(error);
    back(section); return ok('Unidad creada.');
  });
}

export async function addContent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const kind = reqStr(fd, 'kind', 'Tipo');
    const file = kind === 'archivo' ? await saveLmsFile(ctx, fd.get('file') as File, section, 'content') : null;
    if (kind === 'archivo' && !file) return fail('Seleccione el archivo.');
    const url = str(fd, 'url');
    if (url && !url.startsWith('https://')) return fail('El enlace debe comenzar con https://');
    const { error } = await ctx.supabase.from('course_contents').insert({
      organization_id: ctx.orgId, section_id: section, unit_id: str(fd, 'unit_id'), kind, title: reqStr(fd, 'title', 'Título'),
      body: str(fd, 'body'), url: kind === 'video' || kind === 'enlace' ? url : null, file_id: file, position: num(fd, 'position') ?? 0,
    });
    if (error) return fail(error);
    back(section); return ok('Contenido publicado.');
  });
}

export async function deleteContent(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const table = fd.get('what') === 'unit' ? 'course_units' : 'course_contents';
    const { error, count } = await ctx.supabase.from(table).delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    back(reqStr(fd, 'section_id', 'sección')); return ok('Eliminado.');
  });
}

// ---------- Tareas ----------
export async function createAssignment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { error } = await ctx.supabase.from('assignments').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), instructions: str(fd, 'instructions'),
      due_at: localToIso(reqStr(fd, 'due_at', 'Fecha de entrega')), max_score: num(fd, 'max_score') ?? 100,
      allow_late: !!fd.get('allow_late'), assessment_id: str(fd, 'assessment_id'),
    });
    if (error) return fail(error);
    back(section); return ok('Tarea publicada.');
  });
}

export async function submitAssignment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const file = await saveLmsFile(ctx, fd.get('file') as File, section, 'submission');
    const body = str(fd, 'body'); const url = str(fd, 'url');
    if (!file && !body && !url) return fail('Escriba una respuesta, agregue un enlace o adjunte un archivo.');
    const { error } = await ctx.supabase.rpc('submit_assignment', { p_assignment: reqStr(fd, 'assignment_id', 'tarea'), p_body: body, p_url: url, p_file: file });
    if (error) return fail(error);
    back(section); return ok('Entrega recibida.');
  });
}

export async function gradeSubmission(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('grade_submission', {
      p_submission: reqStr(fd, 'submission_id', 'entrega'), p_score: num(fd, 'score'), p_feedback: str(fd, 'feedback'),
    });
    if (error) return fail(error);
    back(reqStr(fd, 'section_id', 'sección'));
    return ok(data != null ? `Calificada. Nota en el libro de clases: ${data}.` : 'Calificada.');
  });
}

// ---------- Exámenes ----------
export async function createQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { data, error } = await ctx.supabase.from('quizzes').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), instructions: str(fd, 'instructions'),
      opens_at: localToIso(reqStr(fd, 'opens_at', 'Apertura')), closes_at: localToIso(reqStr(fd, 'closes_at', 'Cierre')),
      time_limit_min: num(fd, 'time_limit_min'), max_attempts: num(fd, 'max_attempts') ?? 1,
      show_results: !!fd.get('show_results'), assessment_id: str(fd, 'assessment_id'),
    }).select('id').single();
    if (error) return fail(error);
    back(section); return ok('Examen creado. Agregue las preguntas y luego publíquelo.', data.id);
  });
}

/** Opciones una por línea; las correctas comienzan con «*». */
export async function addQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const kind = reqStr(fd, 'kind', 'Tipo');
    let lines = reqStr(fd, 'options', 'Opciones').split('\n').map((l) => l.trim()).filter(Boolean);
    if (kind === 'vf') lines = [(lines[0] ?? '').startsWith('*') ? '*Verdadero' : 'Verdadero', (lines[0] ?? '').startsWith('*') ? 'Falso' : '*Falso'];
    if (lines.length < 2 || lines.length > 8) return fail('Escriba entre 2 y 8 opciones, una por línea.');
    const correct = lines.map((l, i) => (l.startsWith('*') ? i : -1)).filter((i) => i >= 0);
    if (!correct.length) return fail('Marque la(s) respuesta(s) correcta(s) con * al inicio de la línea.');
    if (kind === 'unica' && correct.length !== 1) return fail('En selección única debe haber exactamente una correcta.');
    const quiz = reqStr(fd, 'quiz_id', 'examen');
    const { data, error } = await ctx.supabase.from('quiz_questions').insert({
      organization_id: ctx.orgId, quiz_id: quiz, kind, prompt: reqStr(fd, 'prompt', 'Pregunta'),
      options: lines.map((l) => l.replace(/^\*\s*/, '')), points: num(fd, 'points') ?? 1, position: num(fd, 'position') ?? 0,
    }).select('id').single();
    if (error) return fail(error);
    const { error: e2 } = await ctx.supabase.from('quiz_answer_keys').insert({ question_id: data.id, correct });
    if (e2) { await ctx.supabase.from('quiz_questions').delete().eq('id', data.id); return fail(e2); }
    back(reqStr(fd, 'section_id', 'sección')); return ok('Pregunta agregada.');
  });
}

export async function deleteQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('quiz_questions').delete().eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    back(reqStr(fd, 'section_id', 'sección')); return ok('Pregunta eliminada.');
  });
}

export async function publishQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const pub = fd.get('published') === '1';
    const { error, count } = await ctx.supabase.from('quizzes').update({ published: pub }, { count: 'exact' }).eq('id', reqStr(fd, 'quiz_id', 'examen'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    back(reqStr(fd, 'section_id', 'sección')); return ok(pub ? 'Examen publicado.' : 'Examen oculto.');
  });
}

export async function startQuiz(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('start_quiz', { p_quiz: reqStr(fd, 'quiz_id', 'examen') });
    if (error) return fail(error);
    return ok('Examen iniciado.', data);
  });
}

export async function submitQuiz(attemptId: string, answers: Record<string, number[]>): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('submit_quiz', { p_attempt: attemptId, p_answers: answers });
    if (error) return fail(error);
    const r = data as { score: number; max: number; grade: number | null; show: boolean };
    return ok(r.show ? `Examen enviado. Puntaje: ${r.score} de ${r.max}${r.grade != null ? ` · Nota ${r.grade}` : ''}.` : 'Examen enviado.', r);
  });
}

// ---------- Foro ----------
export async function createThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext(); const section = reqStr(fd, 'section_id', 'sección');
    const { error } = await ctx.supabase.from('forum_threads').insert({
      organization_id: ctx.orgId, section_id: section, title: reqStr(fd, 'title', 'Título'), body: reqStr(fd, 'body', 'Mensaje'), pinned: !!fd.get('pinned'),
    });
    if (error) return fail(error.code === '42501' ? 'No puede publicar en este foro.' : error);
    back(section); return ok('Tema publicado.');
  });
}

export async function replyThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('forum_posts').insert({ organization_id: ctx.orgId, thread_id: reqStr(fd, 'thread_id', 'tema'), body: reqStr(fd, 'body', 'Mensaje') });
    if (error) return fail(error.code === '42501' ? 'El tema está cerrado.' : error);
    back(reqStr(fd, 'section_id', 'sección')); return ok('Respuesta publicada.');
  });
}

export async function moderateThread(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const field = reqStr(fd, 'field', 'campo') === 'pinned' ? 'pinned' : 'locked';
    const { error, count } = await ctx.supabase.from('forum_threads').update({ [field]: fd.get('value') === '1' }, { count: 'exact' }).eq('id', reqStr(fd, 'thread_id', 'tema'));
    if (error) return fail(error); if (!count) return fail('No autorizado.');
    back(reqStr(fd, 'section_id', 'sección')); return ok('Actualizado.');
  });
}
