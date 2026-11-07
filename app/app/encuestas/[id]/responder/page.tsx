import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { answerSurvey } from '../../actions';

const SCALE = ['Muy en desacuerdo', 'En desacuerdo', 'Neutral', 'De acuerdo', 'Muy de acuerdo'];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const sb = ctx.supabase;
  const { data: s } = await sb.from('surveys').select('*').eq('id', id).eq('published', true).maybeSingle();
  if (!s) notFound();
  const [{ data: questions }, { data: done }] = await Promise.all([
    sb.from('survey_questions').select('*').eq('survey_id', id).order('position'),
    sb.from('survey_participation').select('responded_at').eq('survey_id', id).eq('user_id', ctx.user.id).maybeSingle(),
  ]);
  const now = Date.now();
  const open = now >= new Date(s.opens_at).getTime() && now <= new Date(s.closes_at).getTime();

  return (
    <>
      <PageHeader title={s.title} subtitle={`Cierra ${fmtDateTime(s.closes_at)}`} actions={<Link className="btn-secondary" href="/app/encuestas">Volver</Link>} />
      {s.description && <p className="mb-4 text-sm text-slate-600">{s.description}</p>}
      {s.anonymous && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">🔒 Encuesta anónima: nadie, ni la institución ni el profesor, puede saber qué respondió usted.</p>}
      {done ? <Card><Empty>✓ Usted ya respondió esta encuesta. ¡Gracias!</Empty></Card>
        : !open ? <Card><Empty>Esta encuesta no está abierta en este momento.</Empty></Card>
        : (
          <ActionForm action={answerSurvey} submitLabel="Enviar respuestas" confirm="¿Enviar? Solo se puede responder una vez.">
            <input type="hidden" name="survey_id" value={s.id} />
            <div className="space-y-4">
              {(questions ?? []).map((q: any, i: number) => (
                <fieldset key={q.id} className="card card-pad">
                  <legend className="sr-only">{q.prompt}</legend>
                  <p className="font-semibold">{i + 1}. {q.prompt}{q.required && <span className="text-red-600"> *</span>}</p>
                  {q.kind === 'escala' && (
                    <div className="mt-3 grid grid-cols-5 gap-1 sm:gap-2">
                      {SCALE.map((l, k) => (
                        <label key={k} className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-slate-200 p-2 text-center text-[11px] leading-tight has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                          <input type="radio" name={`q_${q.id}`} value={k + 1} required={q.required} />
                          <span className="text-base font-bold">{k + 1}</span><span className="hidden sm:block">{l}</span>
                        </label>))}
                    </div>)}
                  {q.kind === 'escala' && <p className="mt-1 flex justify-between text-[11px] text-slate-400 sm:hidden"><span>1 = muy en desacuerdo</span><span>5 = muy de acuerdo</span></p>}
                  {q.kind === 'opcion' && (
                    <div className="mt-3 space-y-2">
                      {(q.options as string[]).map((o, k) => (
                        <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name={`q_${q.id}`} value={k} required={q.required} /> {o}</label>))}
                    </div>)}
                  {q.kind === 'texto' && <textarea className="input mt-3" name={`q_${q.id}`} rows={3} maxLength={4000} required={q.required} />}
                </fieldset>))}
            </div>
          </ActionForm>
        )}
    </>
  );
}
