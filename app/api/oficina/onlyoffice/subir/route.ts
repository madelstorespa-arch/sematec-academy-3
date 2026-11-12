import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { OO_EXT, OO_MAX_BYTES, onlyofficeEnabled } from '@/lib/onlyoffice';

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/**
 * Paso 1 para editar un archivo con ONLYOFFICE: autoriza subirlo directo al almacenamiento privado.
 * - Documento existente (id): solo el dueño o un editor.
 * - Documento nuevo (org + título): se crea a nombre de la persona.
 */
export async function POST(req: NextRequest) {
  if (!onlyofficeEnabled()) return NextResponse.json({ error: 'ONLYOFFICE no está activo en esta plataforma.' }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const ext = String(b.ext ?? '').toLowerCase(); const size = Number(b.size);
  if (!OO_EXT[ext]) return NextResponse.json({ error: 'Formato no compatible con ONLYOFFICE.' }, { status: 415 });
  if (!(size > 0) || size > OO_MAX_BYTES) return NextResponse.json({ error: 'El archivo supera 50 MB.' }, { status: 413 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  let id: string; let org: string;
  if (uuid(b.id)) {
    const { data: access } = await supabase.rpc('office_my_access', { p_doc: b.id });
    if (access !== 'owner' && access !== 'editor') return NextResponse.json({ error: 'No tiene permiso para editar este documento.' }, { status: 403 });
    const { data: d } = await supabase.from('office_documents').select('id, organization_id').eq('id', b.id).maybeSingle();
    if (!d) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    id = d.id; org = d.organization_id;
  } else {
    if (!uuid(b.org)) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
    const { data, error } = await supabase.from('office_documents').insert({
      organization_id: b.org, owner_id: user.id, kind: OO_EXT[ext].kind, title: String(b.title ?? 'Documento').slice(0, 200) || 'Documento',
      content: { importing: true }, folder_id: uuid(b.folder) ? b.folder : null,
    }).select('id, organization_id').single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'No se pudo crear el documento' }, { status: 403 });
    id = data.id; org = data.organization_id;
  }
  const path = `oficina/${org}/${id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('user-files').createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: `El almacenamiento no está disponible: ${error?.message ?? ''}` }, { status: 502 });
  return NextResponse.json({ id, path, token: data.token, mime: OO_EXT[ext].mime }, { headers: { 'Cache-Control': 'no-store' } });
}
