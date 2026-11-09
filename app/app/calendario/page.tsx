import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { createEvent, deleteEvent } from './actions';

export const metadata = { title: 'Calendario' };
const TZ = 'America/Santiago';
const KIND: Record<string, [string, string]> = {
  feriado: ['Feriado', 'bg-red-100 text-red-800'], academico: ['Académico', 'bg-blue-100 text-blue-800'], evaluacion: ['Evaluación', 'bg-amber-100 text-amber-800'],
  evento: ['Evento', 'bg-emerald-100 text-emerald-800'], reunion: ['Reunión', 'bg-violet-100 text-violet-800'], otro: ['Otro', 'bg-slate-100 text-slate-700'],
  tarea: ['Tarea', 'bg-orange-100 text-orange-800'], examen: ['Examen', 'bg-rose-100 text-rose-800'],
};
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const WD = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const slot = (r: string) => { const m = /[\[(]([\d:]+),([\d:]+)/.exec(r); return m ? `${m[1].slice(0, 5)}–${m[2].slice(0, 5)}` : r; };

type Ev = { id?: string; date: string; title: string; kind: string; time?: string; href?: string };

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const m = /^\d{4}-\d{2}$/.test((await searchParams).m ?? '') ? (await searchParams).m! : today.slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)); const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const from = new Date(Date.UTC(y, mo - 1, 1) - 864e5).toISOString(); const to = new Date(Date.UTC(y, mo, 1) + 864e5).toISOString();
  const personal = !!(ctx.studentId || ctx.teacherId);
  const [{ data: evs }, { data: tasks }, { data: quizzes }] = await Promise.all([
    ctx.supabase.from('calendar_events').select('*').eq('organization_id', orgId).lte('starts_at', to).gte('ends_at', from).order('starts_at'),
    personal ? ctx.supabase.from('assignments').select('id, title, due_at, section_id').gte('due_at', from).lte('due_at', to) : Promise.resolve({ data: [] as any[] }),
    personal ? ctx.supabase.from('quizzes').select('id, title, closes_at, section_id').eq('published', true).gte('closes_at', from).lte('closes_at', to) : Promise.resolve({ data: [] as any[] }),
  ]);
  const items: Ev[] = [];
  for (const e of evs ?? []) {
    for (let d = new Date(dayKey(e.starts_at) + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= dayKey(e.ends_at); d = new Date(d.getTime() + 864e5))
      items.push({ id: e.id, date: d.toISOString().slice(0, 10), title: e.title, kind: e.kind, time: e.all_day ? undefined : hm(e.starts_at) });
  }
  for (const t of tasks ?? []) items.push({ date: dayKey(t.due_at), title: `Entrega: ${t.title}`, kind: 'tarea', time: hm(t.due_at), href: `/app/aula/${t.section_id}?t=tareas` });
  for (const q of quizzes ?? []) items.push({ date: dayKey(q.closes_at), title: `Cierra examen: ${q.title}`, kind: 'examen', time: hm(q.closes_at), href: `/app/aula/${q.section_id}?t=examenes` });

  // Horario semanal
  let schedule: any[] = [];
  if (ctx.studentId) {
    const { data } = await ctx.supabase.from('section_enrollments').select('sections(code, courses(name), section_schedules(weekday, time_slot, rooms(code)))').eq('student_id', ctx.studentId).neq('status', 'dropped');
    schedule = (data ?? []).flatMap((x: any) => (x.sections?.section_schedules ?? []).map((h: any) => ({ ...h, course: x.sections.courses?.name, code: x.sections.code })));
  } else if (ctx.teacherId) {
    const { data } = await ctx.supabase.from('sections').select('code, courses(name), section_schedules(weekday, time_slot, rooms(code))').eq('teacher_id', ctx.teacherId);
    schedule = (data ?? []).flatMap((s: any) => (s.section_schedules ?? []).map((h: any) => ({ ...h, course: s.courses?.name, code: s.code })));
  }
  schedule.sort((a, b) => a.weekday - b.weekday || String(a.time_slot).localeCompare(String(b.time_slot)));

  const offset = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)];
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  const monthName = first.toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const upcoming = items.filter((i) => i.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15);
  return (
    <>
      <PageHeader title="Calendario" subtitle="Calendario académico, feriados, eventos, entregas y exámenes" />
      {can(ctx, 'calendar.create') && (
        <details className="card mb-6"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Agregar evento</summary>
          <div className="border-t border-slate-100 p-5"><ActionForm action={createEvent} submitLabel="Agregar">
            <Field label="Título" name="title" required />
            <Grid cols={3}>
              <SelectField label="Tipo" name="kind" defaultValue="evento" options={Object.entries(KIND).slice(0, 6).map(([value, [label]]) => ({ value, label }))} />
              <Field label="Inicio" name="start" type="datetime-local" required /><Field label="Término (opcional)" name="end" type="datetime-local" />
            </Grid>
            <Grid><SelectField label="Visible para" name="audience" defaultValue="all" options={[{ value: 'all', label: 'Todos' }, { value: 'students', label: 'Estudiantes' }, { value: 'teachers', label: 'Profesores' }, { value: 'staff', label: 'Personal' }]} />
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="all_day" /> Todo el día (feriados, inicio de clases)</label></Grid>
            <TextArea label="Descripción" name="description" />
          </ActionForm></div></details>)}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={monthName} actions={<div className="flex gap-2"><Link className="btn-secondary btn-sm" href={`?m=${prev}`}>←</Link><Link className="btn-secondary btn-sm" href="?">Hoy</Link><Link className="btn-secondary btn-sm" href={`?m=${next}`}>→</Link></div>}>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-slate-200 text-xs">
            {DAYS.map((d) => <div key={d} className="bg-slate-50 p-1 text-center font-bold text-slate-500">{d}</div>)}
            {cells.map((c, i) => (
              <div key={i} className={`min-h-20 bg-white p-1 ${c === today ? 'ring-2 ring-inset ring-brand-500' : ''}`}>
                {c && <><p className="font-semibold text-slate-500">{Number(c.slice(8))}</p>
                  {items.filter((e) => e.date === c).slice(0, 3).map((e, j) => (
                    <p key={j} className={`mt-0.5 truncate rounded px-1 ${KIND[e.kind]?.[1]}`} title={e.title}>{e.time ? `${e.time} ` : ''}{e.title}</p>))}
                  {items.filter((e) => e.date === c).length > 3 && <p className="text-slate-400">+{items.filter((e) => e.date === c).length - 3}</p>}</>}
              </div>))}
          </div>
        </Card>
        <div className="space-y-6">
          {schedule.length > 0 && <Card title="Mi horario semanal">
            <ul className="space-y-1 text-sm">{schedule.map((h, i) => <li key={i}><b>{WD[h.weekday]}</b> {slot(String(h.time_slot))} · {h.course} ({h.code}){h.rooms ? ` · sala ${h.rooms.code}` : ''}</li>)}</ul></Card>}
          <Card title="Próximos">
            {upcoming.length ? <ul className="space-y-2 text-sm">{upcoming.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span><span className={`mr-1 rounded px-1 text-xs ${KIND[e.kind]?.[1]}`}>{KIND[e.kind]?.[0]}</span>
                  {new Date(e.date + 'T12:00:00Z').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' })}{e.time && ` ${e.time}`} · {e.href ? <Link className="link" href={e.href}>{e.title}</Link> : e.title}</span>
                {e.id && ctx.isOwner && <OwnerActions table="calendar_events" id={e.id} path="/app/calendario" name={`el evento «${e.title}»`} />}
                {e.id && !ctx.isOwner && can(ctx, 'calendar.edit') && <ActionForm action={deleteEvent} inline submitLabel="✕" submitClass="btn-secondary btn-sm" confirm="¿Eliminar el evento?"><input type="hidden" name="id" value={e.id} /></ActionForm>}
              </li>))}</ul> : <p className="text-sm text-slate-500">No hay eventos próximos este mes.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
