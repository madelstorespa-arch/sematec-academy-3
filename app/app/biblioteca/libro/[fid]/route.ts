import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Lectura de libros virtuales: solo integrantes de la institución (RLS). Los PDF se abren en el navegador. */
export async function GET(_req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(fid)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from('library_files').select('filename, mime_type, bytes').eq('id', fid).maybeSingle();
  if (!data) return new NextResponse('No encontrado', { status: 404 });
  const hex = String(data.bytes).replace(/^\\x/, '');
  const pdf = data.mime_type === 'application/pdf';
  return new NextResponse(Buffer.from(hex, 'hex'), {
    headers: {
      'Content-Type': data.mime_type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(data.filename)}`,
      ...(pdf ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
    },
  });
}
