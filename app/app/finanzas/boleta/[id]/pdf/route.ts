import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { receiptFilename, receiptPdf } from '@/lib/receipt';
import { loadReceiptFor } from '@/lib/receipt-access';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/** ⬇ Comprobante de pago en PDF: solo finanzas, el propio estudiante o su apoderado. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const r = await loadReceiptFor(sb, user?.id ?? null, id);
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
