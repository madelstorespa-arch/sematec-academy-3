import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { addQuestion, deleteQuestion, publishQuiz } from '../../../actions';

export default async function Page({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await getContext();
  const { manager } = await loadSection(ctx, id);
  if (!manager) notFound();
  const [{ data: q }, { data: qs }, { data: keys }, { data: att }] = await Promise.all([
    ctx.supabase.from('quizzes').select('*').eq('id', qid).maybeSingle(),
    ctx.supabase.from('quiz_questions').select('*').eq('quiz_id', qid).order('position').order('id'),
    ctx.supabase.from('quiz_answer_keys').select('*'),
    ctx.supabase.from('quiz_attempts').select('*, students(first_names, last_names)').eq('quiz_id', qid).order('started_at'),
  ]);
  if (!q) notFound();
  const total = (qs ?? []).reduce((n: number, x: any) => n + Number(x.points), 0);
  const hidden = <><input type="hidden" name="section_id" value={id} /><input type="hidden" name="quiz_id" value={qid} /></>;
  return (
    <>
      <PageHeader title={q.title} subtitle={`${fmtDateTime(q.opens_at)} → ${fmtDateTime(q.closes_at)} · ${qs?.length ?? 0} preguntas · ${total} puntos`}
        actions={<ActionForm action={publishQuiz} inline submitLabel={q.published ? 'Ocultar' : 'Publicar examen'} submitClass={q.published ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>{hidden}<input type="hidden" name="published" value={q.published ? '0' : '1'} /></ActionForm>} />
      <Link href={`/app/aula/${id}?t=examenes`} className="link text-sm">← Exámenes</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {(qs ?? []).map((x: any, i: number) => {
            const ok: number[] = keys?.find((k: any) => k.question_id === x.id)?.correct ?? [];
            return (
              <Card key={x.id} title={`${i + 1}. ${x.prompt}`} actions={<ActionForm action={deleteQuestion} inline submitLabel="✕" submitClass="btn-secondary btn-sm" confirm="¿Eliminar la pregunta?">{hidden}<input type="hidden" name="id" value={x.id} /></ActionForm>}>
                <ul className="text-sm">{(x.options as string[]).map((o, j) => <li key={j} className={ok.includes(j) ? 'font-bold text-emerald-700' : ''}>{ok.includes(j) ? '✔' : '○'} {o}</li>)}</ul>
                <p className="mt-1 text-xs text-slate-500">{x.points} pt · {x.kind === 'multiple' ? 'selección múltiple' : x.kind === 'vf' ? 'verdadero/falso' : 'selección única'}</p>
              </Card>);
          })}
          <Card title="Agregar pregunta">
            <ActionForm action={addQuestion} submitLabel="Agregar">{hidden}
              <TextArea label="Pregunta" name="prompt" required />
              <Grid cols={3}><SelectField label="Tipo" name="kind" required defaultValue="unica" options={[{ value: 'unica', label: 'Selección única' }, { value: 'multiple', label: 'Selección múltiple' }, { value: 'vf', label: 'Verdadero / falso' }]} />
                <Field label="Puntos" name="points" type="number" step="0.5" defaultValue="1" /><Field label="Orden" name="position" type="number" defaultValue={String((qs?.length ?? 0) + 1)} /></Grid>
              <TextArea label="Opciones: una por línea; marque las correctas con * al inicio (en V/F escriba *Verdadero o Falso)" name="options" required rows={5} />
            </ActionForm>
          </Card>
        </div>
        <Card title={`Resultados (${att?.length ?? 0})`}>
          {att?.length ? <table className="table"><tbody>{att.map((t: any) => (
            <tr key={t.id}><td>{t.students?.last_names}, {t.students?.first_names}</td>
              <td>{t.submitted_at ? <b>{t.score}/{t.max_score}{t.grade != null && ` · ${t.grade}`}</b> : <Badge color="amber">En curso</Badge>}</td></tr>))}</tbody></table> : <Empty>Nadie ha rendido aún.</Empty>}
        </Card>
      </div>
    </>
  );
}
