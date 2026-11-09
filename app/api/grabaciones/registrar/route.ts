import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID = /^[0-9a-f-]{36}$/i;

/** Registra la grabación ya subida (verifica que el archivo exista y pertenezca a la sesión). */
export async function POST(request: NextRequest) {
  const { session, path, size, duration, filename, visibility, group, part, source } = await request.json().catch(() => ({}));
  if (typeof session !== 'string' || !UUID.test(session) || typeof path !== 'string') return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: allowed } = await supabase.rpc('can_manage_recordings', { p_session: session });
  if (!allowed) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  if (typeof source === 'string' && UUID.test(source)) {
    const { data: src } = await supabase.from('conference_recordings').select('session_id').eq('id', source).maybeSingle();
    if (src?.session_id !== session) return NextResponse.json({ error: 'Grabación de origen inválida' }, { status: 400 });
  }
  const { data: s } = await supabase.from('conference_sessions').select('organization_id, title').eq('id', session).maybeSingle();
  if (!s || !path.startsWith(`${s.organization_id}/${session}/`) || path.includes('..')) return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 });
  const admin = createAdminClient();
  const probe = await admin.storage.from('conference-recordings').createSignedUrl(path, 30);
  if (probe.error) return NextResponse.json({ error: 'El archivo no llegó al almacenamiento. Intente subirlo de nuevo.' }, { status: 409 });
  const { data, error } = await admin.from('conference_recordings').insert({
    organization_id: s.organization_id, session_id: session, storage_bucket: 'conference-recordings', storage_path: path,
    status: 'available', visibility: visibility === 'staff' ? 'staff' : 'participants', size_bytes: Math.max(1, Math.round(Number(size) || 1)),
    duration_sec: Number.isFinite(duration) ? Math.round(duration) : null, ended_at: new Date().toISOString(),
    filename: String(filename || `Grabación - ${s.title}.webm`).replace(/[^\w .()áéíóúñÁÉÍÓÚÑ-]/g, '_').slice(0, 150),
    mime_type: path.endsWith('.mp4') ? 'video/mp4' : 'video/webm', created_by: user.id,
    group_id: typeof group === 'string' && UUID.test(group) ? group : null,
    part_no: Number.isInteger(part) && part > 0 && part < 10000 ? part : null,
    source_id: typeof source === 'string' && UUID.test(source) ? source : null,
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
