import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { OO_EXT, OO_MAX_BYTES, onlyofficeEnabled } from '@/lib/onlyoffice';

/** Paso 2: el archivo ya subido pasa a ser el contenido del documento (la versión anterior queda en el historial). */
export async function POST(req: NextRequest) {
  if (!onlyofficeEnabled()) return NextResponse.json({ error: 'ONLYOFFICE no está activo en esta plataforma.' }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? ''); const path = String(b.path ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: access } = await supabase.rpc('office_my_access', { p_doc: id });
  if (access !== 'owner' && access !== 'editor') return NextResponse.json({ error: 'No tiene permiso para editar este documento.' }, { status: 403 });
  const { data: d } = await supabase.from('office_documents').select('id, organization_id, version, title, content').eq('id', id).maybeSingle();
  if (!d) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  const m = path.match(new RegExp(`^oficina/${d.organization_id}/${d.id}/[0-9a-f-]{36}\\.([a-z]{3,4})$`));
  if (!m || !OO_EXT[m[1]]) return NextResponse.json({ error: 'Archivo inválido' }, { status: 400 });
  const admin = createAdminClient();
  const dir = path.slice(0, path.lastIndexOf('/')); const name = path.slice(path.lastIndexOf('/') + 1);
  const { data: list } = await admin.storage.from('user-files').list(dir, { search: name, limit: 1 });
  const obj = list?.find((o) => o.name === name);
  const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0);
  if (!obj) return NextResponse.json({ error: 'El archivo no se subió.' }, { status: 400 });
  if (size > OO_MAX_BYTES) { await admin.storage.from('user-files').remove([path]); return NextResponse.json({ error: 'El archivo supera 50 MB.' }, { status: 413 }); }
  const old = d.content as Record<string, unknown> | null;
  if (old && !old.importing && Object.keys(old).length) {
    await supabase.from('office_versions').insert({ organization_id: d.organization_id, document_id: d.id, version: d.version, title: d.title, content: old, label: 'Antes de abrir en ONLYOFFICE' });
  }
  const { error } = await supabase.from('office_documents').update({ content: { oo: { path, ext: m[1], size, key: crypto.randomUUID() } } }).eq('id', d.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true, id: d.id });
}
