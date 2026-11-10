import { NextResponse, type NextRequest } from 'next/server';
import { AccessToken, DataPacket_Kind, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';
import { roomService } from '@/lib/livekit';

const IDENT = /^(inv_)?[0-9a-f-]{36}$/i;
const enc = new TextEncoder();

/**
 * 👥 Salas de grupos (como en Zoom): el anfitrión reparte a los participantes en grupos, les envía un mensaje,
 * visita cada grupo y luego los hace volver a todos a la sala principal.
 */
export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  const { session, action } = b as { session?: string; action?: string };
  if (!session || !/^[0-9a-f-]{36}$/.test(session) || !['open', 'end', 'message', 'visit'].includes(action ?? '')) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, NEXT_PUBLIC_LIVEKIT_URL: url } = process.env;
  if (!key || !secret || !url) return NextResponse.json({ error: 'El servicio de videoconferencia no está configurado.' }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: isMod } = await supabase.rpc('conference_is_moderator', { p_session: session });
  if (!isMod) return NextResponse.json({ error: 'Solo el anfitrión o un moderador puede manejar los grupos.' }, { status: 403 });
  const { data: s } = await supabase.from('conference_sessions').select('livekit_room_name, breakout_groups, scheduled_end').eq('id', session).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
  const main = s.livekit_room_name as string;
  const svc = roomService();
  const ttl = Math.max(600, Math.floor((new Date(s.scheduled_end).getTime() + 3600000 - Date.now()) / 1000));
  const tokenFor = async (identity: string, name: string, metadata: string, group: number, admin = false) => {
    const at = new AccessToken(key, secret, { identity, name, ttl, metadata });
    at.addGrant({ room: `${main}-g${group}`, roomJoin: true, roomAdmin: admin, canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: true,
      // En los grupos todos pueden mostrar su pantalla para trabajar juntos (los invitados externos, solo cámara y micrófono)
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, ...(identity.startsWith('inv_') ? [] : [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO])] });
    return at.toJwt();
  };
  const send = (room: string, payload: unknown, to?: string[]) =>
    svc.sendData(room, enc.encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, { topic: 'grupos', destinationIdentities: to });

  try {
    if (action === 'open') {
      const groups = (b.groups ?? {}) as Record<string, number>;
      const entries = Object.entries(groups).filter(([id, n]) => IDENT.test(id) && Number.isInteger(n) && n >= 1 && n <= 50);
      if (!entries.length) return NextResponse.json({ error: 'Asigne al menos una persona a un grupo.' }, { status: 400 });
      const people = new Map((await svc.listParticipants(main)).map((p) => [p.identity, p]));
      let sent = 0;
      for (const [identity, n] of entries) {
        const p = people.get(identity);
        if (!p) continue;
        await send(main, { t: 'go', group: n, url, token: await tokenFor(identity, p.name || 'Participante', p.metadata || '{}', n) }, [identity]);
        sent++;
      }
      const total = Math.max(...entries.map(([, n]) => n));
      await supabase.rpc('conference_set_groups', { p_session: session, p_groups: total });
      return NextResponse.json({ ok: true, sent, groups: total });
    }
    if (action === 'visit') {
      const n = Number(b.group);
      if (!Number.isInteger(n) || n < 1 || n > Math.max(1, s.breakout_groups)) return NextResponse.json({ error: 'Grupo inválido' }, { status: 400 });
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      return NextResponse.json({ token: await tokenFor(user.id, `${profile?.full_name || 'Anfitrión'} (anfitrión)`, JSON.stringify({ role: 'moderator' }), n, true), url, role: 'moderator', moderator: true, group: n });
    }
    const n = Math.max(1, s.breakout_groups);
    if (action === 'message') {
      const text = String(b.text ?? '').slice(0, 300).trim();
      if (!text) return NextResponse.json({ error: 'Escriba el mensaje.' }, { status: 400 });
      for (let g = 1; g <= n; g++) await send(`${main}-g${g}`, { t: 'msg', text }).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    // end: todos vuelven a la sala principal
    for (let g = 1; g <= n; g++) await send(`${main}-g${g}`, { t: 'back' }).catch(() => {});
    await supabase.rpc('conference_set_groups', { p_session: session, p_groups: 0 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[grupos]', e);
    return NextResponse.json({ error: 'No se pudo completar la acción en la sala.' }, { status: 502 });
  }
}
