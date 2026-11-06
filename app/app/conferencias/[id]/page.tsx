import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge, Badge } from '@/components/ui';
import { ActionForm, Field, SelectField } from '@/components/forms';
import { fmtDateTime, label, CONF_ROLES } from '@/lib/format';
import { addParticipant, banParticipant, endSession, issueAttendanceCertificates } from '../actions';

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
        <div className="space-y-6">
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
