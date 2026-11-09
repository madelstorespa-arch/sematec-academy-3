import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card, Badge, Empty, Tabs } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { ACCEPT } from '@/lib/lms';
import { addContent, addUnit, createAssignment, createQuiz, createThread, deleteContent, submitAssignment } from '../actions';

export const metadata = { title: 'Curso' };
const KIND: Record<string, string> = { texto: '📝', video: '🎬', enlace: '🔗', archivo: '📎' };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).t ?? 'contenidos';
  const ctx = await getContext();
  const { s, manager, student } = await loadSection(ctx, id);
  const base = `/app/aula/${id}`;
  const { data: assessments } = manager ? await ctx.supabase.from('assessments').select('id, name, weight_pct').eq('section_id', id) : { data: [] as any[] };
  const assessOpts = (assessments ?? []).map((a: any) => ({ value: a.id, label: `${a.name} (${a.weight_pct}%)` }));
  const hidden = <input type="hidden" name="section_id" value={id} />;
  let body: React.ReactNode = null;

  if (tab === 'contenidos') {
    const [{ data: units }, { data: contents }, { data: books }] = await Promise.all([
      ctx.supabase.from('course_units').select('*').eq('section_id', id).order('position').order('created_at'),
      ctx.supabase.from('course_contents').select('*').eq('section_id', id).order('position').order('created_at'),
      ctx.supabase.from('library_items').select('id, title, author, file_id, url').or(`section_id.eq.${id},course_id.eq.${s.course_id}`)
        .or('file_id.not.is.null,url.not.is.null').order('title').limit(30),
    ]);
    const groups = [...(units ?? []), { id: null, title: 'Otros contenidos' }];
    body = (
      <>
        {!!books?.length && (
          <div className="card card-pad mb-6">
            <p className="mb-3 text-sm font-bold">📚 Libros virtuales de esta asignatura</p>
            <div className="flex flex-wrap gap-2">{books.map((b: any) => (
              <a key={b.id} className="btn-secondary btn-sm" target="_blank" rel="noopener noreferrer" href={b.file_id ? `/app/biblioteca/libro/${b.file_id}` : b.url}>📘 {b.title}</a>))}
            </div>
          </div>)}
        {manager && (
          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <details className="card"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nueva unidad</summary>
              <div className="border-t border-slate-100 p-5"><ActionForm action={addUnit} submitLabel="Crear unidad">{hidden}
                <Field label="Título (ej. Unidad 1: Introducción)" name="title" required /><TextArea label="Descripción" name="description" />
                <Field label="Orden" name="position" type="number" defaultValue="0" /></ActionForm></div></details>
            <details className="card"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Agregar contenido</summary>
              <div className="border-t border-slate-100 p-5"><ActionForm action={addContent} submitLabel="Publicar">{hidden}
                <Grid><SelectField label="Tipo" name="kind" required defaultValue="archivo" options={[{ value: 'archivo', label: '📎 Archivo (PDF, Word, PPT…)' }, { value: 'video', label: '🎬 Video (YouTube, Drive…)' }, { value: 'enlace', label: '🔗 Enlace' }, { value: 'texto', label: '📝 Texto / apunte' }]} />
                  <SelectField label="Unidad" name="unit_id" placeholder="Sin unidad" options={(units ?? []).map((u: any) => ({ value: u.id, label: u.title }))} /></Grid>
                <Field label="Título" name="title" required />
                <label className="block"><span className="label">Archivo (máx. 4 MB)</span><input type="file" name="file" accept={ACCEPT} className="text-sm" /></label>
                <Field label="Enlace (para video o enlace, https://)" name="url" />
                <TextArea label="Texto o descripción" name="body" rows={4} /></ActionForm></div></details>
          </div>)}
        {(contents?.length || units?.length) ? groups.map((u: any) => {
          const items = (contents ?? []).filter((c: any) => (c.unit_id ?? null) === u.id);
          if (!u.id && !items.length) return null;
          return (
            <Card key={u.id ?? 'otros'} title={u.title} className="mb-4"
              actions={manager && u.id ? <ActionForm action={deleteContent} inline submitLabel="Eliminar unidad" submitClass="btn-secondary btn-sm" confirm="¿Eliminar la unidad y sus contenidos?">{hidden}<input type="hidden" name="what" value="unit" /><input type="hidden" name="id" value={u.id} /></ActionForm> : null}>
              {u.description && <p className="mb-3 text-sm text-slate-600">{u.description}</p>}
              {ctx.isOwner && u.id && <div className="mb-3"><OwnerActions table="course_units" id={u.id} active={u.published} path={`/app/aula/${id}`} name={`la unidad «${u.title}»`} /></div>}
              {items.length ? <ul className="space-y-3">{items.map((c: any) => (
                <li key={c.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{KIND[c.kind]} {c.file_id ? <a className="link" href={`/app/aula/archivo/${c.file_id}`}>{c.title}</a> : c.url ? <a className="link" href={c.url} target="_blank" rel="noopener noreferrer">{c.title} ↗</a> : c.title}</p>
                    {manager && <ActionForm action={deleteContent} inline submitLabel="✕" submitClass="btn-secondary btn-sm" confirm="¿Eliminar este contenido?">{hidden}<input type="hidden" name="id" value={c.id} /></ActionForm>}
                  </div>
                  {c.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{c.body}</p>}
                  {ctx.isOwner && <div className="mt-2"><OwnerActions table="course_contents" id={c.id} active={c.published} path={`/app/aula/${id}`} name={`«${c.title}»`} /></div>}
                </li>))}</ul> : <p className="text-sm text-slate-500">Sin contenidos aún.</p>}
            </Card>);
        }) : <Card><Empty>El profesor aún no publica contenidos.</Empty></Card>}
      </>);
  }

  if (tab === 'tareas') {
    const { data: tasks } = await ctx.supabase.from('assignments').select('*').eq('section_id', id).order('due_at');
    const { data: mine } = student ? await ctx.supabase.from('submissions').select('*').eq('student_id', ctx.studentId!) : { data: [] as any[] };
    const { data: counts } = manager ? await ctx.supabase.from('submissions').select('assignment_id, score') : { data: [] as any[] };
    const now = new Date().toISOString();
    body = (
      <>
        {manager && (
          <details className="card mb-6"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nueva tarea</summary>
            <div className="border-t border-slate-100 p-5"><ActionForm action={createAssignment} submitLabel="Publicar tarea">{hidden}
              <Field label="Título" name="title" required /><TextArea label="Instrucciones" name="instructions" rows={4} />
              <Grid cols={3}><Field label="Fecha y hora de entrega" name="due_at" type="datetime-local" required /><Field label="Puntaje máximo" name="max_score" type="number" defaultValue="100" />
                <SelectField label="Nota oficial (evaluación del libro)" name="assessment_id" placeholder="No pasa al libro" options={assessOpts} /></Grid>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_late" defaultChecked /> Aceptar entregas atrasadas (quedan marcadas)</label>
            </ActionForm></div></details>)}
        <div className="space-y-4">{tasks?.length ? tasks.map((a: any) => {
          const sub = (mine ?? []).find((m: any) => m.assignment_id === a.id);
          const n = (counts ?? []).filter((c: any) => c.assignment_id === a.id);
          return (
            <Card key={a.id} title={a.title} actions={a.due_at < now ? <Badge color="gray">Cerrada {fmtDateTime(a.due_at)}</Badge> : <Badge color="amber">Entrega {fmtDateTime(a.due_at)}</Badge>}>
              {a.instructions && <p className="whitespace-pre-line text-sm text-slate-700">{a.instructions}</p>}
              <p className="mt-2 text-xs text-slate-500">Puntaje máximo {a.max_score}{a.assessment_id && ' · cuenta para la nota oficial'}</p>
              {ctx.isOwner && <div className="mt-2"><OwnerActions table="assignments" id={a.id} active={a.published} path={`/app/aula/${id}?t=tareas`} name={`la tarea «${a.title}»`} /></div>}
              {manager && <p className="mt-3"><Link className="btn-secondary btn-sm" href={`${base}/tarea/${a.id}`}>Ver entregas ({n.length}, {n.filter((x: any) => x.score == null).length} por calificar)</Link></p>}
              {student && (sub?.score != null ? (
                <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm"><b>Calificada: {sub.score} / {a.max_score}</b>{sub.feedback && <p className="mt-1">Comentario: {sub.feedback}</p>}</div>
              ) : (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {sub && <p className="mb-2 text-sm text-emerald-700">✓ Entregado el {fmtDateTime(sub.submitted_at)}{sub.late && ' (atrasado)'}. Puede reemplazar su entrega hasta que sea calificada.</p>}
                  {(a.due_at >= now || a.allow_late) ? (
                    <ActionForm action={submitAssignment} submitLabel={sub ? 'Reemplazar entrega' : 'Entregar'}>{hidden}<input type="hidden" name="assignment_id" value={a.id} />
                      <TextArea label="Respuesta" name="body" rows={3} defaultValue={sub?.body} />
                      <Grid><Field label="Enlace (opcional, https://)" name="url" defaultValue={sub?.url} />
                        <label className="block"><span className="label">Archivo (máx. 4 MB)</span><input type="file" name="file" accept={ACCEPT} className="text-sm" /></label></Grid>
                    </ActionForm>) : <p className="text-sm text-red-600">El plazo terminó.</p>}
                </div>))}
            </Card>);
        }) : <Card><Empty>No hay tareas.</Empty></Card>}</div>
      </>);
  }

  if (tab === 'examenes') {
    const { data: quizzes } = await ctx.supabase.from('quizzes').select('*').eq('section_id', id).order('opens_at');
    const { data: att } = student ? await ctx.supabase.from('quiz_attempts').select('quiz_id, submitted_at, score, max_score, grade').eq('student_id', ctx.studentId!) : { data: [] as any[] };
    const now = new Date().toISOString();
    body = (
      <>
        {manager && (
          <details className="card mb-6"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nuevo examen</summary>
            <div className="border-t border-slate-100 p-5"><ActionForm action={createQuiz} submitLabel="Crear examen">{hidden}
              <Field label="Título" name="title" required /><TextArea label="Instrucciones" name="instructions" />
              <Grid cols={3}><Field label="Abre" name="opens_at" type="datetime-local" required /><Field label="Cierra" name="closes_at" type="datetime-local" required />
                <Field label="Tiempo límite (minutos, opcional)" name="time_limit_min" type="number" /></Grid>
              <Grid><Field label="Intentos permitidos" name="max_attempts" type="number" defaultValue="1" /><SelectField label="Nota oficial (evaluación del libro)" name="assessment_id" placeholder="No pasa al libro" options={assessOpts} /></Grid>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="show_results" defaultChecked /> Mostrar puntaje al alumno (y la revisión cuando cierre)</label>
            </ActionForm></div></details>)}
        <div className="space-y-4">{quizzes?.length ? quizzes.map((q: any) => {
          const mine = (att ?? []).filter((t: any) => t.quiz_id === q.id);
          const done = mine.filter((t: any) => t.submitted_at);
          const open = q.opens_at <= now && q.closes_at > now;
          return (
            <Card key={q.id} title={q.title} actions={!q.published ? <Badge>Borrador</Badge> : open ? <Badge color="green">Abierto</Badge> : q.closes_at <= now ? <Badge color="gray">Cerrado</Badge> : <Badge color="blue">Próximo</Badge>}>
              <p className="text-sm text-slate-600">{fmtDateTime(q.opens_at)} → {fmtDateTime(q.closes_at)}{q.time_limit_min && ` · ${q.time_limit_min} min`} · {q.max_attempts} intento(s)</p>
              {ctx.isOwner && <div className="mt-2"><OwnerActions table="quizzes" id={q.id} active={q.published} path={`/app/aula/${id}?t=examenes`} name={`la prueba «${q.title}»`} /></div>}
              {q.instructions && <p className="mt-2 whitespace-pre-line text-sm">{q.instructions}</p>}
              {manager && <p className="mt-3"><Link className="btn-secondary btn-sm" href={`${base}/examen/${q.id}`}>Preguntas y resultados</Link></p>}
              {student && (
                <div className="mt-3 text-sm">
                  {done.map((t: any, i: number) => <p key={i}>Intento {i + 1}: {q.show_results ? <b>{t.score} / {t.max_score}{t.grade != null && ` · nota ${t.grade}`}</b> : 'enviado'}</p>)}
                  {open && mine.length - done.length + (q.max_attempts - mine.length) > 0 && <Link className="btn-primary btn-sm mt-2 inline-block" href={`${base}/examen/${q.id}/rendir`}>{mine.some((t: any) => !t.submitted_at) ? 'Continuar examen' : 'Rendir examen'}</Link>}
                </div>)}
            </Card>);
        }) : <Card><Empty>No hay exámenes.</Empty></Card>}</div>
      </>);
  }

  if (tab === 'foro') {
    const { data: threads } = await ctx.supabase.from('forum_threads').select('*, forum_posts(count)').eq('section_id', id)
      .order('pinned', { ascending: false }).order('last_post_at', { ascending: false });
    body = (
      <>
        {(manager || student) && (
          <details className="card mb-6"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nuevo tema</summary>
            <div className="border-t border-slate-100 p-5"><ActionForm action={createThread} offline={{ key: 'foro_tema', label: 'Nuevo tema en el foro' }} submitLabel="Publicar">{hidden}
              <Field label="Título" name="title" required /><TextArea label="Mensaje" name="body" required rows={4} />
              {manager && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" /> Fijar arriba</label>}
            </ActionForm></div></details>)}
        <Card>{threads?.length ? <ul className="divide-y divide-slate-100">{threads.map((t: any) => (
          <li key={t.id}><Link href={`${base}/foro/${t.id}`} className="block py-3 hover:bg-slate-50">
            <p className="font-semibold">{t.pinned && '📌 '}{t.locked && '🔒 '}{t.title}</p>
            <p className="text-xs text-slate-500">{t.author_name} · {t.forum_posts?.[0]?.count ?? 0} respuestas · último mensaje {fmtDateTime(t.last_post_at)}</p>
          </Link>{ctx.isOwner && <div className="pb-3"><OwnerActions table="forum_threads" id={t.id} path={`/app/aula/${id}?t=foro`} name={`el tema «${t.title}»`} /></div>}</li>))}</ul> : <Empty>Aún no hay temas en el foro.</Empty>}</Card>
      </>);
  }

  return (
    <>
      <PageHeader title={s.courses?.name ?? 'Curso'} subtitle={`${s.courses?.code ?? ''} · Sección ${s.code} · ${s.academic_periods?.name ?? ''}`} />
      <Link href="/app/aula" className="link text-sm">← Mis cursos</Link>
      <div className="mt-4"><Tabs current={tab} items={[
        { key: 'contenidos', label: '📚 Contenidos', href: base }, { key: 'tareas', label: '📝 Tareas', href: `${base}?t=tareas` },
        { key: 'examenes', label: '✅ Exámenes', href: `${base}?t=examenes` }, { key: 'foro', label: '💬 Foro', href: `${base}?t=foro` }]} /></div>
      {body}
    </>
  );
}
