import Link from 'next/link';
import QRCode from 'qrcode';
import { AuthShell } from '@/components/brand';
import { env } from '@/lib/env';

export const metadata = { title: 'App SEMATEC Aula para Android' };
export const dynamic = 'force-dynamic';

const REPO = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
  ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : 'madelstorespa-arch/sematec-academy-3';
const APK = `https://github.com/${REPO}/releases/download/app-android/sematec-aula.apk`;

/** 📱 Descarga de la app de Android: comparte la pantalla del celular en las clases. */
export default async function Descargar() {
  const site = env.siteUrl().replace(/\/$/, '');
  const qr = await QRCode.toDataURL(`${site}/descargar`, { margin: 1, width: 180 });
  return (
    <AuthShell title="App SEMATEC Aula" subtitle="Para celulares y tablets Android (Android 8 o superior).">
      <div className="space-y-5 text-sm" data-testid="pagina-descarga">
        <ul className="space-y-1 text-slate-700">
          <li>📲 <b>Comparta la pantalla completa</b> de su celular en la clase: fotos, documentos, otras apps.</li>
          <li>🎥 Entre a sus clases, chat, archivos y mensajes desde la app.</li>
          <li>🔒 Usa su misma cuenta: nada cambia en la plataforma.</li>
        </ul>
        <a className="btn-primary block w-full py-3 text-center text-base" href={APK} data-testid="descargar-apk">⬇ Descargar para Android</a>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>Toque <b>Descargar</b> y luego abra el archivo <code>sematec-aula.apk</code>.</li>
          <li>Si Android pregunta, permita <b>«Instalar apps de este origen»</b> (es su plataforma, no la Play Store).</li>
          <li>Abra la app <b>SEMATEC Aula</b> e ingrese con su correo y contraseña.</li>
          <li>En la clase: <b>📲 Compartir pantalla → 📱 Compartir con la app</b>, y acepte «Iniciar ahora».</li>
        </ol>
        <a className="btn-secondary block w-full text-center" href={`sematecaula://abrir?site=${encodeURIComponent(site)}`} data-testid="abrir-en-app">Ya la tengo: abrir esta plataforma en la app</a>
        <div className="hidden items-center gap-4 rounded-lg border border-slate-200 p-3 sm:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR para descargar la app" width={120} height={120} />
          <p className="text-slate-600">¿Está en un computador? Escanee este código con la cámara de su celular Android.</p>
        </div>
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><b>iPhone y iPad:</b> Apple solo permite apps de la App Store. En iPhone puede entrar a las clases desde Safari, mostrar contenido con la cámara trasera o enviar archivos al chat; para transmitir la pantalla completa use un computador.</p>
        <p className="text-center"><Link className="link" href="/app">Volver a la plataforma</Link></p>
      </div>
    </AuthShell>
  );
}
