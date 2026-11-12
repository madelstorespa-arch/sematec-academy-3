import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkLinkSig, isOO, OO_EXT, onlyofficeEnabled, verifyJwt } from '@/lib/onlyoffice';

/**
 * El servidor ONLYOFFICE descarga aquí el archivo a editar. Requiere un enlace firmado y vigente
 * (y, si ONLYOFFICE lo envía, su JWT en la cabecera Authorization).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams; const p = sp.get('p') ?? '';
  if (!onlyofficeEnabled() || !/^[0-9a-f-]{36}$/i.test(id) || !checkLinkSig('file', id, sp.get('e'), sp.get('s'), p)) return new NextResponse('No autorizado', { status: 403 });
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && !verifyJwt(auth.slice(7))) return new NextResponse('Token inválido', { status: 403 });
  const admin = createAdminClient();
  const { data: d } = await admin.from('office_documents').select('organization_id, content, deleted_at').eq('id', id).maybeSingle();
  if (!d || d.deleted_at || !p.startsWith(`oficina/${d.organization_id}/${id}/`)) return new NextResponse('No encontrado', { status: 404 });
  // Solo el archivo actual o uno del historial de este mismo documento
  const cur = isOO(d.content) ? d.content.oo.path : null;
  if (p !== cur) {
    const { data: v } = await admin.from('office_versions').select('id').eq('document_id', id).filter('content->oo->>path', 'eq', p).limit(1);
    if (!v?.length) return new NextResponse('No encontrado', { status: 404 });
  }
  const { data: blob, error } = await admin.storage.from('user-files').download(p);
  if (error || !blob) return new NextResponse('No disponible', { status: 404 });
  const ext = p.split('.').pop() ?? '';
  return new NextResponse(blob, { headers: { 'Content-Type': OO_EXT[ext]?.mime ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
