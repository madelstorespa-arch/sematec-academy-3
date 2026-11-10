import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadSale, salePdf, saleFilename } from '@/lib/sale-receipt';

export const runtime = 'nodejs';

/** Comprobante de venta en PDF (formato ticket 80 mm). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSale(await createClient(), id);
  if (!s) return new NextResponse('No encontrado', { status: 404 });
  const inline = req.nextUrl.searchParams.get('ver') === '1';
  return new NextResponse(new Uint8Array(await salePdf(s)), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${saleFilename(s)}"` },
  });
}
