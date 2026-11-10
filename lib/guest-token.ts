import 'server-only';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { allowedSources } from '@/lib/room-policy';

/** Firma el acceso temporal de un invitado externo a SU sala (y nada más). */
export async function issueGuestToken(guestId: string) {
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, NEXT_PUBLIC_LIVEKIT_URL: url } = process.env;
  if (!key || !secret || !url) throw new Error('El servicio de videoconferencia no está configurado.');
  const admin = createAdminClient();
  const { data: g } = await admin.from('conference_guests')
    .select('id, full_name, position, institution, removed, session_id, conference_invites(allow_share), conference_sessions(livekit_room_name, scheduled_end, title, chat_enabled, organization_id, room_policy)')
    .eq('id', guestId).maybeSingle();
  if (!g || g.removed) throw new Error('Acceso no disponible.');
  const s = g.conference_sessions as any, inv = g.conference_invites as any;
  const end = Math.min(new Date(s.scheduled_end).getTime() + 60 * 60000, Date.now() + 3 * 3600000);
  const at = new AccessToken(key, secret, {
    identity: `inv_${g.id}`, name: `${g.full_name} (invitado)`, ttl: Math.max(60, Math.floor((end - Date.now()) / 1000)),
    metadata: JSON.stringify({ role: 'guest', cargo: g.position || undefined, inst: g.institution || undefined }),
  });
  at.addGrant({
    room: s.livekit_room_name, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: true,
    canPublishSources: allowedSources({ ...(s.room_policy ?? {}), share: inv?.allow_share ? (s.room_policy?.share ?? true) : false },
      [TrackSource.CAMERA, TrackSource.MICROPHONE, ...(inv?.allow_share ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [])]),
  });
  return { token: await at.toJwt(), url, role: 'guest', moderator: false, title: s.title, sessionId: g.session_id, orgId: s.organization_id, chat: s.chat_enabled ?? true };
}
