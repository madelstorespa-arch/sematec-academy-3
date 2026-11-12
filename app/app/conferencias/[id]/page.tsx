import { DownloadMenu } from '@/components/download-menu';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Badge } from '@/components/ui';
import { ActionForm, Field, SelectField } from '@/components/forms';
import { fmtDateTime, label, CONF_ROLES } from '@/lib/format';
import { addParticipant, banParticipant, endSession, issueAttendanceCertificates, setSessionOptions, deleteRecording } from '../actions';
import { RecordingShare } from '@/components/recording-share';
import { listInvites, createInvite, revokeInvite } from '../invite-actions';
import { ShareLink } from '../sala/[id]/invite';
import { docLabel } from '@/lib/identity';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const sb = ctx.supabase;
  const { data: s } = await sb.from('conference_sessions').select('*, conference_rooms(name, max_participants, section_id)').eq('id', id).maybeSingle();
  if (!s) notFound();
  const { data: parts } = await sb.from('conference_participants').select('user_id, role, banned, banned_reason, connected_seconds, attended, profiles!conference_participants_user_id_fkey(full_name, email)').eq('session_id', id).order('role');
  const { data: templates } = await sb.from('certificate_templates').select('id, name').eq('organization_id', s.organization_id).eq('certificate_type', 'conference_attendance');
  const mine = parts?.find((p: any) => p.user_id === ctx.user.id);
  const moderator = ['organizer', 'moderator', 'teacher'].includes(mine?.role) || can(ctx, 'conferences.edit');
  const active = s.status === 'scheduled' || s.status === 'live';
  const { data: recs } = await sb.from('conference_recordings').select('id, filename, size_bytes, duration_sec, created_at, group_id, part_no').eq('session_id', id).order('created_at', { ascending: false });
  const { data: canManage } = await sb.rpc('can_manage_recordings', { p_session: id });
  const [{ data: guests }, invites] = await Promise.all([
    sb.from('conference_guests').select('id, full_name, document_type, document_number, position, institution, email, phone, created_at, joined_at, left_at, removed').eq('session_id', id).order('created_at'),
    moderator ? listInvites(id) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={s.title} subtitle={`${s.conference_rooms?.name} · ${label(s.session_type)} · ${fmtDateTime(s.scheduled_start, s.timezone)} – ${fmtDateTime(s.scheduled_end, s.timezone)} (${s.timezone})`}
        actions={<><StatusBadge status={s.status} />{active && <Link className="btn-primary" href={`/app/conferencias/sala/${id}`}>Entrar a la sala</Link>}<Link className="btn-secondary" href="/app/conferencias">Volver</Link></>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`Participantes (${parts?.length ?? 0})`} className="xl:col-span-2">
          {parts?.length ? <table className="table"><thead><tr><th>Nombre</th><th>Rol</th><th>Conectado</th><th>Asistencia</th>{moderator && active && <th></th>}</tr></thead>
            <tbody>{parts.map((p: any) => (
              <tr key={p.user_id}><td>{p.profiles?.full_name || p.profiles?.email || p.user_id}</td><td>{CONF_ROLES[p.role] ?? p.role}</td>
                <td>{Math.round(p.connected_seconds / 60)} min</td>
                <td>{p.banned ? <Badge color="red">Bloqueado</Badge> : s.status === 'ended' ? (p.attended ? <Badge color="green">Cumple</Badge> : <Badge color="amber">No cumple</Badge>) : '—'}</td>
                {moderator && active && <td>{!p.banned && p.user_id !== ctx.user.id && (
                  <ActionForm action={banParticipant} inline submitLabel="Bloquear" submitClass="btn-secondary btn-sm" confirm="¿Expulsar y bloquear a este participante?">
                    <input type="hidden" name="session_id" value={id} /><input type="hidden" name="user_id" value={p.user_id} />
                    <input name="reason" required placeholder="Motivo" className="input w-32 py-1 text-xs" />
                  </ActionForm>)}</td>}
              </tr>))}</tbody></table> : <Empty>Sin participantes registrados.</Empty>}
          {s.conference_rooms?.section_id && <p className="mt-3 text-xs text-slate-500">Los estudiantes inscritos en la sección pueden entrar sin invitación.</p>}
        </Card>
        {(moderator || (guests?.length ?? 0) > 0) && (
          <Card title={`🔗 Invitados externos (${guests?.length ?? 0})`} className="xl:order-last xl:col-span-2">
            {moderator && active && (
              <div className="mb-5 grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  {invites.length ? invites.map((i) => (
                    <div key={i.id} className="rounded-xl border border-slate-200 p-3">
                      <p className="mb-2 text-xs text-slate-500">{i.label ? `${i.label} · ` : ''}Vence {fmtDateTime(i.expires_at, s.timezone)} · {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} ingreso(s){i.allow_share ? ' · pueden compartir pantalla' : ''}{i.require_document ? ' · piden RUT/pasaporte' : ''}</p>
                      <ShareLink url={i.url} title={s.title} dark={false} />
                      <ActionForm action={revokeInvite} inline submitLabel="Desactivar enlace" submitClass="mt-2 text-xs text-red-600 hover:underline" confirm="¿Desactivar este enlace? Nadie más podrá entrar con él.">
                        <input type="hidden" name="id" value={i.id} /><input type="hidden" name="session_id" value={id} />
                      </ActionForm>
                    </div>)) : <p className="text-sm text-slate-500">Aún no hay enlaces de invitado. Cree uno para que personas sin cuenta entren con su nombre, RUT o pasaporte y cargo.</p>}
                </div>
                <ActionForm action={createInvite} submitLabel="🔗 Crear enlace de invitado">
                  <input type="hidden" name="session_id" value={id} />
                  <Field label="Nombre del enlace (opcional)" name="label" placeholder="Ej.: Apoderados, Empresa X" />
                  <SelectField label="Válido por" name="hours" defaultValue="24" options={[{ value: '2', label: '2 horas' }, { value: '24', label: '1 día' }, { value: '168', label: '1 semana' }, { value: '720', label: '30 días' }]} />
                  <Field label="Máximo de personas (opcional)" name="max_uses" type="number" min={1} max={1000} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_share" /> Pueden compartir su pantalla</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_document" defaultChecked /> Pedir RUT o pasaporte</label>
                </ActionForm>
              </div>)}
            {guests?.length ? <div className="overflow-x-auto"><table className="table" data-testid="tabla-invitados">
              <thead><tr><th>Nombre</th><th>Documento</th><th>Cargo</th><th>Institución</th><th>Contacto</th><th>Entró</th><th>Salió</th></tr></thead>
              <tbody>{guests.map((g: any) => (
                <tr key={g.id}><td>{g.full_name}{g.removed && <Badge color="red">Expulsado</Badge>}</td>
                  <td className="text-xs">{g.document_number ? `${docLabel(g.document_type).split(' ')[0]} ${g.document_number}` : '—'}</td>
                  <td>{g.position ?? '—'}</td><td>{g.institution ?? '—'}</td><td className="text-xs">{[g.email, g.phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-xs">{fmtDateTime(g.joined_at ?? g.created_at, s.timezone)}</td><td className="text-xs">{g.left_at ? fmtDateTime(g.left_at, s.timezone) : '—'}</td></tr>))}</tbody></table></div>
              : <Empty>Ningún invitado externo ha entrado todavía.</Empty>}
          </Card>)}
        <div className="space-y-6">
          <Card title={`🎬 Grabaciones (${recs?.length ?? 0})`}>
            {recs?.length ? <ul className="space-y-3">{recs.map((r: any) => (
              <li key={r.id} className="text-sm" data-testid="grabacion">
                <b>{r.filename}</b>
                <span className="block text-xs text-slate-500">{fmtDateTime(r.created_at, s.timezone)} · {(Number(r.size_bytes) / 1048576).toFixed(1)} MB{r.duration_sec ? ` · ${Math.max(1, Math.round(r.duration_sec / 60))} min` : ''}{r.part_no ? ` · parte ${r.part_no}` : ''}</span>
                <span className="mt-1 flex flex-wrap gap-2">
                  <a className="btn-secondary btn-sm" href={`/app/conferencias/grabacion/${r.id}/ver`}>▶ Ver</a>
                  {canManage && <>
                    <DownloadMenu href={`/app/conferencias/grabacion/${r.id}?descargar=1`} name={r.filename} mime={r.filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm'} />
                    <RecordingShare id={r.id} title={s.title} />
                    <a className="btn-secondary btn-sm" href={`/app/conferencias/grabacion/${r.id}/editar`}>✂ {r.group_id ? 'Unir / cortar' : 'Cortar'}</a>
                    <ActionForm action={deleteRecording} inline submitLabel="🗑" submitClass="btn-secondary btn-sm" confirm="¿Eliminar la grabación definitivamente?"><input type="hidden" name="id" value={r.id} /></ActionForm>
                  </>}
                </span>
              </li>))}</ul>
              : <Empty>{s.recording_enabled ? 'Sin grabaciones. El anfitrión graba con «⏺ Grabar» dentro de la sala.' : 'La grabación no está habilitada en esta sesión.'}</Empty>}
          </Card>
          {moderator && active && (
            <Card title="⚙️ Opciones de la sala">
              <ActionForm action={setSessionOptions} submitLabel="Guardar opciones" resetOnSuccess={false}>
                <input type="hidden" name="session_id" value={id} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="students_can_share" defaultChecked={s.students_can_share} /> Los estudiantes pueden compartir pantalla</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="chat_enabled" defaultChecked={s.chat_enabled} /> Chat habilitado para todos</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recording_enabled" defaultChecked={s.recording_enabled} /> Permitir grabar (se avisa a los participantes)</label>
              </ActionForm>
            </Card>
          )}
          {moderator && active && (
            <Card title="Invitar participante">
              <ActionForm action={addParticipant} submitLabel="Invitar">
                <input type="hidden" name="session_id" value={id} />
                <Field label="Correo (usuario de la institución)" name="email" type="email" required />
                <SelectField label="Rol" name="role" required defaultValue="attendee" options={['attendee', 'presenter', 'moderator', 'organizer'].map((v) => ({ value: v, label: { attendee: 'Asistente', presenter: 'Presentador', moderator: 'Moderador', organizer: 'Organizador' }[v]! }))} />
              </ActionForm>
            </Card>
          )}
          {moderator && active && (
            <Card title="Finalizar sesión">
              <p className="mb-3 text-sm text-slate-600">Cierra la sesión y calcula la asistencia (mínimo {s.min_attendance_pct} % del horario).</p>
              <ActionForm action={endSession} submitLabel="Finalizar" submitClass="btn-danger" confirm="¿Finalizar la sesión para todos?"><input type="hidden" name="session_id" value={id} /></ActionForm>
            </Card>
          )}
          {s.status === 'ended' && can(ctx, 'certificates.create') && !!templates?.length && (
            <Card title="Certificados de asistencia">
              <ActionForm action={issueAttendanceCertificates} submitLabel="Emitir a quienes cumplen">
                <input type="hidden" name="session_id" value={id} />
                <SelectField label="Plantilla" name="template_id" required options={templates.map((t: any) => ({ value: t.id, label: t.name }))} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
