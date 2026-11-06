import type { Metadata } from 'next';
import './globals.css';

// Todas las páginas leen datos en vivo (marca, sesión, catálogo): nada se congela al compilar.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'SEMATEC ACADEMY', template: '%s · SEMATEC ACADEMY' },
  description: 'Plataforma internacional de gestión educativa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
