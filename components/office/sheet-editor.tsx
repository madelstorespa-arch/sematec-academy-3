'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addr, colName, computeWorkbook, display, loadEngine, newSheet, parseAddr, SHEET_FORMATS, exportWorkbook, type CellStyle, type Sheet, type Workbook, type Value } from '@/lib/office/sheet';
import { sheetTemplate } from '@/lib/office/templates';
import { OfficeBar, useAutosave, useMenus, type OfficeDocProps } from './shell';

const DEF_W = 96; const ROW_H = 24; const MAX_ROWS = 2000; const MAX_COLS = 60;
const COLORS = ['#000000', '#c00000', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#1f45c8', '#7c3aed', '#64748b'];
const FILLS = ['', '#fef9c3', '#dcfce7', '#dbeafe', '#fce7f3', '#ffedd5', '#e2e8f0', '#1f45c8', '#16a34a', '#c00000'];
type Sel = { r: number; c: number; r2: number; c2: number };
const norm = (s: Sel) => ({ r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2), c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2) });

function Chart({ sheet, vals, sel, onClose }: { sheet: Sheet; vals: Record<string, Value>; sel: Sel; onClose: () => void }) {
  const [kind, setKind] = useState<'bar' | 'line' | 'pie'>('bar');
  const n = norm(sel);
  const labels: string[] = []; const nums: number[] = [];
  const twoCols = n.c2 > n.c1;
  for (let r = n.r1; r <= n.r2; r++) {
    const v = vals[addr(r, twoCols ? n.c1 + 1 : n.c1)];
    if (typeof v === 'number') { nums.push(v); labels.push(twoCols ? display(vals[addr(r, n.c1)] ?? null) : `${r + 1}`); }
  }
  const max = Math.max(1, ...nums.map(Math.abs)); const W = 520, H = 260, pad = 36;
  const PAL = ['#1f45c8', '#10b5a3', '#7c3aed', '#ea580c', '#db2777', '#0ea5e9', '#16a34a', '#ca8a04'];
  const svg = useRef<SVGSVGElement>(null);
  const png = () => {
    const x = new XMLSerializer().serializeToString(svg.current!); const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `Gráfico - ${sheet.name}.png`; a.click(); };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(x)}`;
  };
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg" data-testid="grafico">
      <div className="mb-2 flex items-center gap-2 text-sm"><b>📊 Gráfico</b>
        {(['bar', 'line', 'pie'] as const).map((k) => <button key={k} className={`rounded px-2 py-1 ${kind === k ? 'bg-blue-100 text-blue-800' : 'hover:bg-slate-100'}`} onClick={() => setKind(k)}>{{ bar: 'Barras', line: 'Líneas', pie: 'Circular' }[k]}</button>)}
        <button className="ml-auto rounded px-2 py-1 hover:bg-slate-100" onClick={png}>⬇ PNG</button><button className="rounded px-2 py-1 hover:bg-slate-100" onClick={onClose}>✕</button></div>
      {!nums.length ? <p className="text-sm text-slate-500">Seleccione una columna de números (o dos columnas: nombres y números).</p> : (
        <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" fontFamily="Arial" fontSize="10">
          <rect width={W} height={H} fill="#fff" />
          {kind === 'pie' ? (() => {
            const total = nums.reduce((a, b) => a + Math.abs(b), 0) || 1; let a0 = -Math.PI / 2;
            return nums.map((v, i) => { const a1 = a0 + (Math.abs(v) / total) * Math.PI * 2; const r = 100, cx = 140, cy = H / 2;
              const p = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`; a0 = a1;
              return <g key={i}><path d={p} fill={PAL[i % PAL.length]} stroke="#fff" /><rect x={280} y={20 + i * 18} width={10} height={10} fill={PAL[i % PAL.length]} /><text x={296} y={29 + i * 18}>{labels[i]} ({Math.round((Math.abs(v) / total) * 100)}%)</text></g>; });
          })() : <>
            <line x1={pad} y1={H - pad} x2={W - 10} y2={H - pad} stroke="#94a3b8" />
            {nums.map((v, i) => { const bw = (W - pad - 20) / nums.length; const h = (Math.abs(v) / max) * (H - 2 * pad); const x = pad + i * bw;
              return <g key={i}>{kind === 'bar' ? <rect x={x + bw * 0.15} y={H - pad - h} width={bw * 0.7} height={h} fill={PAL[0]} rx={2} />
                : i > 0 && <line x1={x - bw / 2} y1={H - pad - (Math.abs(nums[i - 1]) / max) * (H - 2 * pad)} x2={x + bw / 2} y2={H - pad - h} stroke={PAL[0]} strokeWidth={2.5} />}
                {kind === 'line' && <circle cx={x + bw / 2} cy={H - pad - h} r={3} fill={PAL[0]} />}
                <text x={x + bw / 2} y={H - pad + 13} textAnchor="middle">{labels[i].slice(0, 12)}</text>
                <text x={x + bw / 2} y={H - pad - h - 4} textAnchor="middle" fill="#334155">{v.toLocaleString('es-CL')}</text></g>; })}
          </>}
        </svg>)}
    </div>
  );
}

