import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppBrand } from '@/lib/app-brand';

export const runtime = 'nodejs';
const SIZES = new Set([180, 192, 512]);

/**
 * Ícono de la app instalable generado desde el logo de la institución
 * (Sitio web y marca → Logo). Sin logo, se usa el ícono SEMATEC.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new NextResponse(null, { status: 404 });
  const maskable = req.nextUrl.searchParams.get('m') === '1' || size === 180;
  const fallback = () => NextResponse.redirect(new URL(size === 180 ? '/icons/apple-180.png' : maskable ? '/icons/maskable-512.png' : `/icons/icon-${size === 512 ? 512 : 192}.png`, req.url));

  const brand = await getAppBrand();
  if (!brand.logoId) return fallback();
  const { data } = await createAdminClient().from('media_assets').select('bytes').eq('id', brand.logoId).maybeSingle();
  if (!data) return fallback();
  try {
    const logo = Buffer.from(String(data.bytes).replace(/^\\x/, ''), 'hex');
    // Zona segura: los íconos «maskable» se recortan en círculo o gota en Android
    const inner = Math.round(size * (maskable ? 0.62 : 0.8));
    const fitted = await sharp(logo).resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
    const radius = maskable ? 0 : Math.round(size * 0.2);
    const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/></svg>`);
    const png = await sharp(bg).composite([{ input: fitted, gravity: 'center' }]).png().toBuffer();
    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
    });
  } catch {
    return fallback();
  }
}
