import { TrackSource } from 'livekit-server-sdk';

/** Configuración de la sala definida por el anfitrión (si una opción no está, se permite). */
export type RoomPolicy = { mic?: boolean; camera?: boolean; share?: boolean; chat?: boolean; private_chat?: boolean; reactions?: boolean; rename?: boolean };
export const MOD_ROLES = new Set(['organizer', 'moderator', 'teacher']);

/** Qué puede transmitir un participante (no moderador) según la configuración de la sala. */
export function allowedSources(policy: RoomPolicy, base: TrackSource[]): TrackSource[] {
  let s = [...new Set(base)];
  if (policy.mic === false) s = s.filter((x) => x !== TrackSource.MICROPHONE);
  if (policy.camera === false) s = s.filter((x) => x !== TrackSource.CAMERA);
  if (policy.share === true) s = [...new Set([...s, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO])];
  if (policy.share === false) s = s.filter((x) => x !== TrackSource.SCREEN_SHARE && x !== TrackSource.SCREEN_SHARE_AUDIO);
  return s;
}
