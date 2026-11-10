'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';

/** 🖍 Pizarra compartida en tiempo real (canal de datos de la sala). Coordenadas normalizadas 0–1. */
export type Stroke = { id: string; by: string; c: string; w: number; e?: boolean; p: number[] };
type Msg =
  | { t: 'open'; allow: boolean } | { t: 'close' } | { t: 'clear' } | { t: 'allow'; allow: boolean }
  | { t: 'pt'; id: string; c: string; w: number; e?: boolean; p: number[] } | { t: 'del'; id: string }
  | { t: 'sync'; open: boolean; allow: boolean; strokes: Stroke[]; last?: boolean };

const enc = new TextEncoder(), dec = new TextDecoder();
export const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#ffffff'];
const SIZES = [2, 5, 12];

export function useBoard(mod: boolean) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [open, setOpen] = useState(false);
  const [allow, setAllow] = useState(false);
  const strokes = useRef(new Map<string, Stroke>());
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const openRef = useRef(open); openRef.current = open;
  const allowRef = useRef(allow); allowRef.current = allow;

  const onMsg = useCallback((m: { payload: Uint8Array; from?: { identity: string } }) => {
    let d: Msg; try { d = JSON.parse(dec.decode(m.payload)); } catch { return; }
    const from = m.from?.identity ?? '';
    if (d.t === 'open') { setOpen(true); setAllow(!!d.allow); }
    else if (d.t === 'close') setOpen(false);
    else if (d.t === 'allow') setAllow(!!d.allow);
    else if (d.t === 'clear') { strokes.current.clear(); bump(); }
    else if (d.t === 'del') { strokes.current.delete(d.id); bump(); }
    else if (d.t === 'pt') {
      const s = strokes.current.get(d.id);
      if (s) s.p.push(...d.p); else strokes.current.set(d.id, { id: d.id, by: from, c: d.c, w: d.w, e: d.e, p: [...d.p] });
      bump();
    } else if (d.t === 'sync') {
      for (const s of d.strokes) if (!strokes.current.has(s.id)) strokes.current.set(s.id, s);
      if (d.last) { setOpen(d.open); setAllow(d.allow); }
      bump();
    }
  }, []);
  const { send } = useDataChannel('pizarra', onMsg);
  const post = useCallback((d: Msg, to?: string[]) => send(enc.encode(JSON.stringify(d)), { reliable: true, destinationIdentities: to }), [send]);

  /** Quien llega tarde recibe la pizarra completa (en partes pequeñas). */
  useEffect(() => {
    if (!mod) return;
    const f = (p: RemoteParticipant) => {
      if (!openRef.current && !strokes.current.size) return;
      const all = [...strokes.current.values()]; const chunks: Stroke[][] = [[]]; let size = 0;
      for (const s of all) { const l = JSON.stringify(s).length; if (size + l > 12000 && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; } chunks[chunks.length - 1].push(s); size += l; }
      setTimeout(() => chunks.forEach((c, i) => post({ t: 'sync', open: openRef.current, allow: allowRef.current, strokes: c, last: i === chunks.length - 1 }, [p.identity]).catch(() => {})), 1500);
    };
    room.on(RoomEvent.ParticipantConnected, f);
    return () => { room.off(RoomEvent.ParticipantConnected, f); };
  }, [room, mod, post]);

  return {
    open, allow, version, strokes: strokes.current, me: localParticipant.identity, canDraw: mod || allow, mod,
    show: () => { setOpen(true); post({ t: 'open', allow: allowRef.current }); },
    hide: () => { setOpen(false); post({ t: 'close' }); },
    setAllow: (a: boolean) => { setAllow(a); post({ t: 'allow', allow: a }); },
    clear: () => { strokes.current.clear(); bump(); post({ t: 'clear' }); },
    remove: (id: string) => { strokes.current.delete(id); bump(); post({ t: 'del', id }); },
    /** Dibuja puntos en este equipo. */
    addLocal: (id: string, c: string, w: number, e: boolean, p: number[]) => {
      const s = strokes.current.get(id);
      if (s) s.p.push(...p); else strokes.current.set(id, { id, by: localParticipant.identity, c, w, e, p: [...p] });
      bump();
    },
    /** Envía a los demás los puntos ya dibujados. */
    sendPoints: (id: string, c: string, w: number, e: boolean, p: number[]) => { post({ t: 'pt', id, c, w, e, p }).catch(() => {}); },
  };
}
export type Board = ReturnType<typeof useBoard>;

function draw(g: CanvasRenderingContext2D, s: Stroke, W: number, H: number, from = 0) {
  if (s.p.length < 2) return;
  g.save();
  g.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
  g.strokeStyle = s.c; g.lineWidth = (s.w * W) / 1000; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  const start = Math.max(0, from - 2);
  g.moveTo(s.p[start] * W, s.p[start + 1] * H);
  if (s.p.length === 2) g.lineTo(s.p[0] * W + 0.1, s.p[1] * H);
  for (let i = start + 2; i < s.p.length; i += 2) g.lineTo(s.p[i] * W, s.p[i + 1] * H);
  g.stroke(); g.restore();
}

