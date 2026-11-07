import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card } from '@/components/ui';
import { QuizRunner, StartQuiz } from './runner';

export default async function Page({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await getContext();
  const { student } = await loadSection(ctx, id);
  if (!student) notFound();
  const { data: q } = await ctx.supabase.from('quizzes').select('*').eq('id', qid).eq('published', true).maybeSingle();
  if (!q) notFound();
  const { data: open } = await ctx.supabase.from('quiz_attempts').select('id, deadline').eq('quiz_id', qid).eq('student_id', ctx.studentId!)
    .is('submitted_at', null).gt('deadline', new Date().toISOString()).maybeSingle();
  const { data: qs } = open ? await ctx.supabase.from('quiz_questions').select('id, prompt, kind, options, points').eq('quiz_id', qid).order('position').order('id') : { data: null };
  return (
    <>
      <PageHeader title={q.title} subtitle={q.time_limit_min ? `Tiempo límite: ${q.time_limit_min} minutos` : 'Sin tiempo límite (hasta el cierre)'} />
      <Link href={`/app/aula/${id}?t=examenes`} className="link text-sm">← Exámenes</Link>
      <div className="mt-4">
        {open && qs ? <QuizRunner attemptId={open.id} deadline={open.deadline} questions={qs as any} back={`/app/aula/${id}?t=examenes`} />
          : <Card>{q.instructions && <p className="mb-4 whitespace-pre-line text-sm">{q.instructions}</p>}
              <p className="mb-4 text-sm text-slate-600">Al comenzar, el tiempo empieza a correr. Las respuestas se corrigen automáticamente al enviar.</p>
              <StartQuiz quizId={qid} /></Card>}
      </div>
    </>
  );
}
