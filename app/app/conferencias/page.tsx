import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions } from '@/lib/options';
import { fmtDateTime, label } from '@/lib/format';
import { createRoom, createSession } from './actions';

export const metadata = { title: 'Aulas virtuales' };
const TYPES = ['class', 'meeting', 'webinar', 'congress', 'tutoring'].map((value) => ({ value, label: label(value) }));

export default async function Page() {
  const ctx = await getContext();
  if (!can(ctx, 'conferences.view') && !ctx.teacherId && !ctx.studentId) notFound();
  const orgId = requireOrg(ctx);
  const sb = ctx.supabase;
  const [{ data: rooms }, { data: sessions }, campuses, { data: org }] = await Promise.all([
    sb.from('conference_rooms').select('id, name, room_type, max_participants, section_id, sections(code, courses(code, name))').eq('organization_id', orgId).eq('status', 'active').order('name'),
    sb.from('conference_sessions').select('id, title, session_type, scheduled_start, scheduled_end, timezone, status, conference_rooms(name)')
      .eq('organization_id', orgId).gte('scheduled_end', new Date(Date.now() - 30 * 864e5).toISOString()).order('scheduled_start', { ascending: false }).limit(100),
    campusOptions(ctx),
    sb.from('organizations').select('timezone').eq('id', orgId).single(),
  ]);
  const mySections = ctx.teacherId ? (await sb.from('sections').select('id, code, courses(code, name)').eq('teacher_id', ctx.teacherId)).data ?? [] : [];
  const canCreateRoom = can(ctx, 'conferences.create') || mySections.length > 0;
  const now = Date.now();

  return (
    <>
      <PageHeader title="Aulas virtuales" subtitle="SEMATEC ACADEMY CONFERENCE · clases, reuniones, webinars y tutorías con audio, video, chat y pantalla compartida" />
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        {canCreateRoom && (
          <Card title="Nueva sala">
            <ActionForm action={createRoom} submitLabel="Crear sala">
              <Grid>
                <Field label="Nombre" name="name" required />
                <SelectField label="Tipo" name="room_type" required options={TYPES} defaultValue="class" />
                <SelectField label="Vincular a sección (aula del curso)" name="section_id" options={mySections.map((s: any) => ({ value: s.id, label: `${s.courses.code} ${s.code}` }))} placeholder="Ninguna" />
                <Field label="Capacidad" name="max_participants" type="number" min={2} max={1000} defaultValue={150} />
                {can(ctx, 'conferences.create') && <SelectField label="Sede" name="campus_id" options={campuses} />}
              </Grid>
              <p className="text-xs text-slate-500">Si vincula la sala a una sección, los estudiantes inscritos entran automáticamente y la asistencia se traspasa al libro de clases.</p>
            </ActionForm>
          </Card>
        )}
        {(rooms?.length ?? 0) > 0 && canCreateRoom && (
          <Card title="Programar sesión">
            <ActionForm action={createSession} submitLabel="Programar">
              <Grid>
                <SelectField label="Sala" name="room_id" required options={(rooms ?? []).map((r: any) => ({ value: r.id, label: r.name }))} />
                <Field label="Título" name="title" required />
                <SelectField label="Tipo" name="session_type" required options={TYPES} defaultValue="class" />
                <Field label="Zona horaria" name="timezone" required defaultValue={org?.timezone ?? 'America/Santiago'} />
                <Field label="Fecha" name="date" type="date" required />
                <div className="grid grid-cols-2 gap-2"><Field label="Inicio" name="start" type="time" required /><Field label="Término" name="end" type="time" required /></div>
              </Grid>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recording" /> Permitir grabación (los participantes serán informados)</label>
            </ActionForm>
          </Card>
        )}
      </div>
      <Card title="Sesiones">
        {sessions?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Sesión</th><th>Sala</th><th>Tipo</th><th>Horario</th><th>Estado</th><th></th></tr></thead>
          <tbody>{sessions.map((s: any) => {
            const open = s.status !== 'ended' && s.status !== 'cancelled' && new Date(s.scheduled_end).getTime() + 36e5 > now;
            return (
              <tr key={s.id}><td><Link className="link" href={`/app/conferencias/${s.id}`}>{s.title}</Link></td><td>{s.conference_rooms?.name}</td><td>{label(s.session_type)}</td>
                <td>{fmtDateTime(s.scheduled_start, s.timezone)}</td><td><StatusBadge status={s.status} /></td>
                <td className="text-right">{open && <Link className="btn-primary btn-sm" href={`/app/conferencias/sala/${s.id}`}>Entrar</Link>}</td></tr>);
          })}</tbody></table></div> : <Empty>No hay sesiones visibles.</Empty>}
      </Card>
      {!!rooms?.length && (
        <Card title="Salas" className="mt-6">
          <ul className="grid gap-2 text-sm md:grid-cols-2">{rooms.map((r: any) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3"><b>{r.name}</b> · {label(r.room_type)} · capacidad {r.max_participants}
              {r.sections && <span className="block text-xs text-slate-500">Aula de {r.sections.courses?.code} sección {r.sections.code}</span>}</li>))}</ul>
        </Card>
      )}
    </>
  );
}
