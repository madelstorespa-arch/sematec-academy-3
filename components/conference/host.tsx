'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ConferenceContext, type Conn, type RoomOpts } from './context';
import { RoomShell } from '@/app/app/conferencias/sala/[id]/room';

/**
 * Mantiene la conexión a la clase o reunión mientras la persona navega por el sistema:
 * la sala se puede minimizar (ventana pequeña flotante) sin salir de ella.
 */
export function ConferenceHost({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ conn: Conn; opts: RoomOpts } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = usePathname();
  const router = useRouter();

  // Mientras está conectado, los filtros (formularios GET) y enlaces simples del sistema navegan sin recargar
  // la página, para no cortar la clase
  useEffect(() => {
    if (!active) return;
    const inApp = (u: URL) => u.origin === location.origin && u.pathname.startsWith('/app') && !/\/(pdf|csv|descargar)$/.test(u.pathname) && !u.searchParams.has('descargar');
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if (e.defaultPrevented || (f.method || 'get').toLowerCase() !== 'get' || (f.target && f.target !== '_self')) return;
      const u = new URL(f.action || location.href, location.href);
      if (!inApp(u)) return;
      e.preventDefault();
      const q = new URLSearchParams();
      new FormData(f, e.submitter as HTMLElement | null).forEach((v, k) => { if (typeof v === 'string') q.append(k, v); });
      router.push(`${u.pathname}?${q.toString()}`);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.('a') as HTMLAnchorElement | null;
      if (!a || !a.href || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      const u = new URL(a.href);
      if (!inApp(u) || (u.pathname === location.pathname && u.search === location.search && u.hash)) return;
      e.preventDefault(); router.push(u.pathname + u.search + u.hash);
    };
    document.addEventListener('submit', onSubmit);
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('submit', onSubmit); document.removeEventListener('click', onClick); };
  }, [active, router]);

  // Al ir a otra página del sistema la sala se minimiza (sigue conectada)
  useEffect(() => {
    if (active && path !== `/app/conferencias/sala/${active.opts.sessionId}`) setMinimized(true);
  }, [path, active]);

  const join = useCallback((conn: Conn, opts: RoomOpts) => { setError(null); setMinimized(false); setActive({ conn, opts }); }, []);
  const leave = useCallback(() => { setActive(null); setMinimized(false); }, []);
  const ctl = useMemo(() => ({ active, minimized, error, join, leave, setMinimized }), [active, minimized, error, join, leave]);

  return (
    <ConferenceContext.Provider value={ctl}>
      {children}
      {active && (
        <RoomShell key={active.conn.token} conn={active.conn} opts={active.opts} view={minimized ? 'mini' : 'full'}
          onMinimize={() => setMinimized(true)} onExpand={() => setMinimized(false)}
          onLeave={leave} onError={(m) => { setError(m); leave(); }} />
      )}
    </ConferenceContext.Provider>
  );
}
