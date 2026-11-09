import type { NextConfig } from 'next';

// Orígenes externos permitidos (se calculan al compilar con las variables de Vercel)
const origin = (u?: string) => { try { return u ? new URL(u).origin : ''; } catch { return ''; } };
const wsOrigin = (u?: string) => origin(u?.replace(/^http/, 'ws'));
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const livekit = origin(process.env.NEXT_PUBLIC_LIVEKIT_URL?.replace(/^ws/, 'http'));
const list = (...xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean))].join(' ');
// Medios de pago a los que el navegador puede enviar formularios (redirección al pago)
const payForms = list('https://*.transbank.cl', 'https://*.flow.cl', 'https://*.mercadopago.cl', 'https://*.mercadopago.com',
  'https://checkout.stripe.com', 'https://*.fintoc.com', origin(process.env.WEBPAY_API_URL), origin(process.env.FLOW_API_URL));
const csp = [
  "default-src 'self'",
  // Next.js necesita scripts en línea propios; se prohíbe eval y cualquier script de otro sitio
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", // WebAssembly local para fondos virtuales
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${list("'self'", supabase, wsOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL), livekit, wsOrigin(livekit), 'https://*.livekit.cloud', 'wss://*.livekit.cloud',
    'https://storage.googleapis.com' /* modelo de segmentación de fondos (datos, no código) */)}`,
  `media-src ${list("'self'", 'blob:', supabase)}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action ${list("'self'", payForms)}`,
  "frame-ancestors 'none'",
  ...(process.env.NODE_ENV === 'production' && !(process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('http://') ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // CSP en todas las páginas salvo los PDF (el visor del navegador no funciona con object-src 'none')
      { source: '/((?!app/biblioteca/libro/|app/aula/archivo/|app/certificados/[^/]+/pdf).*)', headers: [{ key: 'Content-Security-Policy', value: csp }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Content-Type', value: 'application/javascript; charset=utf-8' }] },
    ];
  },
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
};
export default config;
