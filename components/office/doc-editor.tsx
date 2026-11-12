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
import { DOC_FORMATS, exportDocument, sanitize } from '@/lib/convert/docs';
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
type PageCfg = { size: string; margin: string };
const PAGE: Record<string, { label: string; w: number; h: number }> = { a4: { label: 'A4', w: 794, h: 1123 }, carta: { label: 'Carta', w: 816, h: 1056 }, oficio: { label: 'Oficio', w: 816, h: 1248 } };
const MARGIN: Record<string, { label: string; v: number; h: number }> = { normal: { label: 'Normal', v: 72, h: 84 }, estrecho: { label: 'Estrecho', v: 48, h: 48 }, ancho: { label: 'Ancho', v: 96, h: 128 } };
const Sep = () => <span className="mx-1 h-6 w-px bg-slate-200" />;

function Ribbon({ ed, onImage, page, setPage }: { ed: Editor; onImage: () => void; page: PageCfg; setPage: (p: PageCfg) => void }) {
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
          <select className="h-8 rounded-md border border-slate-200 px-1 text-sm" aria-label="Interlineado" defaultValue="" onChange={(e) => { if (e.target.value) c().setLineHeight(e.target.value).run(); }}>
            <option value="">Interlineado</option>{['1', '1.15', '1.5', '2'].map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </>}
        {tab === 'insertar' && <>
          <Btn on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insertar tabla" testid="insertar-tabla">▦ Tabla</Btn>
          {ed.isActive('table') && <><Btn on={() => c().addRowAfter().run()} title="Agregar fila">+ fila</Btn><Btn on={() => c().addColumnAfter().run()} title="Agregar columna">+ col.</Btn>
            <Btn on={() => c().deleteRow().run()} title="Eliminar fila">− fila</Btn><Btn on={() => c().deleteColumn().run()} title="Eliminar columna">− col.</Btn><Btn on={() => c().deleteTable().run()} title="Eliminar tabla">✕ tabla</Btn></>}
          <Btn on={onImage} title="Insertar imagen">🖼 Imagen</Btn>
          <Btn on={() => { const u = prompt('Dirección del enlace (https://…)'); if (u && /^(https?:|mailto:)/i.test(u)) c().extendMarkRange('link').setLink({ href: u }).run(); }} active={ed.isActive('link')} title="Insertar enlace">🔗 Enlace</Btn>
          <Btn on={() => c().setHorizontalRule().run()} title="Línea horizontal">― Línea</Btn>
          <Btn on={() => c().toggleBlockquote().run()} active={ed.isActive('blockquote')} title="Cita">❝ Cita</Btn>
          <Btn on={() => c().insertContent(new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })).run()} title="Fecha de hoy">📅 Fecha</Btn>
          <Btn on={() => c().insertContent('<p style="page-break-after: always"></p>').run()} title="Salto de página">⤓ Salto de página</Btn>
          <details className="relative"><summary className="grid h-8 cursor-pointer list-none place-items-center rounded-md px-2 text-sm hover:bg-slate-100">Ω Símbolo</summary>
            <div className="absolute z-30 mt-1 grid w-56 grid-cols-8 gap-1 rounded-lg border bg-white p-2 shadow-lg">{'©®™°±×÷≈≠≤≥€£¥§¶•…←→↑↓✓✔✗★☆♥αβγπΣΩ∞√½¼¾'.split('').map((s) => <button key={s} className="rounded p-1 hover:bg-slate-100" onClick={() => c().insertContent(s).run()}>{s}</button>)}</div></details>
        </>}
        {tab === 'diseno' && <>
          <span className="px-1 text-xs text-slate-500">Tamaño:</span>
          {Object.entries(PAGE).map(([k, v]) => <Btn key={k} on={() => setPage({ ...page, size: k })} active={page.size === k} title={`Tamaño ${v.label}`}>{v.label}</Btn>)}<Sep />
          <span className="px-1 text-xs text-slate-500">Márgenes:</span>
          {Object.entries(MARGIN).map(([k, v]) => <Btn key={k} on={() => setPage({ ...page, margin: k })} active={page.margin === k} title={`Márgenes ${v.label}`}>{v.label}</Btn>)}
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
  const [page, setPageState] = useState<PageCfg>(() => ({ size: 'a4', margin: 'normal', ...((doc.content as { page?: PageCfg }).page ?? {}) }));
  const pageRef = useRef(page); pageRef.current = page;
  const save = useAutosave(doc.id, doc.canEdit);
  const imgInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef(title); titleRef.current = title;
  const ed = useEditor({
    immediatelyRender: false, editable: doc.canEdit,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyle, Color, FontFamily, FontSize, LineHeight, Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, Image.configure({ allowBase64: true }), Subscript, Superscript,
      Placeholder.configure({ placeholder: 'Escriba aquí…' }), CharacterCount,
    ],
    content: initial,
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
  const words = ed?.storage.characterCount?.words?.() ?? 0;
  return (
    <div>
      <OfficeBar doc={doc} title={title} setTitle={setTitle} status={save.status} msg={save.msg} formats={DOC_FORMATS} saveExt="docx"
        exportAs={(f) => exportDocument(sanitize(ed?.getHTML() ?? ''), title, f)}
        extra={<button className="btn-secondary btn-sm" onClick={() => window.print()} title="Imprimir o guardar como PDF">🖨 Imprimir</button>} />
      {ed && doc.canEdit && <div className="print:hidden"><Ribbon ed={ed} onImage={() => imgInput.current?.click()} page={page} setPage={setPage} /></div>}
      <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="oficina-lienzo mt-3 overflow-auto rounded-xl bg-slate-200/70 px-2 py-8 print:bg-white print:p-0">
        <div className="oficina-hoja mx-auto bg-white shadow-xl print:shadow-none" style={{ width: `${(PAGE[page.size].w * zoom) / 100}px`, minHeight: `${(PAGE[page.size].h * zoom) / 100}px`, padding: `${(MARGIN[page.margin].v * zoom) / 100}px ${(MARGIN[page.margin].h * zoom) / 100}px` }}>
          <div style={{ zoom: zoom / 100 }}><EditorContent editor={ed} className="oficina-doc" data-testid="editor-documento" /></div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 print:hidden">
        <span data-testid="contador-palabras">{words} palabras</span>
        <label className="flex items-center gap-2">Zoom <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom}%</label>
      </div>
    </div>
  );
}
