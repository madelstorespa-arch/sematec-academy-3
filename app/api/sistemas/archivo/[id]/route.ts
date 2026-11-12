import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Descargar un adjunto de un registro de sistema (solo quien puede ver el registro). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const { data: f } = await supabase.from('custom_record_files').select('path, name').eq('id', id).maybeSingle();
  if (!f) return new NextResponse('No encontrado', { status: 404 });
  const { data } = await createAdminClient().storage.from('user-files').createSignedUrl(f.path, 120, { download: f.name });
  if (!data?.signedUrl) return new NextResponse('No disponible', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
