'use client';
/**
 * 🖼 Presentaciones (tipo PowerPoint) y publicaciones (tipo Publisher): modelo de páginas con
 * textos, imágenes y formas; exporta a PPTX, PDF, PNG y JPG e importa presentaciones PPTX.
 * Las medidas están en puntos (1/72 de pulgada).
 */
import type { Fmt } from '@/lib/convert/media';

export type El = {
  id: string; type: 'text' | 'image' | 'shape'; x: number; y: number; w: number; h: number;
  text?: string; font?: string; size?: number; color?: string; b?: boolean; i?: boolean; u?: boolean;
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom';
  fill?: string; stroke?: string; strokeW?: number; shape?: 'rect' | 'round' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'star'; src?: string; opacity?: number;
};
export type Page = { id: string; bg: string; bg2?: string; els: El[]; notes?: string };
export type Deck = { kind: 'slides' | 'pub'; w: number; h: number; pages: Page[] };

export const SLIDE_FORMATS: Fmt[] = [
  { id: 'pptx', label: 'PowerPoint (.pptx)', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { id: 'png', label: 'Imagen PNG (página actual)', ext: 'png', mime: 'image/png' },
  { id: 'jpg', label: 'Imagen JPG (página actual)', ext: 'jpg', mime: 'image/jpeg' },
];
export const PUB_FORMATS: Fmt[] = [
  { id: 'pdf', label: 'PDF para imprimir', ext: 'pdf', mime: 'application/pdf' },
  { id: 'png', label: 'Imagen PNG', ext: 'png', mime: 'image/png' },
  { id: 'jpg', label: 'Imagen JPG', ext: 'jpg', mime: 'image/jpeg' },
  { id: 'pptx', label: 'PowerPoint (.pptx)', ext: 'pptx', mime: SLIDE_FORMATS[0].mime },
];
export const PAGE_SIZES: Record<string, { label: string; w: number; h: number }> = {
  slide: { label: 'Presentación 16:9', w: 960, h: 540 },
  slide43: { label: 'Presentación 4:3', w: 720, h: 540 },
  a4: { label: 'A4 vertical', w: 595, h: 842 },
  a4h: { label: 'A4 horizontal', w: 842, h: 595 },
  carta: { label: 'Carta vertical', w: 612, h: 792 },
  a5: { label: 'Volante A5', w: 420, h: 595 },
  tarjeta: { label: 'Tarjeta de presentación', w: 252, h: 144 },
  post: { label: 'Publicación cuadrada (redes)', w: 540, h: 540 },
};

export const uid = () => Math.random().toString(36).slice(2, 10);
const T = (o: Partial<El>): El => ({ id: uid(), type: 'text', x: 60, y: 60, w: 400, h: 60, text: 'Texto', font: 'Arial', size: 24, color: '#111827', align: 'left', valign: 'top', ...o });
const S = (o: Partial<El>): El => ({ id: uid(), type: 'shape', x: 0, y: 0, w: 100, h: 100, shape: 'rect', fill: '#1f45c8', ...o });

export const THEMES: Record<string, { label: string; bg: string; bg2?: string; title: string; text: string; accent: string }> = {
  claro: { label: 'Claro', bg: '#ffffff', title: '#0f172a', text: '#334155', accent: '#1f45c8' },
  azul: { label: 'Azul institucional', bg: '#0b1736', bg2: '#1f45c8', title: '#ffffff', text: '#dbeafe', accent: '#10b5a3' },
  oscuro: { label: 'Oscuro', bg: '#111827', title: '#f9fafb', text: '#d1d5db', accent: '#f59e0b' },
  verde: { label: 'Verde', bg: '#ecfdf5', title: '#064e3b', text: '#065f46', accent: '#10b981' },
  atardecer: { label: 'Atardecer', bg: '#7c2d12', bg2: '#db2777', title: '#ffffff', text: '#ffe4e6', accent: '#fde047' },
};

export function newSlide(deck: Deck, layout: 'titulo' | 'contenido' | 'blanco' | 'dos' = 'contenido', theme = 'claro'): Page {
  const t = THEMES[theme] ?? THEMES.claro; const { w, h } = deck;
  const els: El[] = [];
  if (layout === 'titulo') {
    els.push(S({ x: 0, y: h * 0.62, w, h: 6, fill: t.accent }));
    els.push(T({ x: 60, y: h * 0.3, w: w - 120, h: 90, text: 'Título de la presentación', size: 44, b: true, color: t.title }));
    els.push(T({ x: 60, y: h * 0.66, w: w - 120, h: 50, text: 'Subtítulo · nombre del curso', size: 22, color: t.text }));
  } else if (layout === 'contenido') {
    els.push(T({ x: 50, y: 36, w: w - 100, h: 60, text: 'Título de la diapositiva', size: 34, b: true, color: t.title }));
    els.push(S({ x: 50, y: 100, w: 80, h: 5, fill: t.accent }));
    els.push(T({ x: 50, y: 124, w: w - 100, h: h - 170, text: '• Primer punto\n• Segundo punto\n• Tercer punto', size: 22, color: t.text }));
  } else if (layout === 'dos') {
    els.push(T({ x: 50, y: 36, w: w - 100, h: 60, text: 'Comparación', size: 34, b: true, color: t.title }));
    els.push(T({ x: 50, y: 124, w: w / 2 - 70, h: h - 170, text: '• Columna izquierda', size: 20, color: t.text }));
    els.push(T({ x: w / 2 + 20, y: 124, w: w / 2 - 70, h: h - 170, text: '• Columna derecha', size: 20, color: t.text }));
  }
  return { id: uid(), bg: t.bg, bg2: t.bg2, els };
}

export function newDeck(kind: 'slides' | 'pub', size = kind === 'slides' ? 'slide' : 'a4', template = 'blanco'): Deck {
  const sz = PAGE_SIZES[size] ?? PAGE_SIZES.slide;
  const deck: Deck = { kind, w: sz.w, h: sz.h, pages: [] };
  if (kind === 'slides') {
    const theme = THEMES[template] ? template : 'claro';
    deck.pages = [newSlide(deck, 'titulo', theme), newSlide(deck, 'contenido', theme)];
    return deck;
  }
  const { w, h } = deck;
  const p: Page = { id: uid(), bg: '#ffffff', els: [] };
  if (template === 'afiche') {
    p.bg = '#0b1736'; p.bg2 = '#1f45c8';
    p.els.push(T({ x: 40, y: h * 0.08, w: w - 80, h: 40, text: 'INSCRIPCIONES ABIERTAS', size: 16, b: true, color: '#fde047', align: 'center' }));
    p.els.push(T({ x: 40, y: h * 0.16, w: w - 80, h: 150, text: 'Nombre del curso', size: 48, b: true, color: '#ffffff', align: 'center', valign: 'middle' }));
    p.els.push(S({ x: w * 0.2, y: h * 0.42, w: w * 0.6, h: 4, fill: '#10b5a3' }));
    p.els.push(T({ x: 50, y: h * 0.47, w: w - 100, h: 160, text: '✔ Clases en vivo\n✔ Certificado\n✔ Modalidad en línea', size: 22, color: '#dbeafe', align: 'center' }));
    p.els.push(S({ x: w * 0.18, y: h * 0.78, w: w * 0.64, h: 60, shape: 'round', fill: '#10b5a3' }));
    p.els.push(T({ x: w * 0.18, y: h * 0.78, w: w * 0.64, h: 60, text: 'Inscríbete hoy', size: 24, b: true, color: '#ffffff', align: 'center', valign: 'middle' }));
    p.els.push(T({ x: 40, y: h * 0.91, w: w - 80, h: 30, text: 'www.tusitio.cl · +56 9 0000 0000', size: 12, color: '#ffffff', align: 'center' }));
  } else if (template === 'diploma') {
    p.els.push(S({ x: 18, y: 18, w: w - 36, h: h - 36, fill: '#ffffff', stroke: '#b45309', strokeW: 4 }));
    p.els.push(S({ x: 30, y: 30, w: w - 60, h: h - 60, fill: '#ffffff', stroke: '#d97706', strokeW: 1 }));
    p.els.push(T({ x: 60, y: h * 0.14, w: w - 120, h: 60, text: 'CERTIFICADO', size: 40, b: true, color: '#78350f', align: 'center', font: 'Georgia' }));
    p.els.push(T({ x: 60, y: h * 0.3, w: w - 120, h: 30, text: 'Se otorga el presente a', size: 16, color: '#44403c', align: 'center', i: true, font: 'Georgia' }));
    p.els.push(T({ x: 60, y: h * 0.38, w: w - 120, h: 50, text: 'Nombre del estudiante', size: 32, b: true, color: '#1c1917', align: 'center', font: 'Georgia' }));
    p.els.push(T({ x: 80, y: h * 0.52, w: w - 160, h: 70, text: 'por haber aprobado satisfactoriamente el curso «Nombre del curso».', size: 15, color: '#44403c', align: 'center', font: 'Georgia' }));
    p.els.push(S({ x: w / 2 - 110, y: h * 0.8, w: 220, h: 2, shape: 'line', fill: '#1c1917', stroke: '#1c1917', strokeW: 1 }));
    p.els.push(T({ x: w / 2 - 150, y: h * 0.81, w: 300, h: 30, text: 'Firma y timbre', size: 12, color: '#44403c', align: 'center' }));
  } else if (template === 'tarjeta') {
    p.bg = '#ffffff';
    p.els.push(S({ x: 0, y: 0, w: 70, h, fill: '#1f45c8' }));
    p.els.push(T({ x: 84, y: 24, w: w - 96, h: 28, text: 'Nombre Apellido', size: 16, b: true, color: '#0f172a' }));
    p.els.push(T({ x: 84, y: 50, w: w - 96, h: 20, text: 'Cargo · Institución', size: 10, color: '#475569' }));
    p.els.push(T({ x: 84, y: 86, w: w - 96, h: 44, text: 'correo@institucion.cl\n+56 9 0000 0000', size: 9, color: '#334155' }));
  } else if (template === 'invitacion') {
    p.bg = '#fdf2f8';
    p.els.push(T({ x: 40, y: h * 0.12, w: w - 80, h: 40, text: 'Te invitamos a', size: 20, i: true, color: '#9d174d', align: 'center', font: 'Georgia' }));
    p.els.push(T({ x: 40, y: h * 0.2, w: w - 80, h: 110, text: 'Ceremonia de titulación', size: 40, b: true, color: '#831843', align: 'center', font: 'Georgia', valign: 'middle' }));
    p.els.push(T({ x: 60, y: h * 0.45, w: w - 120, h: 120, text: 'Viernes 12 de diciembre · 19:00 h\nAuditorio principal', size: 18, color: '#500724', align: 'center' }));
  }
  deck.pages = [p];
  return deck;
}

// ---------------------------------------------------------------- dibujo en canvas (PNG/JPG y miniaturas)
async function loadImg(src: string) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = src; await im.decode(); return im; }
const fontOf = (e: El, k = 1) => `${e.i ? 'italic ' : ''}${e.b ? 'bold ' : ''}${(e.size ?? 18) * k}px ${e.font ?? 'Arial'}, sans-serif`;

