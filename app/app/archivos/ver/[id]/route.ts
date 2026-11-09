import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Ver o descargar un archivo: verifica el acceso (RLS) y redirige a un enlace firmado de 1 hora. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: f } = await supabase.from('user_files').select('storage_path, name').eq('id', id).maybeSingle();
  if (!f) return new NextResponse('No encontrado', { status: 404 });
  const download = req.nextUrl.searchParams.has('descargar');
  const { data, error } = await createAdminClient().storage.from('user-files').createSignedUrl(f.storage_path, 3600, download ? { download: f.name } : undefined);
  if (error || !data) return new NextResponse('Archivo no disponible', { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
