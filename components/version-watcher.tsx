'use client';
import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/version.generated';

const MINE = APP_VERSION;

/** Avisa cuando hay una versión nueva publicada y la instala con un toque (recarga sin caché vieja). */
export function VersionWatcher() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop || !navigator.onLine || document.visibilityState === 'hidden') return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        const v = (await r.json()).version;
        if (v && MINE && v !== MINE) setFresh(true);
      } catch { /* sin conexión */ }
    };
    const t = setInterval(check, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', check);
    check();
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', check); };
  }, []);
  if (!fresh) return null;
  return (
    <div data-testid="version-nueva" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 print:hidden">
      <span>🎉 Hay una versión nueva de la plataforma.</span>
      <button type="button" className="btn-primary btn-sm" onClick={() => updateNow()}>🔄 Actualizar ahora</button>
    </div>
  );
}

/** Descarga la versión nueva: renueva el service worker, limpia cachés de páginas y recarga. */
export async function updateNow() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    if ('caches' in window) for (const k of await caches.keys()) if (!k.includes('static')) await caches.delete(k);
  } catch { /* igual recarga */ }
  location.reload();
}
