import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX = 5 * 1024 ** 3;

/** Autoriza subir una grabación: devuelve un enlace de subida firmado de un solo uso (el video va directo al almacenamiento privado). */
export async function POST(request: NextRequest) {
  const { session, size, mime } = await request.json().catch(() => ({}));
  if (typeof session !== 'string' || !UUID.test(session) || typeof size !== 'number' || size <= 0)
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  if (size > MAX) return NextResponse.json({ error: 'La grabación supera 5 GB.' }, { status: 413 });
  const type = String(mime ?? 'video/webm').split(';')[0];
  if (!['video/webm', 'video/mp4'].includes(type)) return NextResponse.json({ error: 'Formato no permitido' }, { status: 415 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: isMod } = await supabase.rpc('conference_is_moderator', { p_session: session });
  if (!isMod) return NextResponse.json({ error: 'Solo el anfitrión puede guardar grabaciones.' }, { status: 403 });
  const { data: s } = await supabase.from('conference_sessions').select('organization_id, recording_enabled').eq('id', session).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
  if (!s.recording_enabled) return NextResponse.json({ error: 'Esta sesión no tiene la grabación habilitada (se avisa a los participantes al entrar).' }, { status: 403 });
  const path = `${s.organization_id}/${session}/${crypto.randomUUID()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`;
  const { data, error } = await createAdminClient().storage.from('conference-recordings').createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: `El almacenamiento no está disponible: ${error?.message ?? ''}` }, { status: 502 });
  return NextResponse.json({ path, token: data.token }, { headers: { 'Cache-Control': 'no-store' } });
}
