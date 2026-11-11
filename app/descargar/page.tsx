import Link from 'next/link';
import QRCode from 'qrcode';
import { AuthShell } from '@/components/brand';
import { env } from '@/lib/env';
import { DevicePicker } from './device-picker';

export const metadata = { title: 'Descargar la app SEMATEC Aula' };
export const dynamic = 'force-dynamic';

const REPO = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
  ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : 'thebestinstitut2025-prog/sematec-academy-3';
const REL = `https://github.com/${REPO}/releases/download`;

/** 📲 La app para todo tipo de dispositivo: Android, iPhone/iPad, Windows, Mac, Linux y Chromebook. */
export default async function Descargar() {
  const site = env.siteUrl().replace(/\/$/, '');
  const qr = await QRCode.toDataURL(`${site}/descargar`, { margin: 1, width: 180 });
  const links = {
    apk: `${REL}/app-android/sematec-aula.apk`,
    win: `${REL}/app-escritorio/SEMATEC-Aula-Windows.exe`,
    mac: `${REL}/app-escritorio/SEMATEC-Aula-Mac.dmg`,
    linux: `${REL}/app-escritorio/SEMATEC-Aula-Linux.AppImage`,
    site,
  };
  return (
    <AuthShell title="App SEMATEC Aula" subtitle="Para celulares, tablets y computadores. Usa su misma cuenta.">
      <div className="space-y-5 text-sm" data-testid="pagina-descarga">
        <ul className="space-y-1 text-slate-700">
          <li>🎥 Clases en vivo, chat, archivos, mensajes y todos sus módulos.</li>
          <li>📲 Compartir pantalla en las clases (Android y computador).</li>
          <li>🔒 Su misma cuenta: nada cambia en la plataforma.</li>
        </ul>
        <DevicePicker links={links} />
        <div className="hidden items-center gap-4 rounded-lg border border-slate-200 p-3 sm:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR para descargar la app" width={120} height={120} />
          <p className="text-slate-600">¿Quiere la app en su celular? Escanee este código con la cámara.</p>
        </div>
        <p className="text-center"><Link className="link" href="/app">Volver a la plataforma</Link></p>
      </div>
    </AuthShell>
  );
}
