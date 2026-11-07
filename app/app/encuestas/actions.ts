'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { localToIso } from '@/lib/lms';

const DOCENTE = [
  'El profesor explica los contenidos con claridad.',
  'El profesor domina la materia que enseña.',
  'El profesor es puntual y cumple el horario de clases.',
  'El profesor trata con respeto a los estudiantes.',
  'Las evaluaciones son coherentes con lo enseñado.',
  'El profesor responde dudas y entrega retroalimentación oportuna.',
  'En general, recomendaría a este profesor.',
];

async function addTemplate(ctx: Awaited<ReturnType<typeof getContext>>, surveyId: string) {
  const rows = [
    ...DOCENTE.map((prompt, i) => ({ survey_id: surveyId, position: i + 1, kind: 'escala', prompt, required: true })),
    { survey_id: surveyId, position: DOCENTE.length + 1, kind: 'texto', prompt: '¿Qué destacaría o qué sugiere mejorar?', required: false },
  ];
  const { error } = await ctx.supabase.from('survey_questions').insert(rows);
  if (error) throw new Error(error.message);
}

export async function createSurvey(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'surveys.create')) return fail('No tiene permisos para crear encuestas.');
    const docente = str(fd, 'template') === 'docente';
    const closes = localToIso(reqStr(fd, 'closes_at', 'Cierra el'));
    const opens = str(fd, 'opens_at') ? localToIso(str(fd, 'opens_at')!) : new Date().toISOString();
    let sections: { id: string; code: string; name: string }[] = [];
    const sec = str(fd, 'section_id');
    if (docente) {
      if (!sec) return fail('Elija la sección (o «Todas las secciones») para la evaluación docente.');
      const q = ctx.supabase.from('sections').select('id, code, courses(name), teachers(first_names, last_names)').eq('organization_id', ctx.orgId!).eq('status', 'active').not('teacher_id', 'is', null);
      const { data } = sec === '__all' ? await q : await q.eq('id', sec);
      sections = (data ?? []).map((s: any) => ({ id: s.id, code: s.code, name: `${s.courses?.name ?? ''} · ${s.teachers ? `${s.teachers.first_names} ${s.teachers.last_names}` : ''}` }));
      if (!sections.length) return fail('No hay secciones activas con profesor asignado.');
    }
    const base = {
      organization_id: ctx.orgId, description: str(fd, 'description'), opens_at: opens, closes_at: closes,
      anonymous: docente ? true : !!fd.get('anonymous'), published: !!fd.get('published'),
    };
    if (docente) {
      const title = str(fd, 'title') ?? 'Evaluación docente';
      for (const s of sections) {
        const { data, error } = await ctx.supabase.from('surveys')
          .insert({ ...base, audience: 'section', section_id: s.id, title: `${title} · ${s.code} ${s.name}`.slice(0, 200) }).select('id').single();
        if (error) return fail(error);
        await addTemplate(ctx, data.id);
      }
      revalidatePath('/app/encuestas');
      return ok(sections.length === 1 ? 'Evaluación docente creada con 8 preguntas.' : `Se crearon ${sections.length} evaluaciones docentes (una por sección).`);
    }
    const audience = sec && sec !== '__all' ? 'section' : (str(fd, 'audience') ?? 'all');
    const { data, error } = await ctx.supabase.from('surveys')
      .insert({ ...base, audience, section_id: audience === 'section' ? sec : null, title: reqStr(fd, 'title', 'Título') }).select('id').single();
    if (error) return fail(error);
    revalidatePath('/app/encuestas');
    return ok('Encuesta creada. Ábrala para agregar las preguntas.', data);
  });
}

export async function addQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const survey = reqStr(fd, 'survey_id', 'encuesta');
    const kind = reqStr(fd, 'kind', 'Tipo');
    const options = kind === 'opcion'
      ? (str(fd, 'options') ?? '').split(/\n|;/).map((o) => o.trim()).filter(Boolean)
      : [];
    if (kind === 'opcion' && options.length < 2) return fail('Escriba al menos 2 opciones (una por línea).');
    const { count } = await ctx.supabase.from('survey_questions').select('id', { count: 'exact', head: true }).eq('survey_id', survey);
    const { error } = await ctx.supabase.from('survey_questions').insert({
      survey_id: survey, kind, prompt: reqStr(fd, 'prompt', 'Pregunta'), options, required: !!fd.get('required'), position: (count ?? 0) + 1,
    });
    if (error) return fail(error);
    revalidatePath(`/app/encuestas/${survey}`);
    return ok('Pregunta agregada.');
  });
}

export async function deleteQuestion(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const survey = reqStr(fd, 'survey_id', 'encuesta');
    const { count: answered } = await ctx.supabase.from('survey_participation').select('user_id', { count: 'exact', head: true }).eq('survey_id', survey);
    if (answered) return fail('La encuesta ya tiene respuestas: no se pueden quitar preguntas.');
    const { error, count } = await ctx.supabase.from('survey_questions').delete({ count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath(`/app/encuestas/${survey}`);
    return ok('Pregunta eliminada.');
  });
}

export async function setPublished(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const publish = fd.get('publish') === '1';
    if (publish) {
      const { count } = await ctx.supabase.from('survey_questions').select('id', { count: 'exact', head: true }).eq('survey_id', id);
      if (!count) return fail('Agregue al menos una pregunta antes de publicar.');
    }
    const { error, count } = await ctx.supabase.from('surveys').update({ published: publish }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath('/app/encuestas'); revalidatePath(`/app/encuestas/${id}`);
    return ok(publish ? 'Encuesta publicada: ya pueden responderla.' : 'Encuesta ocultada.');
  });
}

export async function closeNow(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { data: s } = await ctx.supabase.from('surveys').select('opens_at').eq('id', id).maybeSingle();
    if (!s) return fail('Encuesta no encontrada.');
    const now = new Date();
    const closes = new Date(Math.max(now.getTime(), new Date(s.opens_at).getTime() + 1000)).toISOString();
    const { error, count } = await ctx.supabase.from('surveys').update({ closes_at: closes }, { count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath(`/app/encuestas/${id}`);
    return ok('Encuesta cerrada.');
  });
}

export async function deleteSurvey(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error, count } = await ctx.supabase.from('surveys').delete({ count: 'exact' }).eq('id', id);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    revalidatePath('/app/encuestas');
    return ok('Encuesta eliminada.');
  });
}

export async function answerSurvey(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const survey = reqStr(fd, 'survey_id', 'encuesta');
    const answers: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('q_') && typeof v === 'string') answers[k.slice(2)] = v;
    const { error } = await ctx.supabase.rpc('answer_survey', { p_survey: survey, p_answers: answers });
    if (error) return fail(error);
    revalidatePath('/app/encuestas');
    return ok('¡Gracias! Su respuesta fue registrada.');
  });
}
