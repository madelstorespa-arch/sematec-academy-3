'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

declare global { interface Window { DocsAPI?: { DocEditor: new (id: string, cfg: object) => { destroyEditor?: () => void } } } }

/** Editor de ONLYOFFICE Docs (Word, Excel y PowerPoint con el formato exacto) dentro de la plataforma. */
export function OnlyofficeEditor({ server, config, title, kind, toolbar }: { server: string; config: object; title: string; kind: string; toolbar?: React.ReactNode }) {
  const [err, setErr] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let ed: { destroyEditor?: () => void } | null = null; let alive = true;
    const start = () => {
      if (!alive || !window.DocsAPI || !holder.current) return;
      holder.current.innerHTML = '<div id="oo-editor"></div>';
      try { ed = new window.DocsAPI.DocEditor('oo-editor', config); } catch (e) { setErr(`No se pudo abrir el editor: ${(e as Error).message}`); }
    };
    if (window.DocsAPI) start();
    else {
      const s = document.createElement('script');
      s.src = `${server}/web-apps/apps/api/documents/api.js`; s.async = true;
      s.onload = start;
      s.onerror = () => setErr('No se pudo conectar con el servidor ONLYOFFICE. Revise que esté encendido y que ONLYOFFICE_URL sea correcta.');
      document.head.appendChild(s);
    }
    return () => { alive = false; try { ed?.destroyEditor?.(); } catch { /* ya cerrado */ } };
  }, [server, config]);
  const icon = { doc: '📄', sheet: '📊', slides: '📽' }[kind] ?? '📄';
  return (
    <div className="-mx-4 lg:-mx-8" data-testid="editor-onlyoffice">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:px-8">
        <Link href="/app/oficina" className="grid h-9 w-9 place-items-center rounded-lg bg-slate-800 text-lg text-white" title="Volver a SEMATEC Oficina">{icon}</Link>
        <span className="truncate text-lg font-semibold">{title}</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">ONLYOFFICE · formato exacto de Office · se guarda solo</span>
        <span className="ml-auto flex gap-2">{toolbar}</span>
      </div>
      {err ? <p className="m-6 rounded-lg bg-red-50 p-4 text-sm text-red-700" data-testid="onlyoffice-error">{err}</p>
        : <div ref={holder} className="h-[calc(100vh-8rem)] min-h-[520px] w-full bg-slate-100" />}
    </div>
  );
}
