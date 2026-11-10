import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadReceipt, receiptFilename, receiptPdf } from '@/lib/receipt';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/** ⬇ Comprobante de pago en PDF: solo finanzas o el propio estudiante (RLS). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadReceipt(await createClient(), id);
  if (!r) return new NextResponse('No encontrado', { status: 404 });
  const bytes = await receiptPdf(r, `${env.siteUrl()}/app/finanzas/boleta/${r.id}`);
  const inline = req.nextUrl.searchParams.get('ver') === '1';
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${receiptFilename(r)}"`,
    },
  });
}
