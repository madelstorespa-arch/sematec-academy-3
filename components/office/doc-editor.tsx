'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize, LineHeight } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { Node as TNode, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { DOC_FORMATS, exportDocument, sanitize, type DocLayout } from '@/lib/convert/docs';
import { DOC_TEMPLATES } from '@/lib/office/templates';
import { OfficeBar, useAutosave, useMenus, type OfficeDocProps } from './shell';

const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS', 'Comic Sans MS'];
const SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];
const COLORS = ['#000000', '#434343', '#666666', '#c00000', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#1f45c8', '#7c3aed', '#db2777'];
const MARKS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'];

function Btn({ on, active, title, children, testid }: { on: () => void; active?: boolean; title: string; children: React.ReactNode; testid?: string }) {
  return <button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={on} data-testid={testid}
    className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-sm ${active ? 'bg-blue-100 text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`}>{children}</button>;
}
type PageCfg = { size: string; margin: string; orient?: 'v' | 'h'; header?: string; footer?: string; pageNumbers?: boolean };

/** Color de fondo (sombreado) en celdas de tabla. */
const cellBg = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute('data-background-color') || null,
    renderHTML: (a: { backgroundColor?: string | null }) => (a.backgroundColor ? { style: `background-color: ${a.backgroundColor}`, 'data-background-color': a.backgroundColor } : {}),
  },
};
const ShadedCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBg }; } });
const ShadedHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBg }; } });
/** Salto de página real (se respeta al imprimir y al exportar a Word/PDF). */
const PageBreak = TNode.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }, { tag: 'p', getAttrs: (el) => ((el as HTMLElement).style.pageBreakAfter === 'always' ? {} : false), priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'salto-pagina', style: 'page-break-after: always; break-after: page' })],
});

type Match = { from: number; to: number };
/** Busca el texto en todo el documento (también cuando cruza negritas, colores, etc.). */
function findAll(ed: Editor, term: string, matchCase: boolean): Match[] {
  const out: Match[] = []; if (!term) return out;
  const needle = matchCase ? term : term.toLocaleLowerCase('es');
  ed.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const raw = node.textBetween(0, node.content.size, undefined, '\ufffc');
    const hay = matchCase ? raw : raw.toLocaleLowerCase('es');
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length });
    return false;
  });
  return out;
}

function FindBar({ ed, close, canEdit }: { ed: Editor; close: () => void; canEdit: boolean }) {
  const [term, setTerm] = useState(''); const [rep, setRep] = useState(''); const [mc, setMc] = useState(false);
  const [info, setInfo] = useState('');
  const matches = useMemo(() => findAll(ed, term, mc), [ed, term, mc, info]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (dir: 1 | -1) => {
    if (!matches.length) { setInfo('Sin resultados'); return; }
    const at = dir === 1 ? ed.state.selection.to : ed.state.selection.from;
    const m = dir === 1 ? matches.find((x) => x.from >= at) ?? matches[0] : [...matches].reverse().find((x) => x.to <= at) ?? matches[matches.length - 1];
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, m.from, m.to)).scrollIntoView());
    setInfo(`${matches.indexOf(m) + 1} de ${matches.length}`);
  };
  const replaceOne = () => {
    const { from, to } = ed.state.selection; const m = matches.find((x) => x.from === from && x.to === to);
    if (!m) { go(1); return; }
    ed.view.dispatch(rep ? ed.state.tr.insertText(rep, m.from, m.to) : ed.state.tr.delete(m.from, m.to));
    setInfo('1 reemplazo'); setTimeout(() => go(1), 0);
  };
  const replaceAll = () => {
    const ms = findAll(ed, term, mc); if (!ms.length) { setInfo('Sin resultados'); return; }
    let tr = ed.state.tr;
    for (const m of [...ms].reverse()) tr = rep ? tr.insertText(rep, m.from, m.to) : tr.delete(m.from, m.to);
    ed.view.dispatch(tr); setInfo(`${ms.length} reemplazo(s)`);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm shadow-sm print:hidden" data-testid="buscar-reemplazar">
      <input autoFocus className="input h-8 w-48" placeholder="Buscar…" value={term} onChange={(e) => { setTerm(e.target.value); setInfo(''); }} onKeyDown={(e) => { if (e.key === 'Enter') go(e.shiftKey ? -1 : 1); if (e.key === 'Escape') close(); }} data-testid="buscar-texto" />
      <button className="btn-secondary btn-sm" onClick={() => go(-1)} title="Anterior">↑</button><button className="btn-secondary btn-sm" onClick={() => go(1)} title="Siguiente" data-testid="buscar-siguiente">↓</button>
      {canEdit && <>
        <input className="input h-8 w-48" placeholder="Reemplazar por…" value={rep} onChange={(e) => setRep(e.target.value)} data-testid="reemplazar-texto" />
        <button className="btn-secondary btn-sm" onClick={replaceOne} data-testid="reemplazar-uno">Reemplazar</button>
        <button className="btn-secondary btn-sm" onClick={replaceAll} data-testid="reemplazar-todo">Reemplazar todo</button></>}
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={mc} onChange={(e) => setMc(e.target.checked)} /> Mayús./minús.</label>
      <span className="text-xs text-slate-500" data-testid="buscar-resultado">{info || (term ? `${matches.length} coincidencia(s)` : '')}</span>
      <button className="ml-auto rounded px-2 text-slate-500 hover:bg-slate-100" onClick={close} aria-label="Cerrar búsqueda">✕</button>
    </div>
  );
}

