'use client';
/**
 * 📄 Documentos de texto: abrir (DOCX, ODT, RTF, HTML, TXT, Markdown, PDF) y guardar como
 * DOCX (Word), PDF, ODT (LibreOffice), RTF, HTML, TXT y Markdown. Todo dentro del navegador.
 */
import type { Fmt } from './media';

export const DOC_FORMATS: Fmt[] = [
  { id: 'docx', label: 'Word (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { id: 'odt', label: 'OpenDocument (.odt)', ext: 'odt', mime: 'application/vnd.oasis.opendocument.text', hint: 'LibreOffice, Google Docs' },
  { id: 'rtf', label: 'Texto enriquecido (.rtf)', ext: 'rtf', mime: 'application/rtf' },
  { id: 'html', label: 'Página web (.html)', ext: 'html', mime: 'text/html' },
  { id: 'txt', label: 'Texto sin formato (.txt)', ext: 'txt', mime: 'text/plain' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown' },
];

export const DOC_EXT = ['docx', 'odt', 'rtf', 'html', 'htm', 'txt', 'md', 'markdown'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xesc = (s: string) => esc(s).replace(/"/g, '&quot;');

// ---------------------------------------------------------------- abrir
export async function readDocument(src: Blob, name: string): Promise<string> {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (ext === 'docx') {
    const mammoth = (await import('mammoth/mammoth.browser')).default ?? (await import('mammoth/mammoth.browser'));
    const r = await mammoth.convertToHtml({ arrayBuffer: await src.arrayBuffer() }, { convertImage: mammoth.images.dataUri });
    return sanitize(r.value);
  }
  if (ext === 'odt') return sanitize(await odtToHtml(src));
  const text = await src.text();
  if (ext === 'html' || ext === 'htm') return sanitize(new DOMParser().parseFromString(text, 'text/html').body.innerHTML);
  if (ext === 'md' || ext === 'markdown') return markdownToHtml(text);
  if (ext === 'rtf') return textToHtml(rtfToText(text));
  return textToHtml(text);
}

/** Deja solo etiquetas y atributos seguros (sin scripts, eventos ni enlaces javascript:). */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const ok = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'A', 'UL', 'OL', 'LI', 'BR', 'HR', 'BLOCKQUOTE',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'SPAN', 'MARK', 'CODE', 'PRE', 'DIV']);
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      if (!ok.has(c.tagName)) { if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM'].includes(c.tagName)) c.remove(); else { walk(c); c.replaceWith(...c.childNodes); } continue; }
      for (const a of [...c.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (n === 'href' && /^(https?:|mailto:|#)/i.test(a.value)) || (n === 'src' && /^(data:image\/(png|jpe?g|gif|webp);|https?:)/i.test(a.value))
          || ['colspan', 'rowspan', 'alt', 'width', 'height'].includes(n) || (n === 'style' && !/url\(|expression/i.test(a.value));
        if (!keep) c.removeAttribute(a.name);
      }
      walk(c);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function textToHtml(t: string) {
  return t.split(/\r?\n\r?\n+/).map((p) => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('') || '<p></p>';
}

export function markdownToHtml(md: string) {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out: string[] = []; let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.*)$/); const ul = line.match(/^\s*[-*+]\s+(.*)$/); const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { close(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (ul || ol) { const k = ul ? 'ul' : 'ol'; if (list !== k) { close(); out.push(`<${k}>`); list = k; } out.push(`<li>${inline((ul ?? ol)![1])}</li>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { close(); out.push('<hr>'); }
    else if (line.startsWith('> ')) { close(); out.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`); }
    else if (line.trim()) { close(); out.push(`<p>${inline(line)}</p>`); } else close();
  }
  close();
  return out.join('') || '<p></p>';
}

function rtfToText(rtf: string) {
  return rtf.replace(/\\par[d]?/g, '\n').replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function odtToHtml(src: Blob) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await src.arrayBuffer());
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('El archivo ODT no tiene contenido.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagName('office:text')[0];
  const html: string[] = [];
  const inline = (n: Node): string => [...n.childNodes].map((c) => c.nodeType === 3 ? esc(c.textContent ?? '')
    : (c as Element).tagName === 'text:line-break' ? '<br>' : (c as Element).tagName === 'text:s' ? ' ' : (c as Element).tagName === 'text:tab' ? '\t' : inline(c)).join('');
  const block = (el: Element) => {
    const t = el.tagName;
    if (t === 'text:h') { const l = Math.min(6, Number(el.getAttribute('text:outline-level') ?? 1)); html.push(`<h${l}>${inline(el)}</h${l}>`); }
    else if (t === 'text:p') html.push(`<p>${inline(el)}</p>`);
    else if (t === 'text:list') { html.push('<ul>'); for (const li of [...el.children]) html.push(`<li>${[...li.children].map((p) => inline(p)).join(' ')}</li>`); html.push('</ul>'); }
    else if (t === 'table:table') {
      html.push('<table>'); for (const r of [...el.getElementsByTagName('table:table-row')]) html.push(`<tr>${[...r.getElementsByTagName('table:table-cell')].map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`); html.push('</table>');
    } else for (const c of [...el.children]) block(c);
  };
  for (const c of [...(body?.children ?? [])]) block(c);
  return html.join('');
}

// ------------------------------------------------------------- estructura común
type Run = { text: string; b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean; color?: string; size?: number; href?: string; br?: boolean; img?: string };
type Block = { kind: 'p' | 'h' | 'li' | 'quote' | 'hr' | 'table' | 'img' | 'pagebreak'; level?: number; ordered?: boolean; runs: Run[]; align?: string; rows?: Run[][][]; cells?: { span: number; bg?: string }[][]; src?: string };

/** Diseño de página del documento (tamaño, orientación, márgenes, encabezado, pie y numeración). */
export type DocLayout = { size?: string; orient?: 'v' | 'h'; margin?: string; header?: string; footer?: string; pageNumbers?: boolean };
/** Tamaños en puntos (1/72 de pulgada). */
export const DOC_PAGE_PT: Record<string, { label: string; w: number; h: number }> = { a4: { label: 'A4', w: 595.28, h: 841.89 }, carta: { label: 'Carta', w: 612, h: 792 }, oficio: { label: 'Oficio', w: 612, h: 936 } };
export const DOC_MARGIN_PT: Record<string, { label: string; v: number; h: number }> = { normal: { label: 'Normal', v: 54, h: 63 }, estrecho: { label: 'Estrecho', v: 36, h: 36 }, ancho: { label: 'Ancho', v: 72, h: 96 } };
export function pageDims(l: DocLayout = {}) {
  const p = DOC_PAGE_PT[l.size ?? 'a4'] ?? DOC_PAGE_PT.a4; const m = DOC_MARGIN_PT[l.margin ?? 'normal'] ?? DOC_MARGIN_PT.normal;
  return l.orient === 'h' ? { W: p.h, H: p.w, mv: m.v, mh: m.h } : { W: p.w, H: p.h, mv: m.v, mh: m.h };
}

const hex = (c: string | null | undefined) => {
  if (!c) return undefined;
  const m = c.match(/^#([0-9a-f]{6})$/i); if (m) return m[1];
  const r = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/i); if (r) return [r[1], r[2], r[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
  return undefined;
};
const ptSize = (s: string | null | undefined) => { const m = s?.match(/([\d.]+)(px|pt)/); return m ? (m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])) : undefined; };

function runsOf(node: Node, base: Run = { text: '' }): Run[] {
  const out: Run[] = [];
  for (const c of [...node.childNodes]) {
    if (c.nodeType === 3) { if (c.textContent) out.push({ ...base, text: c.textContent }); continue; }
    if (c.nodeType !== 1) continue;
    const el = c as HTMLElement; const t = el.tagName;
    if (t === 'BR') { out.push({ ...base, text: '', br: true }); continue; }
    if (t === 'IMG') { out.push({ ...base, text: '', img: el.getAttribute('src') ?? '' }); continue; }
    const r: Run = { ...base };
    if (t === 'B' || t === 'STRONG' || /bold|[6-9]00/.test(el.style.fontWeight)) r.b = true;
    if (t === 'I' || t === 'EM' || el.style.fontStyle === 'italic') r.i = true;
    if (t === 'U' || el.style.textDecoration.includes('underline')) r.u = true;
    if (t === 'S' || t === 'STRIKE' || el.style.textDecoration.includes('line-through')) r.s = true;
    if (t === 'SUP') r.sup = true; if (t === 'SUB') r.sub = true;
    if (t === 'A') r.href = el.getAttribute('href') ?? undefined;
    r.color = hex(el.style.color) ?? r.color; r.size = ptSize(el.style.fontSize) ?? r.size;
    out.push(...runsOf(el, r));
  }
  return out;
}

export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: Block[] = [];
  const visit = (el: Element, ordered?: boolean) => {
    const t = el.tagName; const align = (el as HTMLElement).style?.textAlign || undefined;
    if ((el as HTMLElement).style?.pageBreakAfter === 'always' || (el as HTMLElement).style?.breakAfter === 'page') { if (el.textContent?.trim()) blocks.push({ kind: 'p', runs: runsOf(el), align }); blocks.push({ kind: 'pagebreak', runs: [] }); }
    else if (/^H[1-6]$/.test(t)) blocks.push({ kind: 'h', level: Number(t[1]), runs: runsOf(el), align });
    else if (t === 'P' || t === 'DIV' && ![...el.children].some((c) => /^(P|H\d|UL|OL|TABLE|DIV)$/.test(c.tagName))) blocks.push({ kind: 'p', runs: runsOf(el), align });
    else if (t === 'UL' || t === 'OL') for (const li of [...el.children]) {
      const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
      const clone = li.cloneNode(true) as Element; clone.querySelectorAll('ul,ol').forEach((n) => n.remove());
      blocks.push({ kind: 'li', ordered: t === 'OL', runs: runsOf(clone) });
      nested.forEach((n) => visit(n, n.tagName === 'OL'));
    }
    else if (t === 'BLOCKQUOTE') blocks.push({ kind: 'quote', runs: runsOf(el) });
    else if (t === 'HR') blocks.push({ kind: 'hr', runs: [] });
    else if (t === 'IMG') blocks.push({ kind: 'img', runs: [], src: el.getAttribute('src') ?? '' });
    else if (t === 'TABLE') {
      const trs = [...el.querySelectorAll('tr')];
      blocks.push({ kind: 'table', runs: [], rows: trs.map((r) => [...r.children].map((c) => runsOf(c))),
        cells: trs.map((r) => [...r.children].map((c) => ({ span: Math.max(1, Number(c.getAttribute('colspan')) || 1), bg: hex((c as HTMLElement).style?.backgroundColor) ?? hex(c.getAttribute('data-background-color')) }))) });
    }
    else if (t === 'PRE') blocks.push({ kind: 'p', runs: [{ text: el.textContent ?? '' }] });
    else for (const c of [...el.children]) visit(c, ordered);
  };
  for (const c of [...doc.body.children]) visit(c);
  if (!doc.body.children.length && doc.body.textContent?.trim()) blocks.push({ kind: 'p', runs: [{ text: doc.body.textContent }] });
  return blocks;
}

export function htmlToText(html: string) {
  return htmlToBlocks(html).map((b) => b.kind === 'table' ? (b.rows ?? []).map((r) => r.map((c) => c.map((x) => x.text).join('')).join('\t')).join('\n')
    : b.kind === 'hr' ? '----------' : (b.kind === 'li' ? '• ' : '') + b.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n\n');
}

export function htmlToMarkdown(html: string) {
  let n = 0;
  return htmlToBlocks(html).map((b) => {
    const t = b.runs.map((r) => r.br ? '  \n' : r.href ? `[${r.text}](${r.href})` : r.b && r.text.trim() ? `**${r.text}**` : r.i && r.text.trim() ? `*${r.text}*` : r.text).join('');
    if (b.kind !== 'li') n = 0;
    if (b.kind === 'h') return `${'#'.repeat(b.level ?? 1)} ${t}`;
    if (b.kind === 'li') return b.ordered ? `${++n}. ${t}` : `- ${t}`;
    if (b.kind === 'quote') return `> ${t}`;
    if (b.kind === 'hr') return '---';
    if (b.kind === 'table') { const rows = (b.rows ?? []).map((r) => `| ${r.map((c) => c.map((x) => x.text).join('').replace(/\|/g, '\\|')).join(' | ')} |`); return rows.length ? [rows[0], `|${' --- |'.repeat(b.rows![0].length)}`, ...rows.slice(1)].join('\n') : ''; }
    return t;
  }).join('\n\n');
}

export function fullHtml(html: string, title: string) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;max-width:800px;margin:40px auto;line-height:1.5;color:#111}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

// ---------------------------------------------------------------- DOCX
async function dataOf(src: string): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif'; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const type = blob.type.includes('png') ? 'png' : blob.type.includes('gif') ? 'gif' : 'jpg';
    let data = new Uint8Array(await blob.arrayBuffer());
    if (!/png|jpe?g|gif/.test(blob.type)) { // webp u otros: se convierte a PNG
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0);
      data = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer());
      return { data, type: 'png', w: bmp.width, h: bmp.height };
    }
    return { data, type, w: bmp.width, h: bmp.height };
  } catch { return null; }
}

export async function htmlToDocx(html: string, title: string, layout: DocLayout = {}): Promise<Blob> {
  const d = await import('docx');
  const blocks = htmlToBlocks(html);
  const ALIGN: Record<string, (typeof d.AlignmentType)[keyof typeof d.AlignmentType]> = { center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT, justify: d.AlignmentType.JUSTIFIED };
  const HL = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  const toRuns = async (runs: Run[]) => {
    const out: (InstanceType<typeof d.TextRun> | InstanceType<typeof d.ImageRun> | InstanceType<typeof d.ExternalHyperlink>)[] = [];
    for (const r of runs) {
      if (r.img) { const im = await dataOf(r.img); if (im) { const k = Math.min(1, 600 / im.w); out.push(new d.ImageRun({ type: im.type, data: im.data, transformation: { width: Math.round(im.w * k), height: Math.round(im.h * k) } })); } continue; }
      const opt = { text: r.text, bold: r.b, italics: r.i, underline: r.u ? {} : undefined, strike: r.s, superScript: r.sup, subScript: r.sub, color: r.color, size: r.size ? Math.round(r.size * 2) : undefined, break: r.br ? 1 : undefined };
      out.push(r.href ? new d.ExternalHyperlink({ link: r.href, children: [new d.TextRun({ ...opt, style: 'Hyperlink' })] }) : new d.TextRun(opt));
    }
    return out;
  };
  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];
  for (const b of blocks) {
    if (b.kind === 'table') {
      const rows = b.rows ?? []; if (!rows.length) continue;
      children.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: await Promise.all(rows.map(async (r, ri) => new d.TableRow({
        children: await Promise.all(r.map(async (cell, i) => {
          const meta = b.cells?.[ri]?.[i];
          return new d.TableCell({ columnSpan: meta && meta.span > 1 ? meta.span : undefined, shading: meta?.bg ? { fill: meta.bg, type: d.ShadingType.CLEAR, color: 'auto' } : undefined,
            children: [new d.Paragraph({ children: await toRuns(cell) })] });
        })) }))) }));
      continue;
    }
    if (b.kind === 'pagebreak') { children.push(new d.Paragraph({ children: [new d.PageBreak()] })); continue; }
    if (b.kind === 'hr') { children.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } })); continue; }
    if (b.kind === 'img') { children.push(new d.Paragraph({ children: await toRuns([{ text: '', img: b.src }]) })); continue; }
    children.push(new d.Paragraph({
      children: await toRuns(b.runs), alignment: b.align ? ALIGN[b.align] : undefined,
      heading: b.kind === 'h' ? HL[(b.level ?? 1) - 1] : undefined,
      bullet: b.kind === 'li' && !b.ordered ? { level: 0 } : undefined,
      numbering: b.kind === 'li' && b.ordered ? { reference: 'num', level: 0 } : undefined,
      indent: b.kind === 'quote' ? { left: 720 } : undefined,
    }));
  }
  const doc = new d.Document({
    title, creator: 'SEMATEC Oficina',
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: '%1.', alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: (() => {
        const { W, H, mv, mh } = pageDims(layout); const tw = (pt: number) => Math.round(pt * 20);
        return { page: { size: { width: tw(layout.orient === 'h' ? H : W), height: tw(layout.orient === 'h' ? W : H), orientation: layout.orient === 'h' ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT },
          margin: { top: tw(mv), bottom: tw(mv), left: tw(mh), right: tw(mh) } } };
      })(),
      headers: layout.header?.trim() ? { default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: layout.header.trim(), size: 18, color: '666666' })] })] }) } : undefined,
      footers: layout.footer?.trim() || layout.pageNumbers ? { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [
        ...(layout.footer?.trim() ? [new d.TextRun({ text: layout.footer.trim() + (layout.pageNumbers ? '   ·   ' : ''), size: 18, color: '666666' })] : []),
        ...(layout.pageNumbers ? [new d.TextRun({ children: ['Página ', d.PageNumber.CURRENT, ' de ', d.PageNumber.TOTAL_PAGES], size: 18, color: '666666' })] : []),
      ] })] }) } : undefined,
      children: children.length ? children : [new d.Paragraph('')],
    }],
  });
  return d.Packer.toBlob(doc);
}

