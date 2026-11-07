import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterSW } from '@/components/register-sw';

// Todas las páginas leen datos en vivo (marca, sesión, catálogo): nada se congela al compilar.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'SEMATEC ACADEMY', template: '%s · SEMATEC ACADEMY' },
  description: 'Plataforma internacional de gestión educativa',
  applicationName: 'SEMATEC ACADEMY',
  appleWebApp: { capable: true, title: 'SEMATEC', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-180.png' },
};

export const viewport: Viewport = { themeColor: '#1f45c8' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans antialiased">{children}<RegisterSW /></body>
    </html>
  );
}
