import { NextResponse, type NextRequest } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { createAdminClient } from '@/lib/supabase/admin';

/** Webhook de LiveKit: firma verificada; registra entradas/salidas y cierre (VID-008/016). */
export async function POST(request: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) return NextResponse.json({ error: 'no configurado' }, { status: 503 });
  const body = await request.text();
  let event;
  try {
    event = await new WebhookReceiver(key, secret).receive(body, request.headers.get('authorization') ?? undefined);
  } catch {
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 });
  }
  const handled = ['room_started', 'room_finished', 'participant_joined', 'participant_left'];
  if (!event.room?.name?.startsWith('sg_') || !handled.includes(event.event)) return NextResponse.json({ ok: true, ignored: true });
  const identity = event.participant?.identity;
  const { error } = await createAdminClient().rpc('record_conference_event', {
    p_room_name: event.room.name, p_event: event.event,
    p_user: identity && /^[0-9a-f-]{36}$/.test(identity) ? identity : null,
    p_participant_sid: event.participant?.sid ?? null,
    p_at: new Date(Number(event.createdAt ?? BigInt(Math.floor(Date.now() / 1000))) * 1000).toISOString(),
    p_event_id: event.id, p_payload: JSON.parse(body),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
