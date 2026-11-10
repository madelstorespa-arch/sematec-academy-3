import { NextResponse, type NextRequest } from 'next/server';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkDocument } from '@/lib/identity';

const REASONS: Record<string, string> = {
  not_found: 'El enlace no existe. Pida uno nuevo a quien lo invitó.', revoked: 'El enlace fue desactivado por el anfitrión.',
  expired: 'El enlace venció. Pida uno nuevo a quien lo invitó.', ended: 'La clase o reunión ya terminó.',
  full: 'El enlace alcanzó el máximo de personas.', too_early: 'La sala abre 15 minutos antes del inicio. Vuelva a intentar más tarde.',
  room_full: 'La sala alcanzó su capacidad máxima.', name: 'Escriba su nombre completo.', document: 'Ingrese su RUT o pasaporte.',
};
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '');

/**
 * Ingreso de invitados externos (sin cuenta) con el enlace del anfitrión: registra nombre, documento, cargo e institución
 * y entrega un acceso temporal SOLO a esa sala. Limitado por IP.
 */
export async function POST(request: NextRequest) {
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, NEXT_PUBLIC_LIVEKIT_URL: url } = process.env;
  if (!key || !secret || !url) return NextResponse.json({ error: 'El servicio de videoconferencia no está configurado.' }, { status: 503 });
  const b = await request.json().catch(() => ({}));
  const token = txt(b.token, 64);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: REASONS.not_found }, { status: 404 });
  const name = txt(b.name, 120).replace(/\s+/g, ' ');
  if (name.length < 3 || !/\p{L}/u.test(name)) return NextResponse.json({ error: REASONS.name }, { status: 400 });
  const email = txt(b.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'El correo no es válido.' }, { status: 400 });
  if (b.consent !== true) return NextResponse.json({ error: 'Debe aceptar el uso de sus datos para el registro de asistencia.' }, { status: 400 });

  const admin = createAdminClient();
  const h = request.headers;
  const ip = (h.get('x-real-ip') ?? (h.get('x-forwarded-for') ?? '').split(',').pop() ?? '').trim();
  const validIp = /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : null;
  const { data: limited } = await admin.rpc('guest_rate_limited', { p_key: validIp ?? 'sin-ip', p_max: 20 });
  if (limited) return NextResponse.json({ error: 'Demasiados intentos desde esta conexión. Espere unos minutos.' }, { status: 429 });

  const { data: info } = await admin.rpc('guest_invite_info', { p_token: token });
  if (!info?.valid) return NextResponse.json({ error: REASONS[info?.reason ?? 'not_found'] ?? 'No se puede entrar con este enlace.' }, { status: 403 });
  const doc = checkDocument(txt(b.doc_type, 20) || null, txt(b.doc_number, 30) || null, !!info.require_document);
  if (!doc.ok) return NextResponse.json({ error: doc.error }, { status: 400 });

  const cargo = txt(b.cargo, 120), inst = txt(b.institution, 160);
  const { data: j, error } = await admin.rpc('guest_join', {
    p_token: token, p_name: name, p_doc_type: doc.type ?? '', p_doc_number: doc.number ?? '', p_position: cargo, p_institution: inst,
    p_email: email, p_phone: txt(b.phone, 40), p_ip: validIp, p_ua: txt(h.get('user-agent'), 300),
  });
  if (error) { console.error('[invitado]', error.message); return NextResponse.json({ error: 'No se pudo registrar su ingreso.' }, { status: 500 }); }
  if (!j?.allowed) return NextResponse.json({ error: REASONS[j?.reason] ?? 'Acceso denegado.' }, { status: 403 });

  const ttl = Math.max(60, Math.floor((new Date(j.expires_at).getTime() - Date.now()) / 1000));
  const at = new AccessToken(key, secret, {
    identity: `inv_${j.guest_id}`, name: `${name} (invitado)`, ttl,
    metadata: JSON.stringify({ role: 'guest', cargo: cargo || undefined, inst: inst || undefined }),
  });
  at.addGrant({
    room: j.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: true,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, ...(j.allow_share ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [])],
  });
  return NextResponse.json({ token: await at.toJwt(), url, role: 'guest', moderator: false, title: j.title, sessionId: j.session_id, orgId: j.org_id, chat: j.chat },
    { headers: { 'Cache-Control': 'no-store' } });
}
