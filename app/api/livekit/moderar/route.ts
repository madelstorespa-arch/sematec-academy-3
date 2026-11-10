import { NextResponse, type NextRequest } from 'next/server';
import { TrackSource } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';
import { roomService } from '@/lib/livekit';

const UUID = /^[0-9a-f-]{36}$/i;
const IDENT = /^(inv_)?[0-9a-f-]{36}$/i; // usuarios y también invitados externos (inv_…)
const ACTIONS = new Set(['mute', 'mute_all', 'remove', 'allow_share', 'revoke_share', 'lower_hand']);

/**
 * Controles del anfitrión (silenciar, silenciar a todos, expulsar, permitir compartir pantalla, bajar la mano).
 * Solo para moderadores verificados en la base de datos; el navegador nunca recibe credenciales de LiveKit.
 */
export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  const { session, action, identity } = b as { session?: string; action?: string; identity?: string };
  if (!session || !UUID.test(session) || !action || !ACTIONS.has(action) || (action !== 'mute_all' && (!identity || !IDENT.test(identity))))
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: isMod } = await supabase.rpc('conference_is_moderator', { p_session: session });
  if (!isMod) return NextResponse.json({ error: 'Solo el anfitrión o un moderador puede hacer esto.' }, { status: 403 });
  const { data: s } = await supabase.from('conference_sessions').select('livekit_room_name').eq('id', session).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
  const room = s.livekit_room_name;
  try {
    const svc = roomService();
    if (action === 'remove') {
      if (identity === user.id) return NextResponse.json({ error: 'No puede expulsarse a sí mismo' }, { status: 400 });
      await svc.removeParticipant(room, identity!);
      if (identity!.startsWith('inv_')) await supabase.rpc('remove_conference_guest', { p_guest: identity!.slice(4) });
    } else if (action === 'mute' || action === 'mute_all') {
      const list = action === 'mute' ? [await svc.getParticipant(room, identity!)] : (await svc.listParticipants(room)).filter((p) => p.identity !== user.id);
      for (const p of list) for (const t of p.tracks) if (t.source === TrackSource.MICROPHONE && !t.muted) await svc.mutePublishedTrack(room, p.identity, t.sid, true);
    } else if (action === 'allow_share' || action === 'revoke_share') {
      const p = await svc.getParticipant(room, identity!);
      const base = [TrackSource.CAMERA, TrackSource.MICROPHONE];
      await svc.updateParticipant(room, identity!, {
        permission: {
          canSubscribe: true, canPublish: true, canPublishData: true, canUpdateMetadata: true,
          canPublishSources: action === 'allow_share' ? [...base, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : base,
        },
        attributes: { ...(p.attributes ?? {}), share: action === 'allow_share' ? '1' : '' },
      });
    } else if (action === 'lower_hand') {
      const p = await svc.getParticipant(room, identity!);
      await svc.updateParticipant(room, identity!, { attributes: { ...(p.attributes ?? {}), hand: '' } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[moderar]', e);
    return NextResponse.json({ error: 'No se pudo completar la acción en la sala.' }, { status: 502 });
  }
}
