import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterSW } from '@/components/register-sw';
import { getAppBrand, appIconUrl } from '@/lib/app-brand';

// Todas las páginas leen datos en vivo (marca, sesión, catálogo): nada se congela al compilar.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getAppBrand();
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
    description: 'Plataforma internacional de gestión educativa',
    applicationName: b.name,
    appleWebApp: { capable: true, title: b.name, statusBarStyle: 'black-translucent' },
    icons: { icon: appIconUrl(b, 192), apple: appIconUrl(b, 180) },
  };
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: (await getAppBrand()).color };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans antialiased">{children}<RegisterSW /></body>
    </html>
  );
}
