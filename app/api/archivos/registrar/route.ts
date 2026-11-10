import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FILE_TYPES } from '@/lib/user-files';

/** Registra el archivo ya subido (verifica que exista y que sea del usuario). */
export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => ({}));
  const { org, path, name, size, mime, visibility, section, description, folder } = b ?? {};
  if (typeof org !== 'string' || typeof path !== 'string' || typeof name !== 'string') return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  const type = String(mime ?? '').split(';')[0].toLowerCase();
  if (!FILE_TYPES[type]) return NextResponse.json({ error: 'Tipo no permitido' }, { status: 415 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!path.startsWith(`${org}/${user.id}/`) || path.includes('..')) return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 });
  const probe = await createAdminClient().storage.from('user-files').createSignedUrl(path, 30);
  if (probe.error) return NextResponse.json({ error: 'El archivo no llegó al almacenamiento. Intente de nuevo.' }, { status: 409 });
  const vis = ['private', 'section', 'staff', 'org'].includes(visibility) ? visibility : 'private';
  const { data, error } = await supabase.rpc('register_user_file', {
    p_org: org, p_name: name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200), p_mime: type, p_size: Math.max(1, Math.round(Number(size) || 1)), p_path: path,
    p_visibility: vis, p_section: vis === 'section' ? section : null, p_description: typeof description === 'string' ? description.slice(0, 2000) : null,
  });
  if (error) {
    await createAdminClient().storage.from('user-files').remove([path]); // no deja archivos huérfanos
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // 📂 Si se subió dentro de una carpeta, queda guardado ahí
  if (typeof folder === 'string' && /^[0-9a-f-]{36}$/i.test(folder)) await supabase.rpc('move_user_file', { p_id: data, p_folder: folder });
  return NextResponse.json({ id: data });
}
