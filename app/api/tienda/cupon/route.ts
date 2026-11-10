import { NextResponse, type NextRequest } from 'next/server';
import { anonClient } from '@/lib/site';

/** Vista previa de un cupón en la tienda web (solo dice si es válido y cuánto descuenta). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const org = sp.get('org') ?? '', code = (sp.get('code') ?? '').slice(0, 20), total = Number(sp.get('total') ?? 0);
  if (!/^[0-9a-f-]{36}$/.test(org) || code.length < 4) return NextResponse.json({ valid: false });
  const { data } = await anonClient().rpc('store_coupon_check', { p_org: org, p_code: code, p_total: total, p_channel: 'web' });
  return NextResponse.json(data ?? { valid: false }, { headers: { 'Cache-Control': 'no-store' } });
}