/** Índice (tabla de contenido) a partir de los títulos del documento. */
function tocHtml(ed: Editor) {
  const hs: { level: number; text: string }[] = [];
  ed.state.doc.descendants((n) => { if (n.type.name === 'heading' && n.textContent.trim()) hs.push({ level: n.attrs.level, text: n.textContent.trim() }); return n.type.name !== 'heading'; });
  if (!hs.length) return null;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const min = Math.min(...hs.map((h) => h.level));
  let html = '<h2>Índice</h2>'; let depth = 0;
  for (const h of hs) {
    const d = h.level - min + 1;
    while (depth < d) { html += '<ul>'; depth++; }
    while (depth > d) { html += '</ul>'; depth--; }
    html += `<li><p>${esc(h.text)}</p></li>`;
  }
  while (depth > 0) { html += '</ul>'; depth--; }
  return html;
}
const SHADES = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#e2e8f0', '#1f45c8'];
const PAGE: Record<string, { label: string; w: number; h: number }> = { a4: { label: 'A4', w: 794, h: 1123 }, carta: { label: 'Carta', w: 816, h: 1056 }, oficio: { label: 'Oficio', w: 816, h: 1248 } };
const MARGIN: Record<string, { label: string; v: number; h: number }> = { normal: { label: 'Normal', v: 72, h: 84 }, estrecho: { label: 'Estrecho', v: 48, h: 48 }, ancho: { label: 'Ancho', v: 96, h: 128 } };
const Sep = () => <span className="mx-1 h-6 w-px bg-slate-200" />;

