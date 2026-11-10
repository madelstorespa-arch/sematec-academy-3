import { NextResponse, type NextRequest } from 'next/server';
import { getContext } from '@/lib/context';

/** Entra directo a la plataforma de una organización: /app/ir/<enlace> (desde /o/<enlace>). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getContext();
  const org = ctx.orgs.find((o) => o.slug === String(slug).toLowerCase());
  if (!org) return NextResponse.redirect(new URL('/app?sin-acceso=' + encodeURIComponent(String(slug).slice(0, 63)), req.url));
  const res = NextResponse.redirect(new URL('/app/conferencias', req.url));
  res.cookies.set('sa_org', org.organization_id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  res.cookies.delete('sematec-sucursal');
  return res;
}