export function wrapLines(ctx: { measureText: (t: string) => { width: number } }, text: string, width: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (ctx.measureText(line + word).width > width && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); } else line += word;
    }
    out.push(line);
  }
  return out;
}

export async function renderPage(deck: Deck, page: Page, scale = 2): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas'); c.width = Math.round(deck.w * scale); c.height = Math.round(deck.h * scale);
  const g = c.getContext('2d')!; g.scale(scale, scale);
  if (page.bg2) { const gr = g.createLinearGradient(0, 0, deck.w, deck.h); gr.addColorStop(0, page.bg); gr.addColorStop(1, page.bg2); g.fillStyle = gr; } else g.fillStyle = page.bg || '#fff';
  g.fillRect(0, 0, deck.w, deck.h);
  for (const e of page.els) {
    g.save(); g.globalAlpha = e.opacity ?? 1;
    if (e.type === 'shape') {
      g.fillStyle = e.fill ?? 'transparent'; g.strokeStyle = e.stroke ?? 'transparent'; g.lineWidth = e.strokeW ?? 0;
      g.beginPath();
      if (e.shape === 'ellipse') g.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      else if (e.shape === 'triangle') { g.moveTo(e.x + e.w / 2, e.y); g.lineTo(e.x + e.w, e.y + e.h); g.lineTo(e.x, e.y + e.h); g.closePath(); }
      else if (e.shape === 'round') g.roundRect(e.x, e.y, e.w, e.h, Math.min(e.w, e.h) / 4);
      else if (e.shape === 'line' || e.shape === 'arrow') { g.moveTo(e.x, e.y + e.h / 2); g.lineTo(e.x + e.w, e.y + e.h / 2); g.strokeStyle = e.stroke ?? e.fill ?? '#000'; g.lineWidth = e.strokeW || 3; g.stroke();
        if (e.shape === 'arrow') { g.beginPath(); g.moveTo(e.x + e.w, e.y + e.h / 2); g.lineTo(e.x + e.w - 14, e.y + e.h / 2 - 8); g.lineTo(e.x + e.w - 14, e.y + e.h / 2 + 8); g.closePath(); g.fillStyle = g.strokeStyle; g.fill(); } g.restore(); continue; }
      else if (e.shape === 'star') { const cx = e.x + e.w / 2, cy = e.y + e.h / 2; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1; const a = -Math.PI / 2 + (i * Math.PI) / 5; const px = cx + (Math.cos(a) * e.w / 2) * r, py = cy + (Math.sin(a) * e.h / 2) * r; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); }
      else g.rect(e.x, e.y, e.w, e.h);
      if (e.fill && e.fill !== 'transparent') g.fill(); if (e.strokeW && e.stroke) g.stroke();
    } else if (e.type === 'image' && e.src) {
      try { const im = await loadImg(e.src); g.drawImage(im, e.x, e.y, e.w, e.h); } catch { /* imagen no disponible */ }
    } else if (e.type === 'text') {
      if (e.fill) { g.fillStyle = e.fill; g.fillRect(e.x, e.y, e.w, e.h); }
      g.font = fontOf(e); g.fillStyle = e.color ?? '#111'; g.textBaseline = 'top';
      const lines = wrapLines(g, e.text ?? '', e.w - 8); const lh = (e.size ?? 18) * 1.25;
      const total = lines.length * lh; let y = e.y + 4 + (e.valign === 'middle' ? (e.h - total) / 2 : e.valign === 'bottom' ? e.h - total - 8 : 0);
      for (const l of lines) {
        const w = g.measureText(l).width; const x = e.align === 'center' ? e.x + (e.w - w) / 2 : e.align === 'right' ? e.x + e.w - w - 4 : e.x + 4;
        g.fillText(l, x, y);
        if (e.u) g.fillRect(x, y + (e.size ?? 18) * 1.05, w, Math.max(1, (e.size ?? 18) / 16));
        y += lh;
      }
    }
    g.restore();
  }
  return c;
}

