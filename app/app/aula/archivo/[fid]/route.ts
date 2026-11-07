import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Descarga de archivos del aula: la base de datos (RLS) decide quién puede verlos. */
export async function GET(_req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(fid)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from('lms_files').select('filename, mime_type, bytes').eq('id', fid).maybeSingle();
  if (!data) return new NextResponse('No encontrado', { status: 404 });
  const hex = String(data.bytes).replace(/^\\x/, '');
  return new NextResponse(Buffer.from(hex, 'hex'), {
    headers: {
      'Content-Type': data.mime_type, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(data.filename)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
