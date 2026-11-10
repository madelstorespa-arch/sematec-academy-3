import { NextResponse } from 'next/server';
import { loadSaleByTracking, salePdf, saleFilename } from '@/lib/sale-receipt';

export const runtime = 'nodejs';

/** Comprobante del pedido web (con el código de seguimiento, una vez pagado). */
export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const s = await loadSaleByTracking(code);
  if (!s || s.channel !== 'web' || !s.paidAt) return new NextResponse('No disponible', { status: 404 });
  return new NextResponse(new Uint8Array(await salePdf(s)), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${saleFilename(s)}"` },
  });
}
