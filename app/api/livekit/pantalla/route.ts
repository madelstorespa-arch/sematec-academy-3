import { allowedSources, type RoomPolicy } from '@/lib/room-policy';
import { NextResponse, type NextRequest } from 'next/server';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';

/**
 * 📱 Token para compartir la pantalla del celular con la app SEMATEC Aula (Android).
 * Es una segunda conexión de la MISMA persona que solo puede publicar su pantalla:
 * no ve ni escucha la clase (eso lo hace la conexión del navegador) y vence en 15 minutos si no se usa.
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
  const auth = data as { allowed: boolean; grants?: any; expires_at?: string; role?: string };
  if (!auth.allowed) return NextResponse.json({ error: 'No tiene acceso a esta sesión.' }, { status: 403 });
  const { data: entry } = await supabase.rpc('conference_entry_check', { p_session: session });
  if (entry !== 'ok') return NextResponse.json({ error: 'Primero entre a la clase desde el navegador.' }, { status: 409 });

  // ¿Puede compartir pantalla? (rol, opción «estudiantes comparten» y configuración de la sala)
  const g = auth.grants ?? {};
  const { data: opts } = await supabase.from('conference_sessions').select('title, students_can_share, room_policy').eq('id', session).maybeSingle();
  const isMod = ['organizer', 'moderator', 'teacher'].includes(auth.role ?? '') || !!g.roomAdmin;
  let canShare = !!g.canPublish && ((g.canPublishSources ?? []) as string[]).includes('screen_share');
  if (!canShare && opts?.students_can_share && g.canPublish) canShare = true;
  if (canShare && !isMod) canShare = allowedSources((opts?.room_policy ?? {}) as RoomPolicy, [TrackSource.SCREEN_SHARE]).includes(TrackSource.SCREEN_SHARE);
  if (!canShare) return NextResponse.json({ error: 'El anfitrión no permite compartir pantalla en esta clase.' }, { status: 403 });

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const name = profile?.full_name || user.email || 'Participante';
  const left = Math.floor((new Date(auth.expires_at!).getTime() - Date.now()) / 1000);
  const at = new AccessToken(key, secret, {
    identity: `pan_${user.id}`, name: `${name} · pantalla`, ttl: Math.max(60, Math.min(left, 15 * 60)), // solo para entrar; LiveKit renueva la conexión ya abierta
    metadata: JSON.stringify({ role: auth.role, screenOf: user.id }),
  });
  at.addGrant({
    room: g.room, roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: false, canUpdateOwnMetadata: false,
    canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  });
  return NextResponse.json({ token: await at.toJwt(), url, title: opts?.title ?? 'Clase', name }, { headers: { 'Cache-Control': 'no-store' } });
}