// ---------------------------------------------------------------- ODT
export async function htmlToOdt(html: string, title: string): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  zip.file('meta.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2"><office:meta><dc:title>${xesc(title)}</dc:title></office:meta></office:document-meta>`);
  const styles = new Map<string, string>();
  const st = (r: Run) => {
    const props = [r.b && 'fo:font-weight="bold"', r.i && 'fo:font-style="italic"', r.u && 'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"',
      r.s && 'style:text-line-through-style="solid"', r.color && `fo:color="#${r.color}"`, r.size && `fo:font-size="${r.size}pt"`, r.sup && 'style:text-position="super 58%"', r.sub && 'style:text-position="sub 58%"'].filter(Boolean).join(' ');
    if (!props) return null;
    if (!styles.has(props)) styles.set(props, `T${styles.size + 1}`);
    return styles.get(props)!;
  };
  const inline = (runs: Run[]) => runs.map((r) => {
    if (r.br) return '<text:line-break/>'; if (r.img) return '';
    const s = st(r); const t = xesc(r.text);
    const body = r.href ? `<text:a xlink:type="simple" xlink:href="${xesc(r.href)}">${t}</text:a>` : t;
    return s ? `<text:span text:style-name="${s}">${body}</text:span>` : body;
  }).join('');
  const parts: string[] = []; let list: boolean | null = null;
  for (const b of htmlToBlocks(html)) {
    if (b.kind !== 'li' && list !== null) { parts.push('</text:list>'); list = null; }
    if (b.kind === 'h') parts.push(`<text:h text:style-name="Heading_20_${b.level}" text:outline-level="${b.level}">${inline(b.runs)}</text:h>`);
    else if (b.kind === 'li') { if (list === null) { parts.push(`<text:list text:style-name="${b.ordered ? 'LNum' : 'LBul'}">`); list = !!b.ordered; } parts.push(`<text:list-item><text:p>${inline(b.runs)}</text:p></text:list-item>`); }
    else if (b.kind === 'table') {
      const cols = Math.max(1, ...(b.rows ?? []).map((r) => r.length));
      parts.push(`<table:table><table:table-column table:number-columns-repeated="${cols}"/>${(b.rows ?? []).map((r) => `<table:table-row>${Array.from({ length: cols }, (_, i) => `<table:table-cell office:value-type="string" table:style-name="Celda"><text:p>${inline(r[i] ?? [])}</text:p></table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`);
    } else if (b.kind === 'hr') parts.push('<text:p>────────────────────</text:p>');
    else if (b.kind !== 'img') parts.push(`<text:p${b.align === 'center' ? ' text:style-name="Centro"' : b.align === 'right' ? ' text:style-name="Derecha"' : ''}>${inline(b.runs)}</text:p>`);
  }
  if (list !== null) parts.push('</text:list>');
  const auto = [...styles].map(([p, n]) => `<style:style style:name="${n}" style:family="text"><style:text-properties ${p}/></style:style>`).join('');
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2"><office:automatic-styles>${auto}<style:style style:name="Centro" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style><style:style style:name="Derecha" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/></style:style><style:style style:name="Celda" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #999999" fo:padding="0.05in"/></style:style><text:list-style style:name="LBul"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.25in" fo:margin-left="0.5in"/></style:list-level-properties></text:list-level-style-bullet></text:list-style><text:list-style style:name="LNum"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.25in" fo:margin-left="0.5in"/></style:list-level-properties></text:list-level-style-number></text:list-style></office:automatic-styles><office:body><office:text>${parts.join('')}</office:text></office:body></office:document-content>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text' });
}

// ---------------------------------------------------------------- RTF
export function htmlToRtf(html: string): string {
  const enc = (s: string) => [...s].map((ch) => { const c = ch.codePointAt(0)!; return ch === '\\' || ch === '{' || ch === '}' ? `\\${ch}` : c > 127 ? `\\u${c > 32767 ? c - 65536 : c}?` : ch; }).join('');
  const inline = (runs: Run[]) => runs.map((r) => r.br ? '\\line ' : `{${r.b ? '\\b' : ''}${r.i ? '\\i' : ''}${r.u ? '\\ul' : ''}${r.s ? '\\strike' : ''}${r.size ? `\\fs${Math.round(r.size * 2)}` : ''} ${enc(r.text)}}`).join('');
  const body = htmlToBlocks(html).map((b) => {
    if (b.kind === 'h') return `{\\pard\\sb240\\sa120\\b\\fs${[40, 32, 28, 26, 24, 22][(b.level ?? 1) - 1]} ${inline(b.runs)}\\par}`;
    if (b.kind === 'li') return `{\\pard\\fi-360\\li720 \\bullet\\tab ${inline(b.runs)}\\par}`;
    if (b.kind === 'table') return (b.rows ?? []).map((r) => `{\\pard ${r.map((c) => inline(c)).join('\\tab ')}\\par}`).join('');
    if (b.kind === 'hr') return '{\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par}';
    return `{\\pard${b.align === 'center' ? '\\qc' : b.align === 'right' ? '\\qr' : b.align === 'justify' ? '\\qj' : ''}\\sa120 ${inline(b.runs)}\\par}`;
  }).join('\n');
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22\n${body}\n}`;
}

// ---------------------------------------------------------------- PDF
/** Texto que admiten las fuentes estándar del PDF (acentos y ñ incluidos). */
const winAnsi = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, '');

export async function htmlToPdf(html: string, title: string, layout: DocLayout = {}): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(title); pdf.setCreator('SEMATEC Oficina');
  const F = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold), i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique) };
  const { W, H, mv, mh } = pageDims(layout); const M = mh; const MV = mv + (layout.header?.trim() ? 14 : 0); const MB = mv + (layout.footer?.trim() || layout.pageNumbers ? 14 : 0);
  const maxW = W - 2 * M;
  let page = pdf.addPage([W, H]); let y = H - MV;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - MV; };
  const font = (r: Run) => (r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r);
  const col = (h?: string) => (h ? rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255) : rgb(0.07, 0.07, 0.07));
  /** Escribe un párrafo con ajuste de línea; devuelve la altura usada. */
  const para = (runs: Run[], size: number, opts: { indent?: number; bullet?: string; align?: string; x?: number; width?: number; dryRun?: boolean } = {}) => {
    const x0 = (opts.x ?? M) + (opts.indent ?? 0); const width = (opts.width ?? maxW) - (opts.indent ?? 0);
    type Word = { t: string; r: Run; w: number; br?: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      if (r.br) { words.push({ t: '', r, w: 0, br: true }); continue; }
      const sz = r.size ?? size;
      for (const p of winAnsi(r.text).split(/(\s+)/)) if (p) words.push({ t: p, r: { ...r, size: sz }, w: font(r).widthOfTextAtSize(p, sz) });
    }
    const lines: Word[][] = [[]]; let lw = 0;
    for (const w of words) {
      if (w.br) { lines.push([]); lw = 0; continue; }
      if (lw + w.w > width && lines[lines.length - 1].length && w.t.trim()) { lines.push([]); lw = 0; }
      if (!lines[lines.length - 1].length && !w.t.trim()) continue;
      lines[lines.length - 1].push(w); lw += w.w;
    }
    const lh = size * 1.4; let used = 0;
    lines.forEach((line, li) => {
      if (!opts.dryRun && y - lh < MB) newPage();
      const total = line.reduce((s, w) => s + w.w, 0);
      let x = x0 + (opts.align === 'center' ? (width - total) / 2 : opts.align === 'right' ? width - total : 0);
      if (!opts.dryRun) {
        if (li === 0 && opts.bullet) page.drawText(opts.bullet, { x: x0 - 14, y: y - size, size, font: F.r });
        for (const w of line) {
          const sz = w.r.size ?? size;
          page.drawText(w.t, { x, y: y - size, size: sz, font: font(w.r), color: w.r.href ? rgb(0.1, 0.3, 0.8) : col(w.r.color) });
          if (w.r.u || w.r.href) page.drawLine({ start: { x, y: y - size - 1.5 }, end: { x: x + w.w, y: y - size - 1.5 }, thickness: 0.6, color: col(w.r.color) });
          x += w.w;
        }
        y -= lh;
      }
      used += lh;
    });
    return used;
  };
  let num = 0;
  for (const b of htmlToBlocks(html)) {
    if (b.kind !== 'li' || !b.ordered) num = 0;
    if (b.kind === 'h') { const sz = [22, 18, 15, 13, 12, 11][(b.level ?? 1) - 1]; y -= 6; para(b.runs.map((r) => ({ ...r, b: true })), sz, { align: b.align }); y -= 4; }
    else if (b.kind === 'li') para(b.runs, 11, { indent: 22, bullet: b.ordered ? `${++num}.` : '-' });
    else if (b.kind === 'quote') { para(b.runs.map((r) => ({ ...r, i: true })), 11, { indent: 24 }); y -= 4; }
    else if (b.kind === 'pagebreak') newPage();
    else if (b.kind === 'hr') { if (y - 12 < MB) newPage(); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.7, color: rgb(0.6, 0.6, 0.6) }); y -= 14; }
    else if (b.kind === 'table') {
      const rows = b.rows ?? [];
      const spans = rows.map((r, ri) => r.map((_, i) => b.cells?.[ri]?.[i]?.span ?? 1));
      const cols = Math.max(1, ...spans.map((r) => r.reduce((a, x) => a + x, 0))); const cw = maxW / cols;
      rows.forEach((r, ri) => {
        let cx = 0; const geo = r.map((_, i) => { const g = { x: M + cx * cw, w: cw * spans[ri][i] }; cx += spans[ri][i]; return g; });
        const hRow = Math.max(16, ...r.map((c, i) => para(c, 9.5, { x: geo[i].x + 4, width: geo[i].w - 8, dryRun: true }))) + 6;
        if (y - hRow < MB) newPage();
        const top = y;
        r.forEach((c, i) => {
          const bg = b.cells?.[ri]?.[i]?.bg;
          page.drawRectangle({ x: geo[i].x, y: top - hRow, width: geo[i].w, height: hRow, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.6, color: bg ? col(bg) : undefined });
          y = top - 3; para(c, 9.5, { x: geo[i].x + 4, width: geo[i].w - 8 });
        });
        y = top - hRow;
      });
      y -= 8;
    } else if (b.kind === 'img' || b.runs.some((r) => r.img)) {
      for (const src of [b.src, ...b.runs.map((r) => r.img)].filter(Boolean) as string[]) {
        const im = await dataOf(src); if (!im || im.type === 'gif') continue;
        const img = im.type === 'png' ? await pdf.embedPng(im.data) : await pdf.embedJpg(im.data);
        const k = Math.min(1, maxW / img.width, (H - 2 * M) / img.height); const w = img.width * k, h = img.height * k;
        if (y - h < MB) newPage();
        page.drawImage(img, { x: M, y: y - h, width: w, height: h }); y -= h + 8;
      }
      if (b.runs.some((r) => r.text.trim())) para(b.runs.filter((r) => !r.img), 11, { align: b.align });
    } else { para(b.runs, 11, { align: b.align }); y -= 5; }
  }
  // Encabezado, pie de página y numeración en todas las páginas
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    const grey = rgb(0.4, 0.4, 0.4);
    if (layout.header?.trim()) { const t = winAnsi(layout.header.trim()); const w = F.r.widthOfTextAtSize(t, 9); pg.drawText(t, { x: (W - w) / 2, y: H - mv + 4, size: 9, font: F.r, color: grey }); }
    const foot = [layout.footer?.trim() ? winAnsi(layout.footer.trim()) : '', layout.pageNumbers ? `Página ${i + 1} de ${pages.length}` : ''].filter(Boolean).join('   ·   ');
    if (foot) { const w = F.r.widthOfTextAtSize(foot, 9); pg.drawText(foot, { x: (W - w) / 2, y: mv - 16, size: 9, font: F.r, color: grey }); }
  });
  return new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' });
}

/** Guarda un documento HTML en el formato pedido. */
export async function exportDocument(html: string, title: string, fmt: string, layout: DocLayout = {}): Promise<Blob> {
  switch (fmt) {
    case 'docx': return htmlToDocx(html, title, layout);
    case 'pdf': return htmlToPdf(html, title, layout);
    case 'odt': return htmlToOdt(html, title);
    case 'rtf': return new Blob([htmlToRtf(html)], { type: 'application/rtf' });
    case 'html': return new Blob([fullHtml(html, title)], { type: 'text/html;charset=utf-8' });
    case 'txt': return new Blob(['﻿' + htmlToText(html)], { type: 'text/plain;charset=utf-8' });
    case 'md': return new Blob([htmlToMarkdown(html)], { type: 'text/markdown;charset=utf-8' });
    default: throw new Error('Formato no disponible');
  }
}

/** Texto de un PDF (para convertirlo a Word, TXT…). */
export async function pdfToHtml(src: Blob): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(await src.arrayBuffer()));
  const { text } = await extractText(doc, { mergePages: false });
  return (text as string[]).map((t, i) => `${i ? '<hr>' : ''}${textToHtml(t)}`).join('');
}
