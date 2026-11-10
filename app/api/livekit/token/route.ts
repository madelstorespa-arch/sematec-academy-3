import { NextResponse, type NextRequest } from 'next/server';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';

const SOURCES: Record<string, TrackSource> = {
  camera: TrackSource.CAMERA, microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE, screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

/**
 * Emite un token LiveKit temporal SOLO si la base de datos autoriza el ingreso
 * (membresía, invitación, bloqueo, horario, capacidad y rol: VID-004/005/007/015).
 */
export async function POST(request: NextRequest) {
  const { session } = await request.json().catch(() => ({}));
  if (typeof session !== 'string' || !/^[0-9a-f-]{36}$/.test(session)) return NextResponse.json({ error: 'Sesión inválida' }, { status: 400 });
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, NEXT_PUBLIC_LIVEKIT_URL: url } = process.env;
  if (!key || !secret || !url) return NextResponse.json({ error: 'El servicio de videoconferencia no está configurado (LIVEKIT_*).' }, { status: 503 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data, error } = await supabase.rpc('authorize_conference_join', { p_session: session });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const auth = data as { allowed: boolean; reason?: string; grants?: any; expires_at?: string; role?: string };
  if (!auth.allowed) {
    const reasons: Record<string, string> = {
      not_member: 'No pertenece a la institución de esta sala.', banned: 'Fue bloqueado por el moderador de esta sesión.',
      not_invited: 'No está invitado a esta sesión.', too_early: 'La sala abre 15 minutos antes del inicio.',
      expired: 'La sesión ya terminó.', session_ended: 'La sesión ya terminó.', session_cancelled: 'La sesión fue cancelada.',
      room_full: 'La sala alcanzó su capacidad máxima.', account_inactive: 'Su cuenta no está activa.', not_found: 'La sesión no existe.',
    };
    return NextResponse.json({ error: reasons[auth.reason ?? ''] ?? 'Acceso denegado' }, { status: 403 });
  }
  // Sala bloqueada o sala de espera (el anfitrión siempre entra)
  const { data: entry } = await supabase.rpc('conference_entry_check', { p_session: session });
  if (entry === 'waiting') return NextResponse.json({ waiting: true, message: 'Esperando que el anfitrión lo admita…' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  if (entry === 'locked') return NextResponse.json({ error: '🔒 El anfitrión bloqueó la sala: no pueden entrar más personas.' }, { status: 423 });
  if (entry === 'rejected') return NextResponse.json({ error: 'El anfitrión no admitió su ingreso a esta sesión.' }, { status: 403 });
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const ttl = Math.max(60, Math.floor((new Date(auth.expires_at!).getTime() - Date.now()) / 1000));
  const at = new AccessToken(key, secret, { identity: user.id, name: profile?.full_name || user.email || 'Participante', ttl, metadata: JSON.stringify({ role: auth.role }) });
  const g = auth.grants;
  // Opción de la sesión: los estudiantes también pueden compartir pantalla
  const { data: opts } = await supabase.from('conference_sessions').select('students_can_share').eq('id', session).maybeSingle();
  const sources: string[] = [...(g.canPublishSources ?? [])];
  if (opts?.students_can_share && g.canPublish && !sources.includes('screen_share')) sources.push('screen_share', 'screen_share_audio');
  at.addGrant({
    room: g.room, roomJoin: true, roomAdmin: !!g.roomAdmin, roomRecord: !!g.roomRecord,
    canSubscribe: !!g.canSubscribe, canPublish: !!g.canPublish, canPublishData: !!g.canPublishData,
    canUpdateOwnMetadata: true, // levantar la mano (atributo propio)
    canPublishSources: sources.map((s: string) => SOURCES[s]).filter((s: TrackSource | undefined) => s !== undefined),
  });
  const moderator = ['organizer', 'moderator', 'teacher'].includes(auth.role ?? '') || !!g.roomAdmin;
  return NextResponse.json({ token: await at.toJwt(), url, role: auth.role, moderator }, { headers: { 'Cache-Control': 'no-store' } });
}