function Ribbon({ ed, onImage, page, setPage, onFind }: { ed: Editor; onImage: () => void; page: PageCfg; setPage: (p: PageCfg) => void; onFind: () => void }) {
  const [tab, setTab] = useState<'inicio' | 'insertar' | 'diseno'>('inicio');
  const menus = useMenus<HTMLDivElement>();
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); ed.on('selectionUpdate', f); ed.on('transaction', f); return () => { ed.off('selectionUpdate', f); ed.off('transaction', f); }; }, [ed]);
  const c = () => ed.chain().focus();
  const attrs = ed.getAttributes('textStyle');
  const block = ed.isActive('heading', { level: 1 }) ? 'h1' : ed.isActive('heading', { level: 2 }) ? 'h2' : ed.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  return (
    <div ref={menus} className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="cinta-word">
      <div className="flex gap-1 border-b border-slate-100 px-2 pt-1 text-sm">
        {([['inicio', 'Inicio'], ['insertar', 'Insertar'], ['diseno', 'Diseño']] as const).map(([k, l]) => (
          <button key={k} className={`rounded-t-md px-3 py-1.5 font-semibold ${tab === k ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'}`} onClick={() => setTab(k)}>{l}</button>))}
      </div>
      <div className="flex flex-wrap items-center gap-0.5 p-1.5">
        <Btn on={() => c().undo().run()} title="Deshacer (Ctrl+Z)">↶</Btn><Btn on={() => c().redo().run()} title="Rehacer (Ctrl+Y)">↷</Btn><Sep />
        {tab === 'inicio' && <>
          <select className="h-8 rounded-md border border-slate-200 px-1 text-sm" value={block} aria-label="Estilo" data-testid="estilo-parrafo"
            onChange={(e) => { const v = e.target.value; if (v === 'p') c().setParagraph().run(); else c().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run(); }}>
            <option value="p">Normal</option><option value="h1">Título 1</option><option value="h2">Título 2</option><option value="h3">Título 3</option>
          </select>
          <select className="h-8 w-32 rounded-md border border-slate-200 px-1 text-sm" value={attrs.fontFamily ?? 'Calibri'} aria-label="Fuente" onChange={(e) => c().setFontFamily(e.target.value).run()}>
            {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}</select>
          <select className="h-8 w-16 rounded-md border border-slate-200 px-1 text-sm" value={String(attrs.fontSize ?? '11pt').replace('pt', '')} aria-label="Tamaño" onChange={(e) => c().setFontSize(`${e.target.value}pt`).run()}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select><Sep />
          <Btn on={() => c().toggleBold().run()} active={ed.isActive('bold')} title="Negrita (Ctrl+B)" testid="negrita"><b>N</b></Btn>
          <Btn on={() => c().toggleItalic().run()} active={ed.isActive('italic')} title="Cursiva (Ctrl+I)"><i>K</i></Btn>
          <Btn on={() => c().toggleUnderline().run()} active={ed.isActive('underline')} title="Subrayado (Ctrl+U)"><u>S</u></Btn>
          <Btn on={() => c().toggleStrike().run()} active={ed.isActive('strike')} title="Tachado"><s>ab</s></Btn>
          <Btn on={() => c().toggleSubscript().run()} active={ed.isActive('subscript')} title="Subíndice">x₂</Btn>
          <Btn on={() => c().toggleSuperscript().run()} active={ed.isActive('superscript')} title="Superíndice">x²</Btn>
          <details className="relative"><summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md hover:bg-slate-100" title="Color de fuente"><span className="border-b-4 font-bold leading-none" style={{ borderColor: attrs.color ?? '#000' }}>A</span></summary>
            <div className="absolute z-30 mt-1 grid w-40 grid-cols-6 gap-1 rounded-lg border bg-white p-2 shadow-lg">{COLORS.map((x) => <button key={x} className="h-5 w-5 rounded" style={{ background: x }} onClick={() => c().setColor(x).run()} aria-label={x} />)}
              <button className="col-span-6 text-xs text-slate-500" onClick={() => c().unsetColor().run()}>Automático</button></div></details>
          <details className="relative"><summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md hover:bg-slate-100" title="Resaltar">🖍</summary>
            <div className="absolute z-30 mt-1 flex gap-1 rounded-lg border bg-white p-2 shadow-lg">{MARKS.map((x) => <button key={x} className="h-5 w-5 rounded" style={{ background: x }} onClick={() => c().toggleHighlight({ color: x }).run()} aria-label={x} />)}
              <button className="text-xs" onClick={() => c().unsetHighlight().run()}>✕</button></div></details>
          <Btn on={() => c().unsetAllMarks().clearNodes().run()} title="Borrar formato">⌫</Btn><Sep />
          <Btn on={() => c().toggleBulletList().run()} active={ed.isActive('bulletList')} title="Viñetas">•≡</Btn>
          <Btn on={() => c().toggleOrderedList().run()} active={ed.isActive('orderedList')} title="Numeración">1≡</Btn>
          <Btn on={() => c().sinkListItem('listItem').run()} title="Aumentar sangría">⇥</Btn><Btn on={() => c().liftListItem('listItem').run()} title="Disminuir sangría">⇤</Btn><Sep />
          {(['left', 'center', 'right', 'justify'] as const).map((a) => <Btn key={a} on={() => c().setTextAlign(a).run()} active={ed.isActive({ textAlign: a })} title={{ left: 'Alinear a la izquierda', center: 'Centrar', right: 'Alinear a la derecha', justify: 'Justificar' }[a]}>{{ left: '⬅', center: '↔', right: '➡', justify: '☰' }[a]}</Btn>)}
          <Sep /><Btn on={onFind} title="Buscar y reemplazar (Ctrl+F)" testid="abrir-buscar">🔍 Buscar</Btn>
          <select className="h-8 rounded-md border border-slate-200 px-1 text-sm" aria-label="Interlineado" defaultValue="" onChange={(e) => { if (e.target.value) c().setLineHeight(e.target.value).run(); }}>
            <option value="">Interlineado</option>{['1', '1.15', '1.5', '2'].map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </>}
        {tab === 'insertar' && <>
          <Btn on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insertar tabla" testid="insertar-tabla">▦ Tabla</Btn>
          {ed.isActive('table') && <><Btn on={() => c().addRowAfter().run()} title="Agregar fila">+ fila</Btn><Btn on={() => c().addColumnAfter().run()} title="Agregar columna">+ col.</Btn>
            <Btn on={() => c().deleteRow().run()} title="Eliminar fila">− fila</Btn><Btn on={() => c().deleteColumn().run()} title="Eliminar columna">− col.</Btn>
            <Btn on={() => c().mergeCells().run()} title="Combinar celdas seleccionadas" testid="combinar-celdas">⊞ Combinar</Btn><Btn on={() => c().splitCell().run()} title="Dividir celda">⊟ Dividir</Btn>
            <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100" title="Sombreado de celda" data-testid="sombreado">🎨 Sombreado</summary>
              <div className="absolute z-30 mt-1 flex gap-1 rounded-lg border bg-white p-2 shadow-lg">{SHADES.map((x) => <button key={x} className="h-5 w-5 rounded border" style={{ background: x }} onClick={() => c().setCellAttribute('backgroundColor', x).run()} aria-label={`Sombreado ${x}`} data-testid={`sombra-${x.slice(1)}`} />)}
                <button className="text-xs" onClick={() => c().setCellAttribute('backgroundColor', null).run()}>✕</button></div></details>
            <Btn on={() => c().deleteTable().run()} title="Eliminar tabla">✕ tabla</Btn></>}
          <Btn on={onImage} title="Insertar imagen">🖼 Imagen</Btn>
          <Btn on={() => { const u = prompt('Dirección del enlace (https://…)'); if (u && /^(https?:|mailto:)/i.test(u)) c().extendMarkRange('link').setLink({ href: u }).run(); }} active={ed.isActive('link')} title="Insertar enlace">🔗 Enlace</Btn>
          <Btn on={() => c().setHorizontalRule().run()} title="Línea horizontal">― Línea</Btn>
          <Btn on={() => c().toggleBlockquote().run()} active={ed.isActive('blockquote')} title="Cita">❝ Cita</Btn>
          <Btn on={() => c().insertContent(new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })).run()} title="Fecha de hoy">📅 Fecha</Btn>
          <Btn on={() => c().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run()} title="Salto de página" testid="salto-pagina">⤓ Salto de página</Btn>
          <Btn on={() => { const h = tocHtml(ed); if (h) c().insertContent(h).run(); else alert('Primero use estilos «Título 1», «Título 2»… en el documento para generar el índice.'); }} title="Insertar índice (tabla de contenido)" testid="insertar-indice">📑 Índice</Btn>
          <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100">Ω Símbolo</summary>
            <div className="absolute z-30 mt-1 grid w-56 grid-cols-8 gap-1 rounded-lg border bg-white p-2 shadow-lg">{'©®™°±×÷≈≠≤≥€£¥§¶•…←→↑↓✓✔✗★☆♥αβγπΣΩ∞√½¼¾'.split('').map((s) => <button key={s} className="rounded p-1 hover:bg-slate-100" onClick={() => c().insertContent(s).run()}>{s}</button>)}</div></details>
        </>}
        {tab === 'diseno' && <>
          <span className="px-1 text-xs text-slate-500">Tamaño:</span>
          {Object.entries(PAGE).map(([k, v]) => <Btn key={k} on={() => setPage({ ...page, size: k })} active={page.size === k} title={`Tamaño ${v.label}`}>{v.label}</Btn>)}<Sep />
          <span className="px-1 text-xs text-slate-500">Márgenes:</span>
          {Object.entries(MARGIN).map(([k, v]) => <Btn key={k} on={() => setPage({ ...page, margin: k })} active={page.margin === k} title={`Márgenes ${v.label}`}>{v.label}</Btn>)}<Sep />
          <span className="px-1 text-xs text-slate-500">Orientación:</span>
          <Btn on={() => setPage({ ...page, orient: 'v' })} active={page.orient !== 'h'} title="Vertical" testid="orientacion-v">▯ Vertical</Btn>
          <Btn on={() => setPage({ ...page, orient: 'h' })} active={page.orient === 'h'} title="Horizontal" testid="orientacion-h">▭ Horizontal</Btn><Sep />
          <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100" data-testid="encabezado-pie">▤ Encabezado y pie</summary>
            <div className="absolute right-0 z-30 mt-1 w-80 space-y-2 rounded-lg border bg-white p-3 text-sm shadow-lg">
              <label className="block text-xs">Encabezado<input className="input mt-1" maxLength={120} defaultValue={page.header ?? ''} onBlur={(e) => setPage({ ...page, header: e.target.value })} data-testid="texto-encabezado" /></label>
              <label className="block text-xs">Pie de página<input className="input mt-1" maxLength={120} defaultValue={page.footer ?? ''} onBlur={(e) => setPage({ ...page, footer: e.target.value })} data-testid="texto-pie" /></label>
            </div></details>
          <label className="flex items-center gap-1 px-2 text-sm"><input type="checkbox" checked={!!page.pageNumbers} onChange={(e) => setPage({ ...page, pageNumbers: e.target.checked })} data-testid="numerar-paginas" /> Números de página</label>
        </>}
      </div>
    </div>
  );
}