export function Whiteboard({ board, title }: { board: Board; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [eraser, setEraser] = useState(false);
  const cur = useRef<{ id: string; buf: number[]; timer?: ReturnType<typeof setInterval> } | null>(null);
  const mine = useRef<string[]>([]);
  const [dims, setDims] = useState({ w: 800, h: 450 });

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(); const w = Math.max(200, Math.min(r.width, (r.height - 4) * 16 / 9));
      setDims({ w: Math.floor(w), h: Math.floor(w * 9 / 16) });
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = dims.w * dpr; c.height = dims.h * dpr;
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, dims.w, dims.h);
    for (const s of board.strokes.values()) draw(g, s, dims.w, dims.h);
  }, [board.version, board.strokes, dims]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000];
  };
  const width = eraser ? size * 4 : size;
  const flush = () => { const c = cur.current; if (!c || !c.buf.length) return; const p = c.buf; c.buf = []; board.sendPoints(c.id, color, width, eraser, p); };
  const down = (e: React.PointerEvent) => {
    if (!board.canDraw) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const id = `${board.me.slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const p = pos(e);
    cur.current = { id, buf: [...p] }; mine.current.push(id);
    board.addLocal(id, color, width, eraser, p);
    cur.current.timer = setInterval(flush, 60);
  };
  const move = (e: React.PointerEvent) => { const c = cur.current; if (!c) return; const p = pos(e); c.buf.push(...p); board.addLocal(c.id, color, width, eraser, p); };
  const end = () => { const c = cur.current; if (!c) return; clearInterval(c.timer); flush(); cur.current = null; };

  const download = () => {
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 1920, 1080);
    const layer = document.createElement('canvas'); layer.width = 1920; layer.height = 1080; const lg = layer.getContext('2d')!;
    for (const s of board.strokes.values()) draw(lg, s, 1920, 1080);
    g.drawImage(layer, 0, 0);
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `Pizarra - ${title}.png`.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  };

  return (
    <div className="absolute inset-0 z-[5] flex flex-col bg-[#1b1b1f]" data-testid="pizarra">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1.5 text-xs">
        <b className="mr-2">🖍 Pizarra</b>
        {board.canDraw ? (<>
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); setEraser(false); }} aria-label={`Color ${c}`}
              className={`h-6 w-6 rounded-full border-2 ${color === c && !eraser ? 'border-blue-400' : 'border-white/30'}`} style={{ background: c }} />))}
          <span className="mx-1 h-5 w-px bg-white/20" />
          {SIZES.map((s) => <button key={s} onClick={() => setSize(s)} className={`grid h-7 w-7 place-items-center rounded ${size === s ? 'bg-white/20' : 'hover:bg-white/10'}`} aria-label={`Grosor ${s}`}><span className="rounded-full bg-white" style={{ width: s + 2, height: s + 2 }} /></button>)}
          <button onClick={() => setEraser((v) => !v)} className={`rounded px-2 py-1 ${eraser ? 'bg-white/20' : 'hover:bg-white/10'}`}>🧽 Borrador</button>
          <button onClick={() => { const id = mine.current.pop(); if (id) board.remove(id); }} className="rounded px-2 py-1 hover:bg-white/10">↶ Deshacer trazo</button>
        </>) : <span className="opacity-70">Solo el anfitrión puede dibujar.</span>}
        <span className="ml-auto flex items-center gap-1">
          {board.mod && <label className="flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10"><input type="checkbox" checked={board.allow} onChange={(e) => board.setAllow(e.target.checked)} data-testid="pizarra-todos" /> Todos pueden dibujar</label>}
          {board.mod && <button onClick={() => { if (confirm('¿Borrar toda la pizarra para todos?')) board.clear(); }} className="rounded px-2 py-1 hover:bg-white/10">🗑 Limpiar</button>}
          <button onClick={download} className="rounded px-2 py-1 hover:bg-white/10">⬇ Guardar imagen</button>
          {board.mod && <button onClick={board.hide} className="rounded bg-white/15 px-2 py-1 hover:bg-white/25">✕ Cerrar para todos</button>}
        </span>
      </div>
      <div ref={wrap} className="flex min-h-0 flex-1 items-center justify-center p-2">
        <canvas ref={canvas} style={{ width: dims.w, height: dims.h, touchAction: 'none', cursor: board.canDraw ? (eraser ? 'cell' : 'crosshair') : 'default' }}
          className="rounded-lg bg-white shadow-xl" data-testid="pizarra-lienzo"
          onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} />
      </div>
    </div>
  );
}
