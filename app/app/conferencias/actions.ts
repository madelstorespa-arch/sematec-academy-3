'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { tzOffset } from '@/lib/format';

const refresh = () => revalidatePath('/app/conferencias', 'layout');

export async function createRoom(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('conference_rooms').insert({
      organization_id: ctx.orgId, name: reqStr(fd, 'name', 'Nombre'), room_type: reqStr(fd, 'room_type', 'Tipo'),
      section_id: str(fd, 'section_id'), campus_id: str(fd, 'campus_id'), max_participants: num(fd, 'max_participants') ?? 150, created_by: ctx.user.id,
    });
    if (error) return fail(error);
    refresh();
    return ok('Sala creada.');
  });
}

export async function createSession(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const tz = reqStr(fd, 'timezone', 'Zona horaria');
    const date = reqStr(fd, 'date', 'Fecha');
    const at = (t: string) => `${date}T${t}:00${tzOffset(tz, new Date(`${date}T12:00:00Z`))}`;
    const { error } = await ctx.supabase.rpc('create_conference_session', {
      p_room: reqStr(fd, 'room_id', 'Sala'), p_title: reqStr(fd, 'title', 'Título'), p_type: reqStr(fd, 'session_type', 'Tipo'),
      p_start: at(reqStr(fd, 'start', 'Inicio')), p_end: at(reqStr(fd, 'end', 'Término')), p_timezone: tz,
      p_recording: fd.get('recording') === 'on', p_class_session: str(fd, 'class_session_id'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Sesión programada.');
  });
}

export async function addParticipant(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('add_conference_participant_by_email', {
      p_session: reqStr(fd, 'session_id', 'Sesión'), p_email: reqStr(fd, 'email', 'Correo'), p_role: reqStr(fd, 'role', 'Rol'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Participante agregado.');
  });
}

export async function banParticipant(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('ban_conference_participant', {
      p_session: reqStr(fd, 'session_id', 'Sesión'), p_user: reqStr(fd, 'user_id', 'Usuario'), p_reason: reqStr(fd, 'reason', 'Motivo'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Participante bloqueado. No podrá volver a ingresar a esta sesión.');
  });
}

export async function endSession(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('end_conference_session', { p_session: reqStr(fd, 'session_id', 'Sesión') });
    if (error) return fail(error);
    refresh();
    return ok('Sesión finalizada; asistencia calculada.');
  });
}

export async function issueAttendanceCertificates(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const session = reqStr(fd, 'session_id', 'Sesión');
    const template = reqStr(fd, 'template_id', 'Plantilla');
    const { data: parts } = await ctx.supabase.from('conference_participants').select('user_id').eq('session_id', session).eq('attended', true);
    let n = 0; const errors: string[] = [];
    for (const p of parts ?? []) {
      const { error } = await ctx.supabase.rpc('issue_certificate', { p_template: template, p_conference_session: session, p_recipient_user: p.user_id });
      if (error) errors.push(error.message); else n++;
    }
    refresh();
    return errors.length ? fail(`${n} emitidos; ${errors.length} con error: ${errors[0]}`) : ok(`${n} certificados de asistencia emitidos.`);
  });
}
