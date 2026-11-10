import { NextResponse, type NextRequest } from 'next/server';
import { TrackSource } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';
import { roomService } from '@/lib/livekit';
import { allowedSources, MOD_ROLES, type RoomPolicy } from '@/lib/room-policy';

const UUID = /^[0-9a-f-]{36}$/i;
const IDENT = /^(inv_)?[0-9a-f-]{36}$/i; // usuarios y también invitados externos (inv_…)
const ACTIONS = new Set(['mute', 'mute_all', 'remove', 'allow_share', 'revoke_share', 'lower_hand', 'apply_policy', 'cam_off_all']);

/**
 * Controles del anfitrión (silenciar, silenciar a todos, expulsar, permitir compartir pantalla, bajar la mano).
 * Solo para moderadores verificados en la base de datos; el navegador nunca recibe credenciales de LiveKit.
 */
export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  const { session, action, identity } = b as { session?: string; action?: string; identity?: string };
  if (!session || !UUID.test(session) || !action || !ACTIONS.has(action) || (!['mute_all', 'apply_policy', 'cam_off_all'].includes(action) && (!identity || !IDENT.test(identity))))
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
    // 📱 Conexión del celular (app SEMATEC Aula) que comparte la pantalla de esa persona
    const dropPhone = async (id: string) => { try { await svc.removeParticipant(room, `pan_${id}`); } catch { /* no estaba compartiendo */ } };
    if (action === 'remove') {
      if (identity === user.id) return NextResponse.json({ error: 'No puede expulsarse a sí mismo' }, { status: 400 });
      await svc.removeParticipant(room, identity!);
      await dropPhone(identity!);
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
      if (action === 'revoke_share') await dropPhone(identity!);
    } else if (action === 'apply_policy') {
      // ⚙ Aplica la configuración de la sala a quienes ya están conectados (no a los anfitriones)
      const { data: ss } = await supabase.from('conference_sessions').select('room_policy').eq('id', session).maybeSingle();
      const policy = (ss?.room_policy ?? {}) as RoomPolicy;
      const all = await svc.listParticipants(room);
      for (const p of all) {
        let role = ''; try { role = JSON.parse(p.metadata || '{}').role ?? ''; } catch { /* */ }
        if (p.identity.startsWith('pan_')) {
          // Pantalla desde el celular: se corta si ya no se permite compartir a esa persona
          const owner = all.find((x) => x.identity === p.identity.slice(4));
          if (!MOD_ROLES.has(role) && policy.share === false && owner?.attributes?.share !== '1') await dropPhone(p.identity.slice(4));
          continue;
        }
        if (MOD_ROLES.has(role) || p.identity === user.id) continue;
        const sharing = p.attributes?.share === '1';
        const base = [TrackSource.CAMERA, TrackSource.MICROPHONE, ...(sharing || policy.share ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [])];
        const next = allowedSources(sharing ? { ...policy, share: true } : policy, base);
        await svc.updateParticipant(room, p.identity, { permission: { canSubscribe: true, canPublish: true, canPublishData: true, canUpdateMetadata: true, canPublishSources: next } });
        for (const t of p.tracks) {
          const blocked = (t.source === TrackSource.MICROPHONE && policy.mic === false) || (t.source === TrackSource.CAMERA && policy.camera === false);
          if (blocked && !t.muted) await svc.mutePublishedTrack(room, p.identity, t.sid, true);
        }
      }
    } else if (action === 'cam_off_all') {
      for (const p of (await svc.listParticipants(room)).filter((x) => x.identity !== user.id))
        for (const t of p.tracks) if (t.source === TrackSource.CAMERA && !t.muted) await svc.mutePublishedTrack(room, p.identity, t.sid, true);
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
