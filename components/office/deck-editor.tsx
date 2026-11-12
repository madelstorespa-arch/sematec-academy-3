'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { exportDeck, GRID, newDeck, newSlide, PAGE_SIZES, PUB_FORMATS, SLIDE_FORMATS, THEMES, uid, type Deck, type El, type Page } from '@/lib/office/deck';
import { OfficeBar, useAutosave, useMenus, type OfficeDocProps } from './shell';

const FONTS = ['Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact', 'Courier New'];
const COLORS = ['#ffffff', '#000000', '#0f172a', '#334155', '#1f45c8', '#0ea5e9', '#10b5a3', '#16a34a', '#ca8a04', '#ea580c', '#e11d48', '#db2777', '#7c3aed', '#fde047'];
const dark = (hex: string) => { const m = hex?.match(/^#([0-9a-f]{6})$/i); if (!m) return false; const n = parseInt(m[1], 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 140; };
const ANIMS: [NonNullable<El['anim']>, string][] = [['none', 'Sin animación'], ['fade', 'Aparecer'], ['fly', 'Desplazar desde abajo'], ['zoom', 'Acercar']];
const TRANS: [NonNullable<Page['transition']>, string][] = [['none', 'Sin transición'], ['fade', 'Desvanecer'], ['slide', 'Deslizar'], ['zoom', 'Zoom']];
const snap = (v: number, on?: boolean) => (on ? Math.round(v / GRID) * GRID : Math.round(v));
const SHAPES: [NonNullable<El['shape']>, string][] = [['rect', '▭'], ['round', '▢'], ['ellipse', '◯'], ['triangle', '△'], ['star', '☆'], ['line', '―'], ['arrow', '→']];

function ElView({ e, scale, selected, editing, onText, hide, animate }: { e: El; scale: number; selected?: boolean; editing?: boolean; onText?: (t: string) => void; hide?: boolean; animate?: boolean }) {
  const box: React.CSSProperties = { position: 'absolute', left: e.x * scale, top: e.y * scale, width: e.w * scale, height: e.h * scale, opacity: hide ? 0 : e.opacity ?? 1,
    transform: e.rot ? `rotate(${e.rot}deg)` : undefined, transformOrigin: 'center', animation: animate && e.anim && e.anim !== 'none' ? `anim-${e.anim} .6s ease-out both` : undefined };
  if (e.type === 'image') return <img src={e.src} alt="" draggable={false} style={{ ...box, objectFit: 'fill' }} />; // eslint-disable-line @next/next/no-img-element
  if (e.type === 'shape') {
    if (e.shape === 'line' || e.shape === 'arrow') return (
      <svg style={{ ...box, overflow: 'visible' }} viewBox={`0 0 ${e.w} ${e.h}`} preserveAspectRatio="none">
        <line x1={0} y1={e.h / 2} x2={e.w - (e.shape === 'arrow' ? 12 : 0)} y2={e.h / 2} stroke={e.stroke ?? e.fill ?? '#000'} strokeWidth={e.strokeW || 3} vectorEffect="non-scaling-stroke" />
        {e.shape === 'arrow' && <polygon points={`${e.w},${e.h / 2} ${e.w - 14},${e.h / 2 - 8} ${e.w - 14},${e.h / 2 + 8}`} fill={e.stroke ?? e.fill ?? '#000'} />}
      </svg>);
    const clip = e.shape === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : e.shape === 'star' ? 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)' : undefined;
    return <div style={{ ...box, background: e.fill, border: e.strokeW && e.stroke ? `${e.strokeW * scale}px solid ${e.stroke}` : undefined, borderRadius: e.shape === 'ellipse' ? '50%' : e.shape === 'round' ? Math.min(e.w, e.h) * scale / 4 : undefined, clipPath: clip }} />;
  }
  const style: React.CSSProperties = {
    ...box, background: e.fill, color: e.color, fontFamily: e.font, fontSize: (e.size ?? 18) * scale, fontWeight: e.b ? 700 : 400, fontStyle: e.i ? 'italic' : 'normal',
    textDecoration: e.u ? 'underline' : 'none', textAlign: e.align ?? 'left', lineHeight: 1.25, padding: 4 * scale, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    display: 'flex', flexDirection: 'column', justifyContent: e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start', outline: selected && !editing ? 'none' : undefined,
  };
  if (editing) return <textarea autoFocus defaultValue={e.text} style={{ ...style, resize: 'none', border: '2px solid #2563eb', background: e.fill ?? 'rgba(255,255,255,.85)' }} onBlur={(ev) => onText?.(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Escape') (ev.target as HTMLTextAreaElement).blur(); ev.stopPropagation(); }} data-testid="editar-texto" />;
  return <div style={style}><span>{e.text}</span></div>;
}

function PageView({ deck, page, width, sel, editing, onDown, onText, onResize, grid, reveal, className }: {
  deck: Deck; page: Page; width: number; sel?: string | null; editing?: string | null;
  onDown?: (e: React.MouseEvent, id: string | null) => void; onText?: (id: string, t: string) => void; onResize?: (e: React.MouseEvent, id: string, corner: string) => void;
  grid?: boolean; reveal?: number; className?: string;
}) {
  const scale = width / deck.w;
  const animated = page.els.filter((e) => e.anim && e.anim !== 'none');
  return (
    <div className={`relative overflow-hidden shadow-lg ${className ?? ''}`} style={{ width, height: deck.h * scale, background: page.bg2 ? `linear-gradient(135deg, ${page.bg}, ${page.bg2})` : page.bg }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onDown?.(e, null); }}>
      {grid && <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(37,99,235,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,.15) 1px, transparent 1px)', backgroundSize: `${GRID * scale}px ${GRID * scale}px` }} data-testid="cuadricula" />}
      {page.els.map((el) => {
        const ai = animated.indexOf(el);
        return (
        <div key={el.id} onMouseDown={(e) => { e.stopPropagation(); onDown?.(e, el.id); }} data-el={el.id}>
          <ElView e={el} scale={scale} selected={sel === el.id} editing={editing === el.id} onText={(t) => onText?.(el.id, t)} hide={reveal !== undefined && ai >= 0 && ai >= reveal} animate={reveal !== undefined && ai >= 0 && ai < reveal} />
          {sel === el.id && editing !== el.id && onResize && (
            <div className="pointer-events-none absolute border-2 border-blue-500" style={{ left: el.x * scale - 2, top: el.y * scale - 2, width: el.w * scale + 4, height: el.h * scale + 4, transform: el.rot ? `rotate(${el.rot}deg)` : undefined, borderStyle: el.lock ? 'dashed' : 'solid' }}>
              {el.lock && <span className="absolute -top-5 left-0 rounded bg-blue-600 px-1 text-[10px] text-white">🔒 bloqueado</span>}
              {!el.lock && ['nw', 'ne', 'sw', 'se'].map((k) => (
                <span key={k} className="pointer-events-auto absolute h-3 w-3 rounded-sm border border-blue-600 bg-white" onMouseDown={(e) => { e.stopPropagation(); onResize(e, el.id, k); }}
                  style={{ left: k.includes('w') ? -7 : undefined, right: k.includes('e') ? -7 : undefined, top: k.includes('n') ? -7 : undefined, bottom: k.includes('s') ? -7 : undefined, cursor: `${k}-resize` }} />))}
            </div>)}
        </div>); })}
    </div>
  );
}

export function DeckEditor({ doc }: { doc: OfficeDocProps }) {
  const pub = doc.kind === 'pub';
  const [deck, setDeck] = useState<Deck>(() => {
    const c = doc.content as { deck?: Deck; template?: string; size?: string };
    if (c.deck?.pages?.length) return c.deck;
    return newDeck(pub ? 'pub' : 'slides', c.size || (pub ? (c.template === 'tarjeta' ? 'tarjeta' : c.template === 'diploma' || c.template === 'triptico' ? 'a4h' : c.template === 'afiche' || c.template === 'invitacion' ? 'a4' : 'a4') : 'slide'), c.template || (pub ? 'blanco' : 'claro'));
  });
  const [title, setTitle] = useState(doc.title);
  const [pi, setPi] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [present, setPresent] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [width, setWidth] = useState(800);
  const stage = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const hist = useRef<{ past: Deck[]; future: Deck[] }>({ past: [], future: [] });
  const save = useAutosave(doc);
  const menus = useMenus<HTMLDivElement>();
  const titleRef = useRef(title); titleRef.current = title;
  const page = deck.pages[Math.min(pi, deck.pages.length - 1)];
  const cur = page.els.find((e) => e.id === sel) ?? null;
  useEffect(() => {
    const fit = () => { const w = stage.current?.clientWidth ?? 800; setWidth(Math.max(240, Math.min(w - 32, (window.innerHeight - 260) * (deck.w / deck.h)))); };
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, [deck.w, deck.h]);
  const commit = useCallback((next: Deck, record = true) => {
    if (record) { hist.current.past.push(deck); if (hist.current.past.length > 60) hist.current.past.shift(); hist.current.future = []; }
    setDeck(next); save.change(titleRef.current, { deck: next });
  }, [deck, save]);
  useEffect(() => { if (title !== doc.title) save.change(title, { deck }); }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!(doc.content as { deck?: Deck }).deck && doc.canEdit) save.change(title, { deck }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const undo = () => { const p = hist.current.past.pop(); if (p) { hist.current.future.push(deck); setDeck(p); save.change(title, { deck: p }); } };
  const redo = () => { const f = hist.current.future.pop(); if (f) { hist.current.past.push(deck); setDeck(f); save.change(title, { deck: f }); } };
  const setPage = (fn: (p: Page) => Page, record = true) => commit({ ...deck, pages: deck.pages.map((p, i) => (i === pi ? fn(p) : p)) }, record);
  const patchEl = (id: string, patch: Partial<El>, record = true) => setPage((p) => ({ ...p, els: p.els.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), record);
  const addEl = (e: El) => { setPage((p) => ({ ...p, els: [...p.els, e] })); setSel(e.id); };
  const removeSel = () => { if (!sel) return; setPage((p) => ({ ...p, els: p.els.filter((e) => e.id !== sel) })); setSel(null); };
  const order = (front: boolean) => { if (!cur) return; setPage((p) => ({ ...p, els: front ? [...p.els.filter((e) => e.id !== cur.id), cur] : [cur, ...p.els.filter((e) => e.id !== cur.id)] })); };
  const scale = width / deck.w;
  const onDown = (ev: React.MouseEvent, id: string | null) => {
    if (!doc.canEdit) return;
    if (editing && editing !== id) setEditing(null);
    setSel(id);
    if (!id) return;
    const el = page.els.find((e) => e.id === id)!; if (el.lock) return;
    const x0 = ev.clientX, y0 = ev.clientY; let moved = false; const before = deck;
    const move = (e: MouseEvent) => {
      const dx = (e.clientX - x0) / scale, dy = (e.clientY - y0) / scale; if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return; moved = true;
      setDeck((d) => ({ ...d, pages: d.pages.map((p, i) => (i === pi ? { ...p, els: p.els.map((x) => (x.id === id ? { ...x, x: snap(el.x + dx, d.grid), y: snap(el.y + dy, d.grid) } : x)) } : p)) }));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); if (moved) setDeck((d) => { hist.current.past.push(before); save.change(titleRef.current, { deck: d }); return d; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const onResize = (ev: React.MouseEvent, id: string, corner: string) => {
    const el = page.els.find((e) => e.id === id)!; const x0 = ev.clientX, y0 = ev.clientY; const before = deck;
    const move = (e: MouseEvent) => {
      const dx = (e.clientX - x0) / scale, dy = (e.clientY - y0) / scale; const n = { ...el };
      if (corner.includes('e')) n.w = Math.max(10, el.w + dx); if (corner.includes('s')) n.h = Math.max(6, el.h + dy);
      if (corner.includes('w')) { n.w = Math.max(10, el.w - dx); n.x = el.x + el.w - n.w; } if (corner.includes('n')) { n.h = Math.max(6, el.h - dy); n.y = el.y + el.h - n.h; }
      if (e.shiftKey && el.type === 'image') n.h = n.w * (el.h / el.w);
      setDeck((d) => ({ ...d, pages: d.pages.map((p, i) => (i === pi ? { ...p, els: p.els.map((x) => (x.id === id ? { ...n, x: snap(n.x, d.grid), y: snap(n.y, d.grid), w: Math.max(10, snap(n.w, d.grid)), h: Math.max(6, snap(n.h, d.grid)) } : x)) } : p)) }));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setDeck((d) => { hist.current.past.push(before); save.change(titleRef.current, { deck: d }); return d; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (present !== null) {
        if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); advance(1); }
        if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) advance(-1);
        if (e.key === 'Escape') { setPresent(null); document.fullscreenElement && document.exitFullscreen().catch(() => {}); }
        return;
      }
      const t = e.target as HTMLElement; if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || !doc.canEdit) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeSel(); }
      else if (sel && mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (cur) addEl({ ...cur, id: uid(), x: cur.x + 16, y: cur.y + 16 }); }
      else if (sel && e.key.startsWith('Arrow') && cur && !cur.lock) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; patchEl(cur.id, { x: cur.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0), y: cur.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0) }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const addImage = (f?: File) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { alert('La imagen pesa más de 5 MB. Use una más liviana.'); return; }
    const r = new FileReader();
    r.onload = async () => {
      const src = String(r.result); const im = new Image(); im.src = src; await im.decode().catch(() => {});
      const k = Math.min(1, (deck.w * 0.6) / (im.naturalWidth || 400), (deck.h * 0.6) / (im.naturalHeight || 300));
      const w = Math.round((im.naturalWidth || 400) * k), h = Math.round((im.naturalHeight || 300) * k);
      addEl({ id: uid(), type: 'image', x: Math.round((deck.w - w) / 2), y: Math.round((deck.h - h) / 2), w, h, src });
    };
    r.readAsDataURL(f);
  };
  const tb = (on: () => void, label: React.ReactNode, titleTxt: string, active?: boolean, testid?: string) =>
    <button type="button" title={titleTxt} aria-label={titleTxt} onMouseDown={(e) => e.preventDefault()} onClick={on} data-testid={testid}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-sm ${active ? 'bg-orange-100 text-orange-800' : 'text-slate-700 hover:bg-slate-100'}`}>{label}</button>;
  // Presentación: omite diapositivas ocultas y muestra las animaciones de entrada una por una (clic o →)
  const shown = deck.pages.map((p, i) => ({ p, i })).filter(({ p }) => !p.hidden || pub);
  const startPresent = (from = pi) => {
    const k = shown.findIndex(({ i }) => i >= from); setPresent(k < 0 ? 0 : k); setStep(0);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const pres = present !== null ? shown[present]?.p ?? null : null;
  const animCount = pres ? pres.els.filter((e) => e.anim && e.anim !== 'none').length : 0;
  function advance(d: 1 | -1) {
    if (present === null) return;
    if (d === 1 && step < animCount) { setStep(step + 1); return; }
    const next = Math.max(0, Math.min(shown.length - 1, present + d));
    if (next !== present) { setPresent(next); setStep(d === 1 ? 0 : shown[next].p.els.filter((e) => e.anim && e.anim !== 'none').length); }
  }
  return (
    <div>
      <OfficeBar doc={doc} title={title} setTitle={setTitle} save={save} formats={pub ? PUB_FORMATS : SLIDE_FORMATS} saveExt={pub ? 'pdf' : 'pptx'}
        exportAs={(f) => exportDeck(deck, title, f, pi)}
        extra={!pub && <button className="btn-secondary btn-sm" onClick={() => startPresent(0)} data-testid="presentar" title="Presentar desde el inicio">▶ Presentar</button>} />
      {doc.canEdit && (
        <div ref={menus} className="flex flex-wrap items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm" data-testid="cinta-diapositivas">
          {tb(undo, '↶', 'Deshacer')}{tb(redo, '↷', 'Rehacer')}<span className="mx-1 h-6 w-px bg-slate-200" />
          {tb(() => addEl({ id: uid(), type: 'text', x: deck.w * 0.2, y: deck.h * 0.4, w: deck.w * 0.6, h: 60, text: 'Nuevo texto', size: pub ? 20 : 28, color: dark(page.bg) ? '#ffffff' : '#111827', font: 'Arial', align: 'center', valign: 'middle' }), 'T Texto', 'Insertar cuadro de texto', false, 'insertar-texto')}
          {tb(() => imgInput.current?.click(), '🖼 Imagen', 'Insertar imagen')}
          <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100">⬟ Formas</summary>
            <div className="absolute z-30 mt-1 flex gap-1 rounded-lg border bg-white p-2 shadow-lg">{SHAPES.map(([k, icon]) => (
              <button key={k} className="grid h-9 w-9 place-items-center rounded text-lg hover:bg-slate-100" title={k} data-testid={`forma-${k}`}
                onClick={() => addEl({ id: uid(), type: 'shape', shape: k, x: deck.w * 0.35, y: deck.h * 0.35, w: k === 'line' || k === 'arrow' ? deck.w * 0.3 : deck.w * 0.15, h: k === 'line' || k === 'arrow' ? 20 : deck.w * 0.15, fill: '#1f45c8', stroke: k === 'line' || k === 'arrow' ? '#1f45c8' : undefined, strokeW: k === 'line' || k === 'arrow' ? 3 : 0 })}>{icon}</button>))}</div></details>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          {!pub && <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100" data-testid="nueva-diapositiva">＋ Diapositiva</summary>
            <div className="absolute z-30 mt-1 w-48 rounded-lg border bg-white p-1 shadow-lg">{([['titulo', 'Título'], ['contenido', 'Título y contenido'], ['dos', 'Dos columnas'], ['blanco', 'En blanco']] as const).map(([k, l]) => (
              <button key={k} className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => { const theme = Object.entries(THEMES).find(([, t]) => t.bg === page.bg)?.[0] ?? 'claro'; const p = newSlide(deck, k, theme); commit({ ...deck, pages: [...deck.pages.slice(0, pi + 1), p, ...deck.pages.slice(pi + 1)] }); setPi(pi + 1); setSel(null); }}>{l}</button>))}</div></details>}
          {pub && tb(() => { const p: Page = { id: uid(), bg: '#ffffff', els: [] }; commit({ ...deck, pages: [...deck.pages, p] }); setPi(deck.pages.length); }, '＋ Página', 'Agregar página')}
          <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100">🎨 Diseño</summary>
            <div className="absolute z-30 mt-1 w-64 rounded-lg border bg-white p-2 shadow-lg">
              <p className="mb-1 text-xs font-bold text-slate-500">Tema (todas las {pub ? 'páginas' : 'diapositivas'})</p>
              {Object.entries(THEMES).map(([k, t]) => <button key={k} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100" onClick={() => commit({ ...deck, pages: deck.pages.map((p) => ({ ...p, bg: t.bg, bg2: t.bg2, els: p.els.map((e) => (e.type === 'text' ? { ...e, color: e.b ? t.title : t.text } : e)) })) })}>
                <span className="h-5 w-8 rounded" style={{ background: t.bg2 ? `linear-gradient(135deg, ${t.bg}, ${t.bg2})` : t.bg, border: '1px solid #e2e8f0' }} />{t.label}</button>)}
              <p className="mb-1 mt-2 text-xs font-bold text-slate-500">Fondo de esta {pub ? 'página' : 'diapositiva'}</p>
              <div className="flex flex-wrap gap-1">{COLORS.map((x) => <button key={x} className="h-5 w-5 rounded border border-slate-200" style={{ background: x }} onClick={() => setPage((p) => ({ ...p, bg: x, bg2: undefined }))} aria-label={x} />)}
                <input type="color" value={page.bg} onChange={(e) => setPage((p) => ({ ...p, bg: e.target.value, bg2: undefined }), false)} className="h-5 w-8" aria-label="Otro color" /></div>
              {!pub && <><p className="mb-1 mt-2 text-xs font-bold text-slate-500">Transición de esta diapositiva</p>
                <select className="input py-1 text-sm" value={page.transition ?? 'none'} onChange={(e) => setPage((p) => ({ ...p, transition: e.target.value === 'none' ? undefined : e.target.value as Page['transition'] }))} data-testid="transicion">{TRANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <button className="mt-1 text-xs text-orange-700 hover:underline" onClick={() => commit({ ...deck, pages: deck.pages.map((p) => ({ ...p, transition: page.transition })) })}>Aplicar a todas</button>
                <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!page.hidden} onChange={(e) => setPage((p) => ({ ...p, hidden: e.target.checked || undefined }))} data-testid="ocultar-diapositiva" /> Ocultar en la presentación</label></>}
              <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!deck.grid} onChange={(e) => commit({ ...deck, grid: e.target.checked || undefined })} data-testid="ajustar-cuadricula" /> Cuadrícula y ajuste ({GRID} pt)</label>
              {pub && <><p className="mb-1 mt-2 text-xs font-bold text-slate-500">Tamaño</p>
                <select className="input py-1 text-sm" value={Object.entries(PAGE_SIZES).find(([, v]) => v.w === deck.w && v.h === deck.h)?.[0] ?? ''} onChange={(e) => { const z = PAGE_SIZES[e.target.value]; if (z) commit({ ...deck, w: z.w, h: z.h }); }}>
                  {Object.entries(PAGE_SIZES).filter(([k]) => !k.startsWith('slide')).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></>}
            </div></details>
          {tb(() => startPresent(pi), '▶', 'Presentar desde aquí')}
          {cur && <>
            <span className="mx-1 h-6 w-px bg-slate-200" />
            {cur.type === 'text' && <>
              <select className="h-8 w-28 rounded-md border border-slate-200 px-1 text-sm" value={cur.font ?? 'Arial'} onChange={(e) => patchEl(cur.id, { font: e.target.value })} aria-label="Fuente">{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
              <input type="number" min={6} max={200} className="h-8 w-16 rounded-md border border-slate-200 px-1 text-sm" value={cur.size ?? 18} onChange={(e) => patchEl(cur.id, { size: Number(e.target.value) || 18 }, false)} aria-label="Tamaño" data-testid="tamano-texto" />
              {tb(() => patchEl(cur.id, { b: !cur.b }), <b>N</b>, 'Negrita', cur.b)}{tb(() => patchEl(cur.id, { i: !cur.i }), <i>K</i>, 'Cursiva', cur.i)}{tb(() => patchEl(cur.id, { u: !cur.u }), <u>S</u>, 'Subrayado', cur.u)}
              {(['left', 'center', 'right'] as const).map((a) => tb(() => patchEl(cur.id, { align: a }), { left: '⬅', center: '↔', right: '➡' }[a], `Alinear ${a}`, (cur.align ?? 'left') === a))}
              <label className="flex items-center gap-1 text-xs text-slate-500">Texto<input type="color" value={cur.color ?? '#111111'} onChange={(e) => patchEl(cur.id, { color: e.target.value }, false)} className="h-7 w-8" /></label>
            </>}
            {cur.type !== 'image' && <label className="flex items-center gap-1 text-xs text-slate-500">Relleno<input type="color" value={cur.fill ?? '#ffffff'} onChange={(e) => patchEl(cur.id, { fill: e.target.value }, false)} className="h-7 w-8" data-testid="color-relleno" /></label>}
            {cur.type === 'shape' && <label className="flex items-center gap-1 text-xs text-slate-500">Borde<input type="color" value={cur.stroke ?? '#000000'} onChange={(e) => patchEl(cur.id, { stroke: e.target.value, strokeW: cur.strokeW || 2 }, false)} className="h-7 w-8" /></label>}
            {tb(() => order(true), '⬆', 'Traer al frente')}{tb(() => order(false), '⬇', 'Enviar al fondo')}
            <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100" title="Alinear y girar" data-testid="menu-organizar">⊹ Organizar</summary>
              <div className="absolute z-30 mt-1 w-64 space-y-2 rounded-lg border bg-white p-2 text-sm shadow-lg">
                <p className="text-xs font-bold text-slate-500">Alinear con la {pub ? 'página' : 'diapositiva'}</p>
                <div className="grid grid-cols-3 gap-1">
                  {([['izq', '⇤ Izquierda', { x: 0 }], ['centroH', '↔ Centro', { x: Math.round((deck.w - cur.w) / 2) }], ['der', 'Derecha ⇥', { x: deck.w - cur.w }],
                    ['arr', '⤒ Arriba', { y: 0 }], ['centroV', '↕ Medio', { y: Math.round((deck.h - cur.h) / 2) }], ['aba', '⤓ Abajo', { y: deck.h - cur.h }]] as [string, string, Partial<El>][]).map(([k, l, patch]) => (
                    <button key={k} className="rounded border border-slate-200 px-1 py-1 text-xs hover:bg-slate-100 disabled:opacity-40" disabled={cur.lock} onClick={() => patchEl(cur.id, patch)} data-testid={`alinear-${k}`}>{l}</button>))}
                </div>
                <label className="flex items-center gap-2 text-xs">Girar
                  <input type="number" min={-360} max={360} className="input h-7 w-20" value={cur.rot ?? 0} onChange={(e) => patchEl(cur.id, { rot: ((Number(e.target.value) || 0) % 360) || undefined }, false)} data-testid="rotacion" />°
                  <button className="rounded border px-2 py-0.5" onClick={() => patchEl(cur.id, { rot: (((cur.rot ?? 0) + 90) % 360) || undefined })} data-testid="girar-90">↻ 90°</button></label>
                <label className="flex items-center gap-2 text-xs">Transparencia
                  <input type="range" min={10} max={100} value={Math.round((cur.opacity ?? 1) * 100)} onChange={(e) => patchEl(cur.id, { opacity: Number(e.target.value) / 100 }, false)} data-testid="opacidad" />{Math.round((cur.opacity ?? 1) * 100)}%</label>
                {!pub && <label className="flex items-center gap-2 text-xs">Animación
                  <select className="input h-7 flex-1" value={cur.anim ?? 'none'} onChange={(e) => patchEl(cur.id, { anim: e.target.value === 'none' ? undefined : e.target.value as El['anim'] })} data-testid="animacion">{ANIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
              </div></details>
            {tb(() => patchEl(cur.id, { lock: !cur.lock || undefined }), cur.lock ? '🔒' : '🔓', cur.lock ? 'Desbloquear' : 'Bloquear posición', cur.lock, 'bloquear')}
            {tb(() => addEl({ ...cur, id: uid(), x: cur.x + 16, y: cur.y + 16 }), '⧉', 'Duplicar (Ctrl+D)')}{tb(removeSel, '🗑', 'Eliminar (Supr)')}
          </>}
        </div>)}
      <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="mt-3 flex gap-3">
        <aside className="w-36 shrink-0 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: '72vh' }} data-testid="miniaturas">
          {deck.pages.map((p, i) => (
            <div key={p.id} className={`group relative cursor-pointer rounded-md p-1 ${i === pi ? 'ring-2 ring-orange-500' : 'hover:ring-1 hover:ring-slate-300'}`} onClick={() => { setPi(i); setSel(null); setEditing(null); }}>
              <span className="absolute left-0 top-0 z-10 rounded-br bg-white/90 px-1 text-[10px] font-bold">{i + 1}{p.hidden && !pub ? ' · oculta' : ''}</span>
              <div className={`pointer-events-none ${p.hidden && !pub ? 'opacity-40' : ''}`} data-testid={p.hidden ? 'miniatura-oculta' : undefined}><PageView deck={deck} page={p} width={124} /></div>
              {doc.canEdit && <span className="absolute right-1 top-1 z-10 hidden gap-0.5 group-hover:flex">
                <button className="rounded bg-white/90 px-1 text-[10px]" title="Subir" onClick={(e) => { e.stopPropagation(); if (i > 0) { const ps = [...deck.pages]; [ps[i - 1], ps[i]] = [ps[i], ps[i - 1]]; commit({ ...deck, pages: ps }); setPi(i - 1); } }}>▲</button>
                <button className="rounded bg-white/90 px-1 text-[10px]" title="Duplicar" onClick={(e) => { e.stopPropagation(); const copy = { ...p, id: uid(), els: p.els.map((x) => ({ ...x, id: uid() })) }; commit({ ...deck, pages: [...deck.pages.slice(0, i + 1), copy, ...deck.pages.slice(i + 1)] }); }}>⧉</button>
                {deck.pages.length > 1 && <button className="rounded bg-white/90 px-1 text-[10px] text-red-600" title="Eliminar" onClick={(e) => { e.stopPropagation(); commit({ ...deck, pages: deck.pages.filter((_, j) => j !== i) }); setPi(Math.max(0, Math.min(pi, deck.pages.length - 2))); }}>✕</button>}
              </span>}
            </div>))}
        </aside>
        <div ref={stage} className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-slate-200/70 p-4" onDoubleClick={() => { if (cur?.type === 'text' && doc.canEdit) setEditing(cur.id); }}>
          <div data-testid="lienzo">
            <PageView deck={deck} page={page} width={width} sel={sel} editing={editing} onDown={onDown} onResize={doc.canEdit ? onResize : undefined} grid={deck.grid && doc.canEdit}
              onText={(id, t) => { patchEl(id, { text: t }); setEditing(null); }} />
          </div>
          {!pub && <textarea className="mt-3 w-full max-w-3xl rounded-lg border border-slate-300 bg-white p-2 text-sm" rows={2} placeholder="Notas del orador (solo las ve usted)…" disabled={!doc.canEdit}
            value={page.notes ?? ''} onChange={(e) => setPage((p) => ({ ...p, notes: e.target.value }), false)} />}
          <p className="mt-2 text-xs text-slate-500">Doble clic en un texto para escribir · arrastre para mover · esquinas para cambiar el tamaño (Mayús mantiene la proporción de imágenes) · Supr elimina.</p>
        </div>
      </div>
      {pres && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black" onClick={() => advance(1)} data-testid="modo-presentacion">
          <PageView key={pres.id} deck={deck} page={pres} reveal={step} className={pres.transition && pres.transition !== 'none' ? `trans-${pres.transition}` : ''}
            width={Math.min(typeof window !== 'undefined' ? window.innerWidth : 1280, (typeof window !== 'undefined' ? window.innerHeight : 720) * (deck.w / deck.h))} />
          <span className="absolute bottom-3 right-4 text-sm text-white/60" data-testid="contador-presentacion">{(present ?? 0) + 1} / {shown.length} · Esc para salir</span>
          <button className="absolute right-3 top-3 rounded bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20" onClick={(e) => { e.stopPropagation(); setPresent(null); document.fullscreenElement && document.exitFullscreen().catch(() => {}); }}>✕ Salir</button>
        </div>)}
    </div>
  );
}
