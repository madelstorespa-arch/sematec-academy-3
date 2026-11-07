import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SEMATEC ACADEMY',
    short_name: 'SEMATEC',
    description: 'Plataforma educativa: aula, notas, asistencia, credencial y más. Funciona también sin conexión.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1430',
    theme_color: '#1f45c8',
    lang: 'es',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Mi credencial', url: '/app/credencial' },
      { name: 'Aula de aprendizaje', url: '/app/aula' },
      { name: 'Calendario', url: '/app/calendario' },
    ],
  };
}