export function SheetEditor({ doc }: { doc: OfficeDocProps }) {
  const [wb, setWb] = useState<Workbook>(() => {
    const c = doc.content as { wb?: Workbook; template?: string };
    return c.wb?.sheets?.length ? c.wb : sheetTemplate(c.template ?? 'blanco');
  });
  const [title, setTitle] = useState(doc.title);
  const [si, setSi] = useState(0);
  const [sel, setSel] = useState<Sel>({ r: 0, c: 0, r2: 0, c2: 0 });
  const [edit, setEdit] = useState<string | null>(null);
  const [inBar, setInBar] = useState(false);
  const barMove = useRef<[number, number] | 'cancel' | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [chart, setChart] = useState(false);
  const hist = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] });
  const save = useAutosave(doc.id, doc.canEdit);
  const menus = useMenus<HTMLDivElement>();
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  useEffect(() => { loadEngine().then(() => setReady(true)); }, []);
  const sheet = wb.sheets[Math.min(si, wb.sheets.length - 1)];
  const values = useMemo(() => (ready ? computeWorkbook(wb) : computeWorkbook({ sheets: [] })), [wb, ready]);
  const vals = values[sheet.name] ?? {};
  const titleRef = useRef(title); titleRef.current = title;
  const commit = useCallback((next: Workbook) => {
    hist.current.past.push(wb); if (hist.current.past.length > 60) hist.current.past.shift(); hist.current.future = [];
    setWb(next); save.change(titleRef.current, { wb: next });
  }, [wb, save]);
  useEffect(() => { if (title !== doc.title) save.change(title, { wb }); }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!(doc.content as { wb?: Workbook }).wb && doc.canEdit) save.change(title, { wb }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const undo = () => { const p = hist.current.past.pop(); if (p) { hist.current.future.push(wb); setWb(p); save.change(title, { wb: p }); } };
  const redo = () => { const f = hist.current.future.pop(); if (f) { hist.current.past.push(wb); setWb(f); save.change(title, { wb: f }); } };

  const updateSheet = (fn: (s: Sheet) => Sheet) => commit({ sheets: wb.sheets.map((s, i) => (i === si ? fn(s) : s)) });
  const setCells = (changes: Record<string, Partial<{ v: string; s: CellStyle | undefined }>>) => updateSheet((s) => {
    const cells = { ...s.cells };
    for (const [k, ch] of Object.entries(changes)) {
      const cur = cells[k] ?? { v: '' }; const nx = { ...cur, ...ch };
      if (nx.s && !Object.values(nx.s).some((x) => x !== undefined && x !== false && x !== '')) delete nx.s;
      if (nx.v === '' && !nx.s) delete cells[k]; else cells[k] = nx as { v: string; s?: CellStyle };
    }
    return { ...s, cells };
  });
  const n = norm(sel);
  const eachSel = (f: (k: string, r: number, c: number) => void) => { for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) f(addr(r, c), r, c); };
  const styleSel = (patch: Partial<CellStyle>) => { const ch: Record<string, { s: CellStyle }> = {}; eachSel((k) => { ch[k] = { s: { ...(sheet.cells[k]?.s ?? {}), ...patch } }; }); setCells(ch); };
  const cur = sheet.cells[addr(sel.r, sel.c)];
  const st = cur?.s ?? {};
  const commitEdit = (raw: string | null, move?: [number, number]) => {
    if (raw !== null && raw !== (cur?.v ?? '')) setCells({ [addr(sel.r, sel.c)]: { v: raw } });
    setEdit(null);
    if (move) { const r = Math.max(0, Math.min(sheet.rows - 1, sel.r + move[0])); const c = Math.max(0, Math.min(sheet.cols - 1, sel.c + move[1])); setSel({ r, c, r2: r, c2: c }); }
  };
  // Al terminar de escribir en una celda, el teclado vuelve a la grilla (sin perder las teclas siguientes)
  useEffect(() => {
    if (edit === null && !inBar) { const a = document.activeElement; if (!a || a === document.body || (grid.current?.contains(a) && a !== grid.current)) grid.current?.focus(); }
  }, [edit, inBar]);
  const autosum = () => {
    let r = sel.r - 1; while (r >= 0 && typeof vals[addr(r, sel.c)] === 'number') r--;
    if (r === sel.r - 1) return;
    setCells({ [addr(sel.r, sel.c)]: { v: `=SUMA(${addr(r + 1, sel.c)}:${addr(sel.r - 1, sel.c)})` } });
  };
  const copy = async (cut = false) => {
    const lines: string[] = [];
    for (let r = n.r1; r <= n.r2; r++) { const row: string[] = []; for (let c = n.c1; c <= n.c2; c++) row.push(sheet.cells[addr(r, c)]?.v ?? ''); lines.push(row.join('\t')); }
    await navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
    if (cut) { const ch: Record<string, { v: string }> = {}; eachSel((k) => { ch[k] = { v: '' }; }); setCells(ch); }
  };
  const paste = (text: string) => {
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const ch: Record<string, { v: string }> = {};
    rows.forEach((row, i) => row.forEach((v, j) => { if (sel.r + i < MAX_ROWS && sel.c + j < MAX_COLS) ch[addr(sel.r + i, sel.c + j)] = { v }; }));
    updateSheet((s) => {
      const cells = { ...s.cells }; for (const [k, x] of Object.entries(ch)) { if (x.v === '' && !cells[k]?.s) delete cells[k]; else cells[k] = { ...(cells[k] ?? {}), v: x.v }; }
      return { ...s, cells, rows: Math.max(s.rows, sel.r + rows.length + 5), cols: Math.max(s.cols, sel.c + Math.max(...rows.map((r) => r.length)) + 1) };
    });
  };
  const shiftCells = (axis: 'row' | 'col', at: number, delta: 1 | -1) => updateSheet((s) => {
    const cells: Sheet['cells'] = {};
    for (const [k, v] of Object.entries(s.cells)) {
      const p = parseAddr(k)!; let [r, c] = p;
      if (axis === 'row') { if (delta < 0 && r === at) continue; if (r >= at + (delta < 0 ? 1 : 0)) r += delta; } else { if (delta < 0 && c === at) continue; if (c >= at + (delta < 0 ? 1 : 0)) c += delta; }
      cells[addr(r, c)] = v;
    }
    return { ...s, cells, rows: axis === 'row' ? Math.max(1, s.rows + delta) : s.rows, cols: axis === 'col' ? Math.max(1, s.cols + delta) : s.cols };
  });
  const sortSel = (asc: boolean) => {
    const rows: { cells: Record<number, Sheet['cells'][string]>; key: Value }[] = [];
    for (let r = n.r1; r <= n.r2; r++) { const cells: Record<number, Sheet['cells'][string]> = {}; for (let c = n.c1; c <= n.c2; c++) { const x = sheet.cells[addr(r, c)]; if (x) cells[c] = x; } rows.push({ cells, key: vals[addr(r, n.c1)] ?? null }); }
    const cmp = (a: Value, b: Value) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'es'));
    rows.sort((a, b) => (asc ? cmp(a.key, b.key) : cmp(b.key, a.key)));
    updateSheet((s) => { const cells = { ...s.cells }; rows.forEach((row, i) => { for (let c = n.c1; c <= n.c2; c++) { const k = addr(n.r1 + i, c); if (row.cells[c]) cells[k] = row.cells[c]; else delete cells[k]; } }); return { ...s, cells }; });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (edit !== null || !doc.canEdit && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const mod = e.ctrlKey || e.metaKey;
    const mv: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] };
    if (mv[e.key]) {
      e.preventDefault(); const [dr, dc] = e.key === 'Tab' && e.shiftKey ? [0, -1] : mv[e.key];
      if (e.shiftKey && e.key.startsWith('Arrow')) setSel({ ...sel, r2: Math.max(0, Math.min(sheet.rows - 1, sel.r2 + dr)), c2: Math.max(0, Math.min(sheet.cols - 1, sel.c2 + dc)) });
      else { const r = Math.max(0, Math.min(sheet.rows - 1, sel.r + dr)); const c = Math.max(0, Math.min(sheet.cols - 1, sel.c + dc)); setSel({ r, c, r2: r, c2: c }); }
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); styleSel({ b: !st.b }); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); styleSel({ i: !st.i }); return; }
    if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); styleSel({ u: !st.u }); return; }
    if (mod && e.key.toLowerCase() === 'c') { copy(); return; }
    if (mod && e.key.toLowerCase() === 'x') { copy(true); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const ch: Record<string, { v: string }> = {}; eachSel((k) => { ch[k] = { v: '' }; }); setCells(ch); return; }
    if (e.key === 'F2') { setEdit(cur?.v ?? ''); return; }
    if (e.key.length === 1 && !mod) { e.preventDefault(); setEdit(e.key); }
  };
  const widths = (c: number) => sheet.widths?.[c] ?? DEF_W;
  const startResize = (c: number, x0: number) => {
    const w0 = widths(c);
    const move = (e: MouseEvent) => setWb((b) => ({ sheets: b.sheets.map((s, i) => (i === si ? { ...s, widths: { ...(s.widths ?? {}), [c]: Math.max(30, w0 + e.clientX - x0) } } : s)) }));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setWb((b) => { save.change(titleRef.current, { wb: b }); return b; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const rowsShown = Math.min(sheet.rows, MAX_ROWS);
  const tb = (on: () => void, label: React.ReactNode, title: string, active?: boolean, testid?: string) =>
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={on} data-testid={testid} disabled={!doc.canEdit}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-sm disabled:opacity-40 ${active ? 'bg-emerald-100 text-emerald-800' : 'text-slate-700 hover:bg-slate-100'}`}>{label}</button>;
  const selLabel = n.r1 === n.r2 && n.c1 === n.c2 ? addr(sel.r, sel.c) : `${addr(n.r1, n.c1)}:${addr(n.r2, n.c2)}`;
  const nums = (() => { const xs: number[] = []; eachSel((k) => { const v = vals[k]; if (typeof v === 'number') xs.push(v); }); return xs; })();
  return (
    <div>
      <OfficeBar doc={doc} title={title} setTitle={setTitle} status={save.status} msg={save.msg} formats={SHEET_FORMATS} saveExt="xlsx" exportAs={(f) => exportWorkbook(wb, title, f, si)} />
      <div ref={menus} className="flex flex-wrap items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm" data-testid="cinta-excel">
        {tb(undo, '↶', 'Deshacer')}{tb(redo, '↷', 'Rehacer')}<span className="mx-1 h-6 w-px bg-slate-200" />
        {tb(() => styleSel({ b: !st.b }), <b>N</b>, 'Negrita', st.b, 'celda-negrita')}{tb(() => styleSel({ i: !st.i }), <i>K</i>, 'Cursiva', st.i)}{tb(() => styleSel({ u: !st.u }), <u>S</u>, 'Subrayado', st.u)}
        <details className="relative"><summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md hover:bg-slate-100" title="Color de texto"><span className="border-b-4 font-bold leading-none" style={{ borderColor: st.color ?? '#000' }}>A</span></summary>
          <div className="absolute z-30 mt-1 flex w-44 flex-wrap gap-1 rounded-lg border bg-white p-2 shadow-lg">{COLORS.map((x) => <button key={x} className="h-5 w-5 rounded" style={{ background: x }} onClick={() => styleSel({ color: x === '#000000' ? undefined : x })} aria-label={x} />)}</div></details>
        <details className="relative"><summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md hover:bg-slate-100" title="Color de relleno">🪣</summary>
          <div className="absolute z-30 mt-1 flex w-44 flex-wrap gap-1 rounded-lg border bg-white p-2 shadow-lg">{FILLS.map((x) => <button key={x || 'none'} className="h-5 w-5 rounded border border-slate-200" style={{ background: x || '#fff' }} onClick={() => styleSel({ bg: x || undefined })} aria-label={x || 'Sin relleno'}>{x ? '' : '✕'}</button>)}</div></details>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        {tb(() => styleSel({ align: 'left' }), '⬅', 'Izquierda', st.align === 'left')}{tb(() => styleSel({ align: 'center' }), '↔', 'Centro', st.align === 'center')}{tb(() => styleSel({ align: 'right' }), '➡', 'Derecha', st.align === 'right')}
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <select className="h-8 rounded-md border border-slate-200 px-1 text-sm" value={st.fmt ?? 'general'} onChange={(e) => styleSel({ fmt: e.target.value as CellStyle['fmt'] })} aria-label="Formato de número" disabled={!doc.canEdit} data-testid="formato-numero">
          <option value="general">General</option><option value="number">Número</option><option value="currency">Moneda ($)</option><option value="percent">Porcentaje</option><option value="date">Fecha</option><option value="text">Texto</option></select>
        {tb(() => styleSel({ dec: Math.min(6, (st.dec ?? (st.fmt === 'number' ? 2 : 0)) + 1) }), '.0+', 'Más decimales')}{tb(() => styleSel({ dec: Math.max(0, (st.dec ?? 2) - 1) }), '.0−', 'Menos decimales')}
        <span className="mx-1 h-6 w-px bg-slate-200" />
        {tb(autosum, 'Σ', 'Autosuma', false, 'autosuma')}
        {tb(() => shiftCells('row', sel.r, 1), '+ fila', 'Insertar fila')}{tb(() => shiftCells('row', sel.r, -1), '− fila', 'Eliminar fila')}
        {tb(() => shiftCells('col', sel.c, 1), '+ col.', 'Insertar columna')}{tb(() => shiftCells('col', sel.c, -1), '− col.', 'Eliminar columna')}
        {tb(() => sortSel(true), 'A→Z', 'Ordenar ascendente')}{tb(() => sortSel(false), 'Z→A', 'Ordenar descendente')}
        <button type="button" className="grid h-8 place-items-center rounded-md px-2 text-sm hover:bg-slate-100" onClick={() => setChart((v) => !v)} data-testid="boton-grafico">📊 Gráfico</button>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
        <span className="w-20 shrink-0 text-center font-mono text-xs text-slate-500" data-testid="celda-activa">{selLabel}</span>
        <span className="italic text-slate-400">fx</span>
        <input className="min-w-0 flex-1 px-2 py-1 font-mono text-sm outline-none" value={edit ?? cur?.v ?? ''} disabled={!doc.canEdit} data-testid="barra-formulas"
          onChange={(e) => setEdit(e.target.value)} onFocus={() => { setInBar(true); setEdit(cur?.v ?? ''); }} onBlur={() => { setInBar(false); const m = barMove.current; barMove.current = undefined; if (m === 'cancel') { setEdit(null); return; } if (edit !== null) commitEdit(edit, m); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); barMove.current = [1, 0]; e.currentTarget.blur(); } else if (e.key === 'Escape') { barMove.current = 'cancel'; grid.current?.focus(); } }} />
      </div>
      <div ref={grid} tabIndex={0} onKeyDown={onKey} onPaste={(e) => { if (edit === null && doc.canEdit) { e.preventDefault(); paste(e.clipboardData.getData('text')); } }}
        className="mt-2 max-h-[70vh] overflow-auto rounded-lg border border-slate-300 bg-white outline-none focus:ring-2 focus:ring-emerald-400" data-testid="grilla">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed' }} onMouseUp={() => { drag.current = false; }}>
          <colgroup><col style={{ width: 44 }} />{Array.from({ length: sheet.cols }, (_, c) => <col key={c} style={{ width: widths(c) }} />)}</colgroup>
          <thead><tr><th className="sticky left-0 top-0 z-20 border border-slate-300 bg-slate-100" />
            {Array.from({ length: sheet.cols }, (_, c) => (
              <th key={c} className={`sticky top-0 z-10 select-none border border-slate-300 px-1 text-xs font-medium ${c >= n.c1 && c <= n.c2 ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-600'}`}
                onClick={() => setSel({ r: 0, c, r2: sheet.rows - 1, c2: c })}>
                <span className="relative block">{colName(c)}<span className="absolute -right-1 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.stopPropagation(); startResize(c, e.clientX); }} /></span></th>))}</tr></thead>
          <tbody>{Array.from({ length: rowsShown }, (_, r) => (
            <tr key={r} style={{ height: ROW_H }}>
              <td className={`sticky left-0 z-10 select-none border border-slate-300 text-center text-xs ${r >= n.r1 && r <= n.r2 ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-500'}`} onClick={() => setSel({ r, c: 0, r2: r, c2: sheet.cols - 1 })}>{r + 1}</td>
              {Array.from({ length: sheet.cols }, (_, c) => {
                const k = addr(r, c); const cell = sheet.cells[k]; const s = cell?.s; const v = vals[k] ?? null;
                const active = r === sel.r && c === sel.c; const inSel = r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
                return (
                  <td key={c} className={`overflow-hidden whitespace-nowrap border border-slate-200 px-1 ${active ? 'outline outline-2 -outline-offset-2 outline-emerald-600' : ''} ${inSel && !active ? 'bg-emerald-50' : ''}`}
                    style={{ background: !inSel || active ? s?.bg : undefined, color: typeof v === 'object' && v ? '#c00000' : s?.color, fontWeight: s?.b ? 700 : undefined, fontStyle: s?.i ? 'italic' : undefined, textDecoration: s?.u ? 'underline' : undefined, textAlign: s?.align ?? (typeof v === 'number' ? 'right' : 'left') }}
                    onMouseDown={(e) => { if (edit !== null) commitEdit(edit); drag.current = true; setSel(e.shiftKey ? { ...sel, r2: r, c2: c } : { r, c, r2: r, c2: c }); }}
                    onMouseEnter={() => { if (drag.current) setSel((x) => ({ ...x, r2: r, c2: c })); }}
                    onDoubleClick={() => doc.canEdit && setEdit(cell?.v ?? '')} data-cell={k}>
                    {active && edit !== null && !inBar ? <input autoFocus className="h-full w-full bg-white font-mono text-sm outline-none" value={edit} onChange={(e) => setEdit(e.target.value)} data-testid="editor-celda"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(edit, [1, 0]); } else if (e.key === 'Tab') { e.preventDefault(); commitEdit(edit, [0, e.shiftKey ? -1 : 1]); } else if (e.key === 'Escape') { setEdit(null); grid.current?.focus(); } }}
                      onBlur={() => commitEdit(edit)} /> : display(v, s)}
                  </td>);
              })}
            </tr>))}</tbody>
        </table>
        {doc.canEdit && sheet.rows < MAX_ROWS && <button className="m-2 text-xs text-emerald-700 hover:underline" onClick={() => updateSheet((s) => ({ ...s, rows: Math.min(MAX_ROWS, s.rows + 50) }))}>+ 50 filas</button>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-sm" data-testid="hojas">
        {wb.sheets.map((s, i) => (
          <button key={i} className={`rounded-t-md border-x border-b-2 px-3 py-1 ${i === si ? 'border-emerald-600 bg-white font-semibold text-emerald-800' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
            onClick={() => { setSi(i); setSel({ r: 0, c: 0, r2: 0, c2: 0 }); }}
            onDoubleClick={() => { if (!doc.canEdit) return; const nm = prompt('Nombre de la hoja', s.name)?.trim().slice(0, 31); if (nm && !wb.sheets.some((x, j) => j !== i && x.name === nm)) commit({ sheets: wb.sheets.map((x, j) => (j === i ? { ...x, name: nm } : x)) }); }}>{s.name}</button>))}
        {doc.canEdit && <button className="rounded px-2 py-1 text-emerald-700 hover:bg-emerald-50" onClick={() => { let k = wb.sheets.length + 1; while (wb.sheets.some((s) => s.name === `Hoja${k}`)) k++; commit({ sheets: [...wb.sheets, newSheet(`Hoja${k}`)] }); setSi(wb.sheets.length); }} data-testid="nueva-hoja">＋</button>}
        {doc.canEdit && wb.sheets.length > 1 && <button className="ml-2 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => { if (confirm(`¿Eliminar la hoja «${sheet.name}»?`)) { commit({ sheets: wb.sheets.filter((_, j) => j !== si) }); setSi(0); } }}>Eliminar hoja</button>}
        <span className="ml-auto text-xs text-slate-500" data-testid="resumen-seleccion">{nums.length > 1 && `Suma: ${display(nums.reduce((a, b) => a + b, 0))} · Promedio: ${display(nums.reduce((a, b) => a + b, 0) / nums.length)} · Recuento: ${nums.length}`}</span>
      </div>
      {chart && <Chart sheet={sheet} vals={vals} sel={sel} onClose={() => setChart(false)} />}
      <p className="mt-2 text-xs text-slate-500">Fórmulas como en Excel, también en español: =SUMA(A1:A10), =PROMEDIO(…), =SI(B2&gt;=4;&quot;Aprobado&quot;;&quot;Reprobado&quot;), =BUSCARV(…). Copie y pegue desde Excel o Google Sheets.</p>
    </div>
  );
}
