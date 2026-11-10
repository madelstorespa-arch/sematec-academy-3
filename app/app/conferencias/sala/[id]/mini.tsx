'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ParticipantTile, TrackToggle, DisconnectButton, useLocalParticipant, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track } from 'livekit-client';

/** Copia las hojas de estilo de la página a la ventana flotante (Picture-in-Picture). */
function copyStyles(win: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      const s = win.document.createElement('style'); s.textContent = css; win.document.head.appendChild(s);
    } catch {
      if (sheet.href) { const l = win.document.createElement('link'); l.rel = 'stylesheet'; l.href = sheet.href; win.document.head.appendChild(l); }
    }
  }
  win.document.documentElement.style.background = '#111'; win.document.body.style.margin = '0';
}

/** ¿El navegador permite una ventana flotante encima de todos los programas? (Chrome y Edge de escritorio) */
export const canDocPip = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

export async function openPipWindow(): Promise<Window | null> {
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
  if (!dpip) return null;
  const w = await dpip.requestWindow({ width: 400, height: 300 });
  w.document.title = 'Aula virtual'; copyStyles(w);
  return w;
}

type Props = {
  title: string; focus?: TrackReferenceOrPlaceholder; recording: boolean; unread: number; hands: number; people: number;
  pip: Window | null; onPip: () => void; onClosePip: () => void; onExpand?: () => void; canShare: boolean;
};

/** Sala minimizada: video principal, controles básicos y botón para volver; se puede arrastrar o sacar a una ventana flotante. */
export function MiniDock(p: Props) {
  const { localParticipant } = useLocalParticipant();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sharing = localParticipant.isScreenShareEnabled;
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); }, [msg]);

  const shareWhole = async () => {
    try {
      await localParticipant.setScreenShareEnabled(true, { audio: true, selfBrowserSurface: 'include', surfaceSwitching: 'include', systemAudio: 'include',
        video: { displaySurface: 'monitor' }, monitorTypeSurfaces: 'include', contentHint: 'detail' } as never);
    } catch (e) { setMsg((e as DOMException)?.name === 'NotAllowedError' ? 'No se compartió (cancelado o sin permiso del sistema).' : 'No se pudo compartir la pantalla.'); }
  };

  const body = (
    <div data-lk-theme="default" className="flex h-full w-full flex-col overflow-hidden bg-[#111] text-white" data-testid="sala-mini">
      <div className="flex cursor-move items-center gap-2 bg-black/60 px-2 py-1 text-xs" onPointerDown={(e) => {
        if (p.pip || !box.current) return; const r = box.current.getBoundingClientRect();
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }} onPointerMove={(e) => { if (drag.current) setPos({ x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy)) }); }}
        onPointerUp={() => { drag.current = null; }}>
        {p.recording && <span className="animate-pulse rounded bg-red-600 px-1.5 font-bold">● REC</span>}
        {sharing && <span className="rounded bg-emerald-600 px-1.5">🟢 Compartiendo</span>}
        <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
        <span className="opacity-70">{p.people} 👥</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {p.focus ? <ParticipantTile trackRef={p.focus} style={{ height: '100%' }} /> : <div className="grid h-full place-items-center text-xs opacity-60">Conectado</div>}
        {(p.unread > 0 || p.hands > 0) && (
          <span className="absolute left-1 top-1 flex gap-1 text-[11px]">
            {p.unread > 0 && <span className="rounded bg-red-600 px-1.5">💬 {p.unread}</span>}
            {p.hands > 0 && <span className="rounded bg-amber-500 px-1.5">✋ {p.hands}</span>}
          </span>)}
        {msg && <span className="absolute inset-x-1 bottom-1 rounded bg-black/80 p-1 text-[11px]">{msg}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1 bg-black/60 p-1 text-xs [&_.lk-button]:px-2 [&_.lk-button]:py-1">
        <TrackToggle source={Track.Source.Microphone} showIcon={true} />
        <TrackToggle source={Track.Source.Camera} showIcon={true} />
        {p.canShare && (sharing
          ? <button className="lk-button" onClick={() => localParticipant.setScreenShareEnabled(false)} title="Dejar de compartir">⏹</button>
          : <button className="lk-button" onClick={shareWhole} title="Compartir toda la pantalla">🖥</button>)}
        {p.pip ? <button className="lk-button" onClick={p.onClosePip} title="Volver a la página">⬚</button>
          : <button className="lk-button" onClick={p.onPip} title="Ventana flotante encima de todos los programas" data-testid="ventana-flotante">⧉</button>}
        {p.onExpand && <button className="lk-button" onClick={() => { p.onClosePip(); p.onExpand?.(); }} title="Abrir la sala completa" data-testid="maximizar">⤢ Abrir</button>}
        <DisconnectButton title="Salir de la sala">✕</DisconnectButton>
      </div>
    </div>
  );

  if (p.pip) return (<>
    {createPortal(body, p.pip.document.body)}
    {p.onExpand && (
      <button onClick={p.onClosePip} className="fixed bottom-4 right-4 z-[70] rounded-full bg-[#111] px-4 py-2 text-xs text-white shadow-2xl" data-testid="en-ventana-flotante">
        ⧉ Clase en ventana flotante · Volver aquí</button>)}
  </>);
  return (
    <div ref={box} className="fixed z-[70] h-[220px] w-[320px] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/20 sm:h-[240px] sm:w-[360px]"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}>
      {body}
    </div>
  );
}
