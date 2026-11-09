import 'server-only';
import { RoomServiceClient } from 'livekit-server-sdk';

/** Cliente de administración de salas LiveKit (solo servidor). */
export function roomService() {
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, NEXT_PUBLIC_LIVEKIT_URL: url } = process.env;
  if (!key || !secret || !url) throw new Error('El servicio de videoconferencia no está configurado (LIVEKIT_*).');
  return new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret);
}
