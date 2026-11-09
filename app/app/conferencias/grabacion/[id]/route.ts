import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Ver o descargar una grabación: verifica el acceso (RLS) y redirige a un enlace firmado que dura 1 hora. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: r } = await supabase.from('conference_recordings').select('storage_bucket, storage_path, filename').eq('id', id).maybeSingle();
  if (!r?.storage_path) return new NextResponse('No encontrado', { status: 404 });
  const download = req.nextUrl.searchParams.has('descargar');
  const { data, error } = await createAdminClient().storage.from(r.storage_bucket).createSignedUrl(r.storage_path, 3600, download ? { download: r.filename || true } : undefined);
  if (error || !data) return new NextResponse('Grabación no disponible', { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
