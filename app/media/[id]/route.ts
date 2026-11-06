import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/** Sirve imágenes guardadas en la base de datos (logo, cursos, fotos de perfil). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse(null, { status: 404 });
  const { data } = await createAdminClient().from('media_assets').select('mime_type, bytes, is_public').eq('id', id).maybeSingle();
  if (!data) return new NextResponse(null, { status: 404 });
  if (!data.is_public) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) return new NextResponse(null, { status: 404 });
  }
  const hex = String(data.bytes).replace(/^\\x/, '');
  return new NextResponse(Buffer.from(hex, 'hex'), {
    headers: {
      'Content-Type': data.mime_type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': data.is_public ? 'public, max-age=31536000, immutable' : 'private, max-age=3600',
    },
  });
}
