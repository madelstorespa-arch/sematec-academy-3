'use client';
import { useEffect, useState } from 'react';

type Links = { apk: string; win: string; mac: string; linux: string; site: string };
type Device = 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'otro';
type BipEvent = Event & { prompt: () => Promise<void> };

function detect(): Device {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux|CrOS/i.test(ua)) return 'linux';
  return 'otro';
}

const TABS: [Device, string][] = [['android', '🤖 Android'], ['ios', '🍎 iPhone / iPad'], ['windows', '🪟 Windows'], ['mac', '💻 Mac'], ['linux', '🐧 Linux / Chromebook']];

/** 📲 Descarga de la app para cada tipo de dispositivo (detecta el suyo automáticamente). */
export function DevicePicker({ links }: { links: Links }) {
  const [dev, setDev] = useState<Device>('android');
  const [bip, setBip] = useState<BipEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setDev(detect());
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);
    const onBip = (e: Event) => { e.preventDefault(); setBip(e as BipEvent); };
    const onInstalled = () => { setInstalled(true); setBip(null); };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const install = async () => { if (!bip) return; await bip.prompt(); setBip(null); };
  const InstallWeb = ({ note }: { note: string }) => (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="font-semibold">Opción rápida: instalar desde el navegador</p>
      {installed ? <p className="mt-1 text-emerald-700">✓ Ya está usando la app instalada.</p>
        : bip ? <button className="btn-secondary mt-2 w-full" onClick={install} data-testid="instalar-web">📥 Instalar la app ahora</button>
          : <p className="mt-1 text-slate-600">{note}</p>}
    </div>
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={dev === k} onClick={() => setDev(k)} data-testid={`disp-${k}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${dev === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{l}</button>
        ))}
      </div>

      {dev === 'android' && <div className="space-y-3" data-testid="panel-android">
        <a className="btn-primary block w-full py-3 text-center text-base" href={links.apk} data-testid="descargar-apk">⬇ Descargar para Android</a>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>Abra el archivo <code>sematec-aula.apk</code> que se descargó.</li>
          <li>Si Android pregunta, permita <b>«Instalar apps de este origen»</b>.</li>
          <li>Abra <b>SEMATEC Aula</b> e ingrese con su correo y contraseña.</li>
        </ol>
        <p className="text-xs text-slate-500">Con esta app también puede compartir la pantalla completa del celular en las clases. Pronto estará en Google Play.</p>
        <a className="btn-secondary block w-full text-center" href={`sematecaula://abrir?site=${encodeURIComponent(links.site)}`} data-testid="abrir-en-app">Ya la tengo: abrir esta plataforma en la app</a>
      </div>}

      {dev === 'ios' && <div className="space-y-3" data-testid="panel-ios">
        <p className="text-slate-700">En iPhone y iPad la app se instala desde <b>Safari</b> (sin App Store) y queda con su ícono en la pantalla de inicio:</p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>Abra <b>{links.site.replace('https://', '')}</b> en <b>Safari</b>.</li>
          <li>Toque el botón <b>Compartir</b> (cuadrado con flecha hacia arriba ⬆).</li>
          <li>Elija <b>«Agregar a inicio»</b> y luego <b>Agregar</b>.</li>
          <li>Abra <b>SEMATEC</b> desde su pantalla de inicio: se abre a pantalla completa, como una app.</li>
        </ol>
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Apple no permite que las apps fuera de la App Store transmitan la pantalla completa del iPhone. En clase puede mostrar contenido con la cámara trasera o enviar archivos al chat.</p>
      </div>}

      {(dev === 'windows' || dev === 'mac' || dev === 'linux') && <div className="space-y-3" data-testid={`panel-${dev}`}>
        <a className="btn-primary block w-full py-3 text-center text-base" data-testid="descargar-escritorio"
          href={dev === 'windows' ? links.win : dev === 'mac' ? links.mac : links.linux}>
          ⬇ Descargar para {dev === 'windows' ? 'Windows' : dev === 'mac' ? 'Mac' : 'Linux'}
        </a>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          {dev === 'windows' && <>
            <li>Abra <code>SEMATEC-Aula-Windows.exe</code>: se instala solo y crea un ícono en el escritorio.</li>
            <li>Si Windows muestra «Windows protegió su PC», pulse <b>Más información → Ejecutar de todas formas</b>.</li>
          </>}
          {dev === 'mac' && <>
            <li>Abra <code>SEMATEC-Aula-Mac.dmg</code> y arrastre <b>SEMATEC Aula</b> a <b>Aplicaciones</b>.</li>
            <li>La primera vez, si el Mac no la deja abrir: <b>Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente»</b>.</li>
          </>}
          {dev === 'linux' && <>
            <li>Dé permiso de ejecución a <code>SEMATEC-Aula-Linux.AppImage</code> (clic derecho → Propiedades → Permitir ejecutar) y ábralo.</li>
            <li>En Chromebook use la opción rápida de abajo.</li>
          </>}
          <li>Ingrese con su correo y contraseña. Puede compartir su pantalla o una ventana en las clases.</li>
        </ol>
        <InstallWeb note={dev === 'mac' ? 'En Chrome o Edge: menú ⋮ → «Instalar SEMATEC…». En Safari: Archivo → «Agregar al Dock».' : 'En Chrome o Edge: menú ⋮ → «Instalar SEMATEC…» (o el ícono de instalar en la barra de direcciones).'} />
      </div>}

      {dev === 'otro' && <InstallWeb note="Abra esta página en Chrome, Edge o Safari para instalar la app." />}
    </div>
  );
}
