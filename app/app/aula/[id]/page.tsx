import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { DownloadMenu } from '@/components/download-menu';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card, Badge, Empty, Tabs } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { ACCEPT } from '@/lib/lms';
import { createAssessment, saveGrades, togglePublish } from '../../secciones/actions';
import { Stat } from '@/components/ui';
import { fmtNum } from '@/lib/format';
import { addContent, addUnit, createAssignment, createQuiz, createThread, deleteContent, submitAssignment, createExternalEval, deleteExternalEval } from '../actions';

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
    const fileIds = (contents ?? []).map((c: any) => c.file_id).filter(Boolean);
    const { data: lf } = fileIds.length ? await ctx.supabase.from('lms_files').select('id, filename, mime_type').in('id', fileIds) : { data: [] as any[] };
    const meta = new Map((lf ?? []).map((f: any) => [f.id, f]));
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
                  {c.file_id && meta.get(c.file_id) && <div className="mt-2"><DownloadMenu href={`/app/aula/archivo/${c.file_id}`} name={meta.get(c.file_id).filename} mime={meta.get(c.file_id).mime_type} /></div>}
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
    const { data: exts } = await ctx.supabase.from('external_evaluations').select('id, title, instructions, provider, opens_at, closes_at, published, assessment_id').eq('section_id', id).order('opens_at');
    const { data: acc } = (exts?.length ? await ctx.supabase.from('external_evaluation_access').select('evaluation_id, student_id, first_opened, last_opened, times, students(first_names, last_names)').in('evaluation_id', exts.map((x: any) => x.id)) : { data: [] }) as { data: any[] | null };
    const PROV: Record<string, string> = { google_forms: '📝 Google Forms', google_drive: '📂 Google Drive', microsoft_forms: '📋 Microsoft Forms', onedrive: '☁ OneDrive', otro: '🔗 Enlace' };
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
        <h2 className="mb-3 mt-2 text-lg font-bold">🔗 Evaluaciones con enlace (Google Forms, Drive, Microsoft Forms…)</h2>
        {manager && (
          <details className="card mb-4" data-testid="nueva-evaluacion-externa"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nueva evaluación con enlace</summary>
            <div className="border-t border-slate-100 p-5"><ActionForm action={createExternalEval} submitLabel="Crear evaluación">{hidden}
              <Field label="Título" name="title" required placeholder="Ej.: Prueba 1 — Unidad de redes" />
              <Field label="Enlace de la evaluación (Google Forms, Drive, Microsoft Forms…)" name="url" required placeholder="https://forms.gle/…" />
              <TextArea label="Instrucciones" name="instructions" />
              <Grid cols={3}><Field label="Abre" name="opens_at" type="datetime-local" required /><Field label="Cierra" name="closes_at" type="datetime-local" required />
                <SelectField label="Nota oficial (evaluación del libro)" name="assessment_id" placeholder="No pasa al libro" options={assessOpts} /></Grid>
              <p className="text-xs text-slate-500">🔒 Los estudiantes no ven el enlace: solo un botón «Entrar» que funciona entre la apertura y el cierre. Usted ve quién entró y cuándo. En Google Forms active «Recopilar correos» para identificar las respuestas.</p>
            </ActionForm></div></details>)}
        <div className="mb-8 space-y-3">{exts?.length ? exts.map((x: any) => {
          const open = x.opens_at <= now && x.closes_at > now;
          const who = (acc ?? []).filter((a: any) => a.evaluation_id === x.id);
          const mine = who.find((a: any) => a.student_id === ctx.studentId);
          return (
            <Card key={x.id} title={x.title} actions={open ? <Badge color="green">Abierta</Badge> : x.closes_at <= now ? <Badge color="gray">Cerrada</Badge> : <Badge color="blue">Próxima</Badge>}>
              <div data-testid="evaluacion-externa">
                <p className="text-sm text-slate-600">{PROV[x.provider] ?? PROV.otro} · {fmtDateTime(x.opens_at)} → {fmtDateTime(x.closes_at)}</p>
                {x.instructions && <p className="mt-2 whitespace-pre-line text-sm">{x.instructions}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(manager || open) && <a className={manager ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} href={`/app/aula/evaluacion/${x.id}`} target="_blank" rel="noopener noreferrer" data-testid="entrar-evaluacion">{manager ? '👁 Abrir enlace' : '▶ Entrar a la evaluación'}</a>}
                  {student && !open && x.opens_at > now && <span className="text-sm text-slate-500">Abre el {fmtDateTime(x.opens_at)}</span>}
                  {student && mine && <span className="text-xs text-emerald-700">✓ Usted entró el {fmtDateTime(mine.first_opened)}</span>}
                  {manager && <ActionForm action={deleteExternalEval} inline submitLabel="🗑" submitClass="text-xs text-red-600 hover:underline" confirm={`¿Eliminar «${x.title}»?`}>{hidden}<input type="hidden" name="id" value={x.id} /></ActionForm>}
                </div>
                {manager && <details className="mt-2 text-sm"><summary className="cursor-pointer text-slate-500" data-testid="ingresos">👥 {who.length} estudiante(s) entraron</summary>
                  <ul className="mt-1 space-y-0.5 text-xs">{who.map((a: any) => <li key={a.student_id}>{a.students ? `${a.students.last_names}, ${a.students.first_names}` : a.student_id} · {fmtDateTime(a.first_opened)}{a.times > 1 ? ` (${a.times} veces)` : ''}</li>)}</ul></details>}
              </div>
            </Card>);
        }) : <Card><Empty>No hay evaluaciones con enlace.</Empty></Card>}</div>
        <h2 className="mb-3 text-lg font-bold">✅ Exámenes en línea de la plataforma</h2>
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

  if (tab === 'evaluacion') {
    const { data: sec } = await ctx.supabase.from('sections').select('grades_closed_at, grade_scales(min_grade, max_grade, passing_grade, decimals)').eq('id', id).maybeSingle();
    const gs = (sec?.grade_scales ?? { min_grade: 1, max_grade: 7, passing_grade: 4, decimals: 1 }) as any;
    const closed = !!sec?.grades_closed_at;
    const { data: list } = await ctx.supabase.from('assessments').select('id, name, weight_pct, published, due_on').eq('section_id', id).order('due_on', { nullsFirst: false }).order('created_at');
    const items = list ?? [];
    const totalW = items.reduce((a: number, x: any) => a + Number(x.weight_pct), 0);
    
    const [{ data: tasks }, { data: quizzes }] = await Promise.all([
      ctx.supabase.from('assignments').select('id, title, due_at').eq('section_id', id).order('due_at'),
      ctx.supabase.from('quizzes').select('id, title, opens_at, closes_at, published').eq('section_id', id).order('opens_at'),
    ]);
    const openQuizzes = (quizzes ?? []).filter((q: any) => q.published && Date.parse(q.opens_at) <= Date.now() && Date.parse(q.closes_at) > Date.now());
    if (manager) {
      const [{ data: roster }, { data: grades }, { data: subs }] = await Promise.all([
        ctx.supabase.from('section_enrollments').select('student_id, students(id, first_names, last_names)').eq('section_id', id).neq('status', 'dropped'),
        items.length ? ctx.supabase.from('grades').select('assessment_id, student_id, grade').in('assessment_id', items.map((a: any) => a.id)) : Promise.resolve({ data: [] as any[] }),
        tasks?.length ? ctx.supabase.from('submissions').select('assignment_id, score').in('assignment_id', tasks.map((t: any) => t.id)) : Promise.resolve({ data: [] as any[] }),
      ]);
      const students = (roster ?? []).map((r: any) => r.students).filter(Boolean).sort((a: any, b: any) => a.last_names.localeCompare(b.last_names));
      const g = (a: string, st: string) => (grades ?? []).find((x: any) => x.assessment_id === a && x.student_id === st);
      const avg = (st: string) => {
        let sum = 0, w = 0;
        for (const a of items) { const v = g(a.id, st); if (v) { sum += Number(v.grade) * Number(a.weight_pct); w += Number(a.weight_pct); } }
        return w ? sum / w : null;
      };
      const avgs = students.map((x: any) => avg(x.id)).filter((v: number | null): v is number => v != null);
      const pending = (subs ?? []).filter((x: any) => x.score == null).length;
      body = (
        <div className="space-y-6" data-testid="evaluacion-calificacion">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Evaluaciones" value={items.length} hint={`Ponderación total ${fmtNum(totalW, 0)} %`} />
            <Stat label="Promedio del curso" value={avgs.length ? fmtNum(avgs.reduce((a, b) => a + b, 0) / avgs.length, gs.decimals) : '—'} hint={`Escala ${gs.min_grade}–${gs.max_grade}, aprueba con ${gs.passing_grade}`} />
            <Stat label="Bajo la nota de aprobación" value={avgs.filter((v) => v < Number(gs.passing_grade)).length} />
            <Stat label="Entregas por calificar" value={pending} href={`${base}?t=tareas`} />
          </div>
          {totalW !== 100 && items.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">La ponderación suma {fmtNum(totalW, 1)} %: ajústela para que sume 100 %.</p>}
          <Card title={`✍ Libro de notas · ${students.length} estudiante(s)`} actions={closed ? <Badge color="gray">Acta cerrada</Badge> : <Badge color="green">Acta abierta</Badge>}>
            {!items.length ? <Empty>Cree la primera evaluación abajo.</Empty> : !students.length ? <Empty>Sin estudiantes inscritos.</Empty> : (
              <ActionForm action={saveGrades} offline={{ key: 'notas', label: 'Planilla de notas' }} submitLabel="Guardar notas" resetOnSuccess={false} hideSubmit={closed}>
                <input type="hidden" name="section_id" value={id} />
                <div className="overflow-x-auto"><table className="table" data-testid="libro-notas">
                  <thead><tr><th>Estudiante</th>{items.map((a: any) => <th key={a.id} className="text-center">{a.name}<br /><span className="font-normal normal-case">{fmtNum(a.weight_pct, 0)} % · {a.published ? 'visible' : 'oculta'}</span></th>)}<th className="text-center">Promedio</th></tr></thead>
                  <tbody>{students.map((x: any) => {
                    const p = avg(x.id);
                    return (
                      <tr key={x.id}><td className="whitespace-nowrap">{x.last_names}, {x.first_names}</td>
                        {items.map((a: any) => <td key={a.id} className="text-center"><input name={`g_${a.id}_${x.id}`} defaultValue={g(a.id, x.id)?.grade ?? ''} disabled={closed} inputMode="decimal" className="input w-20 text-center" aria-label={`Nota ${a.name} ${x.first_names}`} /></td>)}
                        <td className={`text-center font-bold ${p != null && p < Number(gs.passing_grade) ? 'text-red-600' : ''}`}>{p != null ? fmtNum(p, gs.decimals) : '—'}</td></tr>);
                  })}</tbody></table></div>
              </ActionForm>)}
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            {!closed && <Card title="+ Nueva evaluación">
              <ActionForm action={createAssessment} submitLabel="Crear evaluación">
                <input type="hidden" name="section_id" value={id} />
                <Field label="Nombre" name="name" required placeholder="Prueba 1, Trabajo grupal, Participación…" />
                <Grid><Field label="Ponderación %" name="weight_pct" type="number" step="0.5" min={0.5} max={100} required /><Field label="Fecha" name="due_on" type="date" /></Grid>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="published" defaultChecked /> Visible para los estudiantes</label>
              </ActionForm>
              <p className="mt-3 text-xs text-slate-500">Las tareas y los exámenes en línea pueden enviar su nota directo a una de estas evaluaciones.</p>
            </Card>}
            <Card title="Evaluaciones">
              {items.length ? <ul className="divide-y divide-slate-100">{items.map((a: any) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span><b>{a.name}</b> · {fmtNum(a.weight_pct, 0)} %{a.due_on ? ` · ${a.due_on}` : ''}</span>
                  <ActionForm action={togglePublish} inline submitLabel={a.published ? 'Ocultar' : 'Publicar'} submitClass="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="section_id" value={id} /><input type="hidden" name="published" value={String(!a.published)} />
                  </ActionForm></li>))}</ul> : <Empty>Sin evaluaciones.</Empty>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className="btn-secondary btn-sm" href={`${base}?t=tareas`}>📝 Tareas</Link>
                <Link className="btn-secondary btn-sm" href={`${base}?t=examenes`}>✅ Exámenes</Link>
                <Link className="btn-secondary btn-sm" href={`/app/secciones/${id}?t=notas`}>📒 Acta y cierre</Link>
              </div>
            </Card>
          </div>
        </div>);
    } else {
      const { data: mine } = ctx.studentId && items.length ? await ctx.supabase.from('grades').select('assessment_id, grade').eq('student_id', ctx.studentId).in('assessment_id', items.map((a: any) => a.id)) : { data: [] as any[] };
      const rows = items.map((a: any) => ({ ...a, grade: (mine ?? []).find((m: any) => m.assessment_id === a.id)?.grade ?? null }));
      const done = rows.filter((r: any) => r.grade != null);
      const w = done.reduce((s2: number, r: any) => s2 + Number(r.weight_pct), 0);
      const avg = w ? done.reduce((s2: number, r: any) => s2 + Number(r.grade) * Number(r.weight_pct), 0) / w : null;
      const upcoming = (tasks ?? []).filter((t: any) => Date.parse(t.due_at) > Date.now());
      body = (
        <div className="space-y-6" data-testid="evaluacion-calificacion">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Mi promedio" value={<span data-testid="mi-promedio-aula">{avg != null ? fmtNum(avg, gs.decimals) : '—'}</span>} hint={`Aprueba con ${gs.passing_grade}`} />
            <Stat label="Evaluaciones con nota" value={`${done.length} / ${rows.length}`} />
            <Stat label="Exámenes abiertos ahora" value={openQuizzes.length} href={`${base}?t=examenes`} />
          </div>
          <Card title="Mis notas">
            {rows.length ? <table className="table"><thead><tr><th>Evaluación</th><th>Ponderación</th><th>Nota</th></tr></thead>
              <tbody>{rows.map((r: any) => <tr key={r.id}><td>{r.name}</td><td>{fmtNum(r.weight_pct, 0)} %</td>
                <td className={r.grade != null && Number(r.grade) < Number(gs.passing_grade) ? 'font-bold text-red-600' : 'font-bold'}>{r.grade != null ? fmtNum(r.grade, gs.decimals) : '—'}</td></tr>)}</tbody></table>
              : <Empty>El profesor aún no publica evaluaciones.</Empty>}
          </Card>
          {(openQuizzes.length > 0 || upcoming.length > 0) && <Card title="Por rendir y entregar">
            <ul className="space-y-2 text-sm">
              {openQuizzes.map((q: any) => <li key={q.id} className="flex items-center justify-between gap-2">✅ {q.title}<Link className="btn-primary btn-sm" href={`${base}/examen/${q.id}/rendir`}>Rendir</Link></li>)}
              {upcoming.map((t: any) => <li key={t.id} className="flex items-center justify-between gap-2">📝 {t.title}<span className="text-xs text-slate-500">entrega {fmtDateTime(t.due_at)}</span></li>)}
            </ul></Card>}
        </div>);
    }
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
        { key: 'examenes', label: '✅ Exámenes', href: `${base}?t=examenes` }, { key: 'evaluacion', label: '🎯 Evaluación y calificación', href: `${base}?t=evaluacion` },
        { key: 'foro', label: '💬 Foro', href: `${base}?t=foro` }]} /></div>
      {body}
    </>
  );
}
