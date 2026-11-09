import { APP_VERSION, APP_BUILT } from '@/lib/version.generated';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Versión publicada en el servidor (la app la compara con la suya para ofrecer «Actualizar»). */
export function GET() {
  return NextResponse.json({ version: APP_VERSION, built: APP_BUILT },
    { headers: { 'cache-control': 'no-store' } });
}
