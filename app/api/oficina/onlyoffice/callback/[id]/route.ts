import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkLinkSig, isOO, OO_MAX_BYTES, onlyofficeUrl, verifyJwt } from '@/lib/onlyoffice';

type Cb = { key?: string; status?: number; url?: string; users?: string[]; filetype?: string; forcesavetype?: number };
const ok = () => NextResponse.json({ error: 0 });
const fail = (msg: string, code = 403) => NextResponse.json({ error: 1, message: msg }, { status: code });

/**
 * Aviso de ONLYOFFICE cuando un documento cambia (estado 2: listo para guardar; 6: guardado forzado).
 * Seguridad: enlace firmado por documento + JWT del servidor ONLYOFFICE; el archivo nuevo solo se descarga
 * desde el mismo servidor ONLYOFFICE configurado (evita que se use para leer otras direcciones).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = onlyofficeUrl();
  const sp = req.nextUrl.searchParams;
  if (!base || !/^[0-9a-f-]{36}$/i.test(id) || !checkLinkSig('cb', id, sp.get('e'), sp.get('s'))) return fail('No autorizado');
  const raw = await req.json().catch(() => null) as (Cb & { token?: string }) | null;
  if (!raw) return fail('Solicitud inválida', 400);
  const header = req.headers.get('authorization');
  const fromBody = raw.token ? verifyJwt<Cb>(raw.token) : null;
  const fromHeader = !fromBody && header?.startsWith('Bearer ') ? verifyJwt<{ payload?: Cb }>(header.slice(7))?.payload ?? null : null;
  const cb = fromBody ?? fromHeader;
  if (!cb) return fail('Token inválido');
  const status = Number(cb.status);
  if (status !== 2 && status !== 6) return ok(); // 1 editando, 3/7 error de guardado, 4 cerrado sin cambios

  const admin = createAdminClient();
  const { data: d } = await admin.from('office_documents').select('id, organization_id, owner_id, shared, version, title, content, deleted_at').eq('id', id).maybeSingle();
  if (!d || d.deleted_at || !isOO(d.content)) return ok();
  if (cb.key && d.content.oo.key && cb.key !== d.content.oo.key) return ok(); // aviso de una sesión anterior
  let src: URL;
  try { src = new URL(String(cb.url)); } catch { return fail('Dirección inválida', 400); }
  if (src.origin !== new URL(base).origin) return fail('El archivo debe venir del servidor ONLYOFFICE configurado', 400);

  // ¿Quién guardó? Debe tener permiso de edición (dueño, editor invitado vigente o institución con edición)
  const uid = (cb.users ?? []).find((u) => /^[0-9a-f-]{36}$/i.test(u)) ?? null;
  let editor: string = d.owner_id;
  if (uid && uid !== d.owner_id) {
    const [{ data: share }, { data: mem }] = await Promise.all([
      admin.from('office_shares').select('permission, expires_at').eq('document_id', id).eq('grantee_id', uid).maybeSingle(),
      admin.from('memberships').select('id').eq('user_id', uid).eq('organization_id', d.organization_id).eq('status', 'active').limit(1),
    ]);
    const valid = mem?.length && ((share?.permission === 'editor' && (!share.expires_at || Date.parse(share.expires_at) > Date.now())) || d.shared === 'org_edit');
    if (!valid) return fail('Esta persona no puede editar el documento');
    editor = uid;
  }

  const res = await fetch(src, { redirect: 'error', signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return fail('No se pudo descargar el documento editado', 502);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > OO_MAX_BYTES) return fail('El documento supera 50 MB', 413);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > OO_MAX_BYTES) return fail('El documento supera 50 MB', 413);
  const ext = (cb.filetype && /^[a-z]{3,4}$/.test(cb.filetype) ? cb.filetype : d.content.oo.ext).toLowerCase();
  const path = `oficina/${d.organization_id}/${id}/${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from('user-files').upload(path, buf, { contentType: res.headers.get('content-type') ?? 'application/octet-stream', upsert: false });
  if (up.error) return fail(`Almacenamiento: ${up.error.message}`, 502);

  await admin.from('office_versions').insert({ organization_id: d.organization_id, document_id: id, version: d.version, title: d.title, content: d.content, label: status === 6 ? null : 'Sesión de ONLYOFFICE', created_by: editor });
  // Al cerrar la sesión (estado 2) cambia la clave; durante la edición (6) se mantiene para seguir coeditando
  const key = status === 2 ? crypto.randomUUID() : d.content.oo.key;
  const { error } = await admin.from('office_documents').update({ content: { oo: { path, ext, size: buf.length, key } }, updated_by: editor }).eq('id', id);
  if (error) return fail(error.message, 500);
  return ok();
}