export function DocEditor({ doc }: { doc: OfficeDocProps }) {
  const initial = useMemo(() => {
    const c = doc.content as { html?: string; template?: string };
    return c.html ?? DOC_TEMPLATES[c.template ?? 'blanco'] ?? '<p></p>';
  }, [doc.content]);
  const [title, setTitle] = useState(doc.title);
  const [zoom, setZoom] = useState(100);
  const [find, setFind] = useState(false);
  const [page, setPageState] = useState<PageCfg>(() => ({ size: 'a4', margin: 'normal', ...((doc.content as { page?: PageCfg }).page ?? {}) }));
  const pageRef = useRef(page); pageRef.current = page;
  const save = useAutosave(doc);
  const imgInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef(title); titleRef.current = title;
  const ed = useEditor({
    immediatelyRender: false, editable: doc.canEdit,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyle, Color, FontFamily, FontSize, LineHeight, Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }), TableRow, ShadedHeader, ShadedCell, PageBreak, Image.configure({ allowBase64: true }), Subscript, Superscript,
      Placeholder.configure({ placeholder: 'Escriba aquí…' }), CharacterCount,
    ],
    content: initial,
    editorProps: { attributes: { spellcheck: 'true', lang: 'es', autocorrect: 'on' } },
    onUpdate: ({ editor }) => save.change(titleRef.current, { html: editor.getHTML(), page: pageRef.current }),
  });
  const setPage = (p: PageCfg) => { setPageState(p); if (ed) save.change(titleRef.current, { html: ed.getHTML(), page: p }); };
  useEffect(() => { if (ed && title !== doc.title) save.change(title, { html: ed.getHTML(), page }); }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  // Si el documento es nuevo (plantilla), se guarda su contenido inicial
  useEffect(() => { if (ed && !(doc.content as { html?: string }).html && doc.canEdit) save.change(title, { html: ed.getHTML(), page }); }, [ed]); // eslint-disable-line react-hooks/exhaustive-deps
  const addImage = (f?: File) => {
    if (!f || !ed) return;
    if (f.size > 4 * 1024 * 1024) { alert('La imagen pesa más de 4 MB. Use una más liviana.'); return; }
    const r = new FileReader(); r.onload = () => ed.chain().focus().setImage({ src: String(r.result) }).run(); r.readAsDataURL(f);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h')) { e.preventDefault(); setFind(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const words = ed?.storage.characterCount?.words?.() ?? 0;
  return (
    <div>
      <OfficeBar doc={doc} title={title} setTitle={setTitle} save={save} formats={DOC_FORMATS} saveExt="docx"
        exportAs={(f) => exportDocument(sanitize(ed?.getHTML() ?? ''), title, f, page as DocLayout)}
        extra={<button className="btn-secondary btn-sm" onClick={() => window.print()} title="Imprimir o guardar como PDF">🖨 Imprimir</button>} />
      {ed && doc.canEdit && <div className="print:hidden"><Ribbon ed={ed} onImage={() => imgInput.current?.click()} page={page} setPage={setPage} onFind={() => setFind(true)} /></div>}
      {ed && find && <FindBar ed={ed} canEdit={doc.canEdit} close={() => setFind(false)} />}
      <style>{`@page { size: ${PAGE[page.size].label === 'Carta' ? 'letter' : PAGE[page.size].label === 'Oficio' ? '8.5in 13in' : 'A4'} ${page.orient === 'h' ? 'landscape' : 'portrait'}; margin: ${MARGIN[page.margin].v * 0.75}pt ${MARGIN[page.margin].h * 0.75}pt;
        ${page.header?.trim() ? `@top-center { content: "${page.header.replace(/["\\]/g, '')}"; font: 9pt Calibri, Arial; color: #666; }` : ''}
        ${page.footer?.trim() || page.pageNumbers ? `@bottom-center { content: "${(page.footer ?? '').replace(/["\\]/g, '')}${page.footer?.trim() && page.pageNumbers ? '   ·   ' : ''}"${page.pageNumbers ? ' "Página " counter(page) " de " counter(pages)' : ''}; font: 9pt Calibri, Arial; color: #666; }` : ''} }`}</style>
      <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="oficina-lienzo mt-3 overflow-auto rounded-xl bg-slate-200/70 px-2 py-8 print:bg-white print:p-0">
        <div className="oficina-hoja relative mx-auto bg-white shadow-xl print:shadow-none" style={{ width: `${((page.orient === 'h' ? PAGE[page.size].h : PAGE[page.size].w) * zoom) / 100}px`, minHeight: `${((page.orient === 'h' ? PAGE[page.size].w : PAGE[page.size].h) * zoom) / 100}px`, padding: `${(MARGIN[page.margin].v * zoom) / 100}px ${(MARGIN[page.margin].h * zoom) / 100}px` }} data-testid="hoja-documento">
          {page.header?.trim() && <p className="absolute inset-x-0 top-0 truncate text-center text-xs text-slate-400 print:hidden" style={{ paddingTop: `${(MARGIN[page.margin].v * zoom) / 250}px` }} data-testid="vista-encabezado">{page.header}</p>}
          <div style={{ zoom: zoom / 100 }}><EditorContent editor={ed} className="oficina-doc" data-testid="editor-documento" /></div>
          {(page.footer?.trim() || page.pageNumbers) && <p className="absolute inset-x-0 bottom-0 truncate text-center text-xs text-slate-400 print:hidden" style={{ paddingBottom: `${(MARGIN[page.margin].v * zoom) / 250}px` }} data-testid="vista-pie">{page.footer}{page.footer?.trim() && page.pageNumbers ? ' · ' : ''}{page.pageNumbers ? 'Página 1' : ''}</p>}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 print:hidden">
        <span data-testid="contador-palabras">{words} palabras</span>
        <label className="flex items-center gap-2">Zoom <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom}%</label>
      </div>
    </div>
  );
}
