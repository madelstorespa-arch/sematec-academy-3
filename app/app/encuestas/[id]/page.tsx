import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { addQuestion, deleteQuestion, setPublished, closeNow, deleteSurvey } from '../actions';

const KIND: Record<string, string> = { escala: 'Escala 1 a 5', opcion: 'Selección única', texto: 'Respuesta abierta' };
const SCALE = ['Muy en desacuerdo', 'En desacuerdo', 'Neutral', 'De acuerdo', 'Muy de acuerdo'];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const sb = ctx.supabase;
  const { data: s } = await sb.from('surveys').select('*, sections(code, teacher_id, courses(name))').eq('id', id).maybeSingle();
  if (!s) notFound();
  const manage = can(ctx, 'surveys.view');
  const evaluated = !!ctx.teacherId && s.sections?.teacher_id === ctx.teacherId;
  if (!manage && !evaluated) redirect(`/app/encuestas/${id}/responder`);
  const edit = can(ctx, 'surveys.edit');
  const [{ data: questions }, { data: results, error: resErr }, { count: participants }] = await Promise.all([
    sb.from('survey_questions').select('*').eq('survey_id', id).order('position'),
    sb.rpc('survey_results', { p_survey: id }),
    sb.from('survey_participation').select('user_id', { count: 'exact', head: true }).eq('survey_id', id),
  ]);
  const res = new Map(((results ?? []) as any[]).map((r) => [r.question_id, r]));
  const total = Math.max(participants ?? 0, ...((results ?? []) as any[]).map((r) => Number(r.responses ?? 0)));
  const closed = Date.now() > new Date(s.closes_at).getTime();
  // Para proteger el anonimato, el profesor evaluado ve resultados solo desde 3 respuestas
  const hideForTeacher = !manage && evaluated && s.anonymous && total < 3;
  const scaleAvg = ((results ?? []) as any[]).filter((r) => r.kind === 'escala' && r.average != null);
  const overall = scaleAvg.length ? (scaleAvg.reduce((a, r) => a + Number(r.average), 0) / scaleAvg.length) : null;

  return (
    <>
      <PageHeader title={s.title}
        subtitle={`${s.anonymous ? 'Anónima' : 'Nominativa'} · abre ${fmtDateTime(s.opens_at)} · cierra ${fmtDateTime(s.closes_at)}`}
        actions={<>
          <Link className="btn-secondary" href="/app/encuestas">Volver</Link>
          {edit && <ActionForm action={setPublished} inline submitLabel={s.published ? 'Ocultar' : '📣 Publicar'} submitClass={s.published ? 'btn-secondary' : 'btn-primary'}>
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="publish" value={s.published ? '0' : '1'} />
          </ActionForm>}
          {edit && s.published && !closed && <ActionForm action={closeNow} inline submitLabel="Cerrar ahora" submitClass="btn-secondary" confirm="¿Cerrar la encuesta? Ya no se podrá responder.">
            <input type="hidden" name="id" value={s.id} /></ActionForm>}
        </>} />
      {s.description && <p className="mb-4 text-sm text-slate-600">{s.description}</p>}

      <div className="mb-6 flex flex-wrap gap-3">
        <Badge color={s.published ? 'green' : 'gray'}>{s.published ? (closed ? 'Cerrada' : 'Publicada') : 'Borrador'}</Badge>
        <Badge color="blue">{total} respuesta{total === 1 ? '' : 's'}</Badge>
        {overall != null && !hideForTeacher && <Badge color="green">Promedio general {overall.toFixed(2)} / 5</Badge>}
      </div>

      {hideForTeacher ? (
        <Card><Empty>Los resultados se muestran cuando hay al menos 3 respuestas, para proteger el anonimato de los estudiantes.</Empty></Card>
      ) : (
        <div className="space-y-4">
          {(questions ?? []).map((q: any, i: number) => {
            const r = res.get(q.id);
            const counts = (r?.counts ?? {}) as Record<string, number>;
            const labels: string[] = q.kind === 'escala' ? SCALE : (q.options ?? []);
            const n = Object.values(counts).reduce((a, b) => a + Number(b), 0);
            return (
              <Card key={q.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{i + 1}. {q.prompt}{q.required && <span className="text-red-600"> *</span>}</p>
                    <p className="text-xs text-slate-500">{KIND[q.kind]}{q.kind === 'escala' && r?.average != null ? ` · promedio ${Number(r.average).toFixed(2)}` : ''}</p>
                  </div>
                  {edit && total === 0 && (
                    <ActionForm action={deleteQuestion} inline submitLabel="Quitar" submitClass="btn-secondary btn-sm">
                      <input type="hidden" name="id" value={q.id} /><input type="hidden" name="survey_id" value={s.id} />
                    </ActionForm>)}
                </div>
                {q.kind !== 'texto' ? (
                  <div className="mt-3 space-y-1">
                    {labels.map((l, idx) => {
                      const key = String(q.kind === 'escala' ? idx + 1 : idx);
                      const c = Number(counts[key] ?? 0);
                      const pct = n ? Math.round((100 * c) / n) : 0;
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span className="w-44 shrink-0 truncate text-slate-600">{q.kind === 'escala' ? `${idx + 1} · ` : ''}{l}</span>
                          <div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded bg-brand-600" style={{ width: `${pct}%` }} /></div>
                          <span className="w-16 text-right text-xs text-slate-500">{c} ({pct}%)</span>
                        </div>);
                    })}
                  </div>
                ) : (
                  (r?.texts ?? []).length ? (
                    <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      {(r.texts as string[]).map((t, k) => <li key={k} className="rounded-lg bg-slate-50 p-2 text-sm">“{t}”</li>)}
                    </ul>) : <p className="mt-2 text-sm text-slate-400">Sin respuestas abiertas.</p>
                )}
              </Card>);
          })}
          {!questions?.length && <Card><Empty>Esta encuesta aún no tiene preguntas.</Empty></Card>}
          {resErr && manage && <p className="text-sm text-red-700">No se pudieron cargar los resultados: {resErr.message}</p>}
        </div>
      )}

      {edit && total === 0 && (
        <Card title="Agregar pregunta" className="mt-6">
          <ActionForm action={addQuestion} submitLabel="Agregar">
            <input type="hidden" name="survey_id" value={s.id} />
            <Field label="Pregunta" name="prompt" required />
            <Grid cols={2}>
              <SelectField label="Tipo de respuesta" name="kind" required defaultValue="escala" options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="required" defaultChecked /> Obligatoria</label>
            </Grid>
            <TextArea label="Opciones (solo para selección única, una por línea)" name="options" rows={3} />
          </ActionForm>
        </Card>
      )}
      {can(ctx, 'surveys.admin') && (
        <div className="mt-6"><ActionForm action={deleteSurvey} inline submitLabel="Eliminar encuesta" submitClass="btn-secondary btn-sm" confirm="¿Eliminar la encuesta y todas sus respuestas?">
          <input type="hidden" name="id" value={s.id} /></ActionForm></div>
      )}
    </>
  );
}
