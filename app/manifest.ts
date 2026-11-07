import type { MetadataRoute } from 'next';
import { getAppBrand, appIconUrl } from '@/lib/app-brand';

export const dynamic = 'force-dynamic';

/** Manifiesto de la app instalable: nombre, logo y color de la institución. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getAppBrand();
  const short = b.name.length <= 12 ? b.name : b.name.split(/\s+/)[0].slice(0, 12);
  return {
    name: b.name,
    short_name: short,
    description: 'Plataforma educativa: aula, notas, asistencia, credencial y más. Funciona también sin conexión.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: b.color,
    lang: 'es',
    icons: [
      { src: appIconUrl(b, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: appIconUrl(b, 512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: appIconUrl(b, 512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Mi credencial', url: '/app/credencial' },
      { name: 'Aula de aprendizaje', url: '/app/aula' },
      { name: 'Calendario', url: '/app/calendario' },
    ],
  };
}