// ---------------------------------------------------------------- exportar
const hexNo = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1) : undefined);

export async function exportDeck(deck: Deck, title: string, fmt: string, pageIndex = 0): Promise<Blob> {
  if (fmt === 'png' || fmt === 'jpg') {
    const c = await renderPage(deck, deck.pages[pageIndex] ?? deck.pages[0], deck.kind === 'pub' ? 3 : 2);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92));
  }
  if (fmt === 'pdf') {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create(); pdf.setTitle(title); pdf.setCreator('SEMATEC Oficina');
    for (const p of deck.pages) {
      // Página nítida para imprimir: se dibuja a 3x y se inserta como imagen
      const c = await renderPage(deck, p, 3);
      const png = await pdf.embedPng(new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer()));
      const page = pdf.addPage([deck.w, deck.h]); page.drawImage(png, { x: 0, y: 0, width: deck.w, height: deck.h });
    }
    return new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' });
  }
  if (fmt === 'pptx') {
    const PptxGenJS = (await import('pptxgenjs')).default;
    const pptx = new PptxGenJS(); pptx.title = title; pptx.author = 'SEMATEC Oficina';
    pptx.defineLayout({ name: 'SEMATEC', width: deck.w / 72, height: deck.h / 72 }); pptx.layout = 'SEMATEC';
    const inch = (v: number) => v / 72;
    for (const p of deck.pages) {
      const s = pptx.addSlide();
      if (p.bg2) { const c = await renderPage({ ...deck, pages: [] }, { ...p, els: [] }, 1); s.background = { data: c.toDataURL('image/png') }; }
      else s.background = { color: hexNo(p.bg) ?? 'FFFFFF' };
      for (const e of p.els) {
        const box = { x: inch(e.x), y: inch(e.y), w: inch(Math.max(1, e.w)), h: inch(Math.max(1, e.h)) };
        if (e.type === 'text') s.addText(e.text ?? '', { ...box, fontSize: e.size ?? 18, fontFace: e.font ?? 'Arial', color: hexNo(e.color) ?? '111111', bold: e.b, italic: e.i, underline: e.u ? { style: 'sng' } : undefined, align: e.align ?? 'left', valign: e.valign ?? 'top', fill: e.fill ? { color: hexNo(e.fill) ?? 'FFFFFF' } : undefined, margin: 4 });
        else if (e.type === 'image' && e.src) {
          let data = e.src;
          if (!/^data:image\/(png|jpe?g|gif)/.test(data)) { try { const im = await loadImg(e.src); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d')!.drawImage(im, 0, 0); data = c.toDataURL('image/png'); } catch { continue; } }
          s.addImage({ data, ...box });
        } else if (e.type === 'shape') {
          const map: Record<string, string> = { rect: 'rect', round: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', line: 'line', arrow: 'rightArrow', star: 'star5' };
          s.addShape(map[e.shape ?? 'rect'] as never, { ...box, fill: e.shape === 'line' ? undefined : { color: hexNo(e.fill) ?? 'FFFFFF' }, line: e.strokeW || e.shape === 'line' ? { color: hexNo(e.stroke ?? e.fill) ?? '000000', width: e.strokeW || 2 } : undefined });
        }
      }
      if (p.notes) s.addNotes(p.notes);
    }
    const out = await pptx.write({ outputType: 'blob' });
    return out as Blob;
  }
  throw new Error('Formato no disponible');
}

// ---------------------------------------------------------------- importar PPTX
const EMU = 12700;
export async function readPptx(src: Blob): Promise<Deck> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await src.arrayBuffer());
  const parse = async (p: string) => { const t = await zip.file(p)?.async('string'); return t ? new DOMParser().parseFromString(t, 'application/xml') : null; };
  const pres = await parse('ppt/presentation.xml');
  const sz = pres?.getElementsByTagName('p:sldSz')[0];
  const deck: Deck = { kind: 'slides', w: Math.round(Number(sz?.getAttribute('cx') ?? 12192000) / EMU), h: Math.round(Number(sz?.getAttribute('cy') ?? 6858000) / EMU), pages: [] };
  const rels = await parse('ppt/_rels/presentation.xml.rels');
  const relMap = new Map([...(rels?.getElementsByTagName('Relationship') ?? [])].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const ids = [...(pres?.getElementsByTagName('p:sldId') ?? [])].map((s) => relMap.get(s.getAttribute('r:id')));
  for (const target of ids) {
    if (!target) continue;
    const path = `ppt/${target.replace(/^\/?ppt\//, '')}`;
    const x = await parse(path); if (!x) continue;
    const srels = await parse(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const sRel = new Map([...(srels?.getElementsByTagName('Relationship') ?? [])].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const page: Page = { id: uid(), bg: '#ffffff', els: [] };
    const bgc = x.getElementsByTagName('p:bg')[0]?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val'); if (bgc) page.bg = `#${bgc}`;
    const geom = (n: Element) => { const off = n.getElementsByTagName('a:off')[0]; const ext = n.getElementsByTagName('a:ext')[0]; return off && ext ? { x: Number(off.getAttribute('x')) / EMU, y: Number(off.getAttribute('y')) / EMU, w: Number(ext.getAttribute('cx')) / EMU, h: Number(ext.getAttribute('cy')) / EMU } : null; };
    for (const sp of [...x.getElementsByTagName('p:sp')]) {
      const g = geom(sp); const paras = [...sp.getElementsByTagName('a:p')];
      const text = paras.map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).join('\n').trim();
      const r0 = sp.getElementsByTagName('a:rPr')[0];
      const ph = sp.getElementsByTagName('p:ph')[0]?.getAttribute('type');
      const box = g ?? (ph === 'title' || ph === 'ctrTitle' ? { x: 50, y: 40, w: deck.w - 100, h: 70 } : { x: 50, y: 130, w: deck.w - 100, h: deck.h - 180 });
      const fill = sp.getElementsByTagName('p:spPr')[0]?.getElementsByTagName('a:solidFill')[0]?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val');
      if (fill && !text) { page.els.push({ id: uid(), type: 'shape', ...box, shape: 'rect', fill: `#${fill}` }); continue; }
      if (!text) continue;
      const algn = paras[0]?.getElementsByTagName('a:pPr')[0]?.getAttribute('algn');
      page.els.push({ id: uid(), type: 'text', ...box, text, size: r0?.getAttribute('sz') ? Number(r0.getAttribute('sz')) / 100 : ph?.includes('itle') ? 36 : 20,
        b: r0?.getAttribute('b') === '1' || !!ph?.includes('itle'), i: r0?.getAttribute('i') === '1', color: `#${r0?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val') ?? '111827'}`,
        align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left', font: 'Arial', fill: fill ? `#${fill}` : undefined });
    }
    for (const pic of [...x.getElementsByTagName('p:pic')]) {
      const g = geom(pic); const rid = pic.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed'); const t = rid ? sRel.get(rid) : null;
      if (!g || !t) continue;
      const file = zip.file(`ppt/${t.replace(/^\.\.\//, '')}`); if (!file) continue;
      const ext = t.split('.').pop()?.toLowerCase(); const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
      page.els.push({ id: uid(), type: 'image', ...g, src: `data:${mime};base64,${await file.async('base64')}` });
    }
    const notes = [...sRel.values()].find((v) => v?.includes('notesSlide'));
    if (notes) { const n = await parse(`ppt/${notes.replace(/^\.\.\//, '')}`); page.notes = [...(n?.getElementsByTagName('a:t') ?? [])].map((t) => t.textContent).join(' ').trim() || undefined; }
    deck.pages.push(page);
  }
  if (!deck.pages.length) deck.pages.push({ id: uid(), bg: '#ffffff', els: [] });
  return deck;
}
