import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { gradeSubmission } from '../../../actions';

export default async function Page({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = await params;
  const ctx = await getContext();
  const { manager } = await loadSection(ctx, id);
  if (!manager) notFound();
  const [{ data: a }, { data: subs }, { data: roster }] = await Promise.all([
    ctx.supabase.from('assignments').select('*').eq('id', aid).maybeSingle(),
    ctx.supabase.from('submissions').select('*, students(first_names, last_names)').eq('assignment_id', aid).order('submitted_at'),
    ctx.supabase.from('section_enrollments').select('student_id, students(first_names, last_names)').eq('section_id', id).neq('status', 'dropped'),
  ]);
  if (!a) notFound();
  const missing = (roster ?? []).filter((r: any) => !(subs ?? []).some((s: any) => s.student_id === r.student_id));
  return (
    <>
      <PageHeader title={a.title} subtitle={`Entrega ${fmtDateTime(a.due_at)} · puntaje máximo ${a.max_score}`} />
      <Link href={`/app/aula/${id}?t=tareas`} className="link text-sm">← Tareas</Link>
      <div className="mt-4 space-y-4">
        {subs?.length ? subs.map((s: any) => (
          <Card key={s.id} title={`${s.students?.last_names}, ${s.students?.first_names}`}
            actions={s.score != null ? <Badge color="green">{s.score} / {a.max_score}</Badge> : s.late ? <Badge color="amber">Atrasada</Badge> : <Badge color="blue">Por calificar</Badge>}>
            <p className="text-xs text-slate-500">Entregado {fmtDateTime(s.submitted_at)}</p>
            {s.body && <p className="mt-2 whitespace-pre-line text-sm">{s.body}</p>}
            {s.url && <p className="mt-1 text-sm"><a className="link" href={s.url} target="_blank" rel="noopener noreferrer">{s.url} ↗</a></p>}
            {s.file_id && <p className="mt-1 text-sm"><a className="link" href={`/app/aula/archivo/${s.file_id}`}>📎 Descargar archivo</a></p>}
            <ActionForm action={gradeSubmission} submitLabel="Guardar calificación" className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end" resetOnSuccess={false}>
              <input type="hidden" name="section_id" value={id} /><input type="hidden" name="submission_id" value={s.id} />
              <Field label="Puntaje" name="score" type="number" step="0.5" min={0} max={Number(a.max_score)} required defaultValue={s.score ?? undefined} />
              <Field label="Comentario" name="feedback" defaultValue={s.feedback} />
            </ActionForm>
          </Card>)) : <Card><Empty>Aún no hay entregas.</Empty></Card>}
        {missing.length > 0 && <Card title={`Sin entregar (${missing.length})`}><p className="text-sm">{missing.map((m: any) => `${m.students?.last_names}, ${m.students?.first_names}`).join(' · ')}</p></Card>}
      </div>
    </>
  );
}
