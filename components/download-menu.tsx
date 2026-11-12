'use client';
import { useEffect, useRef, useState } from 'react';
import { AUDIO_FORMATS, IMAGE_FORMATS, VIDEO_FORMATS, baseName, convertImage, convertMedia, saveBlob, type Fmt } from '@/lib/convert/media';
import { DOC_EXT, DOC_FORMATS } from '@/lib/convert/docs';
import { SHEET_EXT, SHEET_FORMATS } from '@/lib/office/sheet';
import { SLIDE_FORMATS } from '@/lib/office/deck';

type Kind = 'video' | 'audio' | 'image' | 'doc' | 'sheet' | 'slides' | 'pdf' | 'other';
const extOf = (n: string) => (n.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

export function kindOf(name: string, mime: string): Kind {
  const e = extOf(name);
  if (mime.startsWith('video/') || ['webm', 'mp4', 'mov', 'mkv', 'avi'].includes(e)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'opus'].includes(e)) return 'audio';
  if (/^image\/(png|jpe?g|webp|gif|bmp)/.test(mime) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e)) return 'image';
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (SHEET_EXT.includes(e)) return 'sheet';
  if (e === 'pptx') return 'slides';
  if (DOC_EXT.includes(e)) return 'doc';
  return 'other';
}

export function formatsFor(kind: Kind): Fmt[] {
  switch (kind) {
    case 'video': return VIDEO_FORMATS;
    case 'audio': return AUDIO_FORMATS;
    case 'image': return IMAGE_FORMATS;
    case 'doc': return DOC_FORMATS;
    case 'sheet': return SHEET_FORMATS;
    case 'slides': return SLIDE_FORMATS;
    case 'pdf': return DOC_FORMATS.filter((f) => f.id !== 'pdf').map((f) => ({ ...f, label: `${f.label} (solo el texto)` }));
    default: return [];
  }
}

/** Convierte un archivo a otro formato dentro del navegador. */
export async function convertFile(src: Blob, name: string, mime: string, fmt: string, onProgress?: (p: number, m: string) => void): Promise<Blob> {
  const kind = kindOf(name, mime);
  if (kind === 'video' || kind === 'audio') return convertMedia(src, name, fmt, onProgress);
  if (kind === 'image') return convertImage(src, fmt);
  onProgress?.(0.3, 'Convirtiendo…');
  if (kind === 'doc' || kind === 'pdf') {
    const d = await import('@/lib/convert/docs');
    const html = kind === 'pdf' ? await d.pdfToHtml(src) : await d.readDocument(src, name);
    return d.exportDocument(html, baseName(name), fmt);
  }
  if (kind === 'sheet') { const s = await import('@/lib/office/sheet'); return s.exportWorkbook(await s.readWorkbook(src, name), baseName(name), fmt); }
  if (kind === 'slides') { const s = await import('@/lib/office/deck'); return s.exportDeck(await s.readPptx(src), baseName(name), fmt); }
  throw new Error('Este tipo de archivo solo se puede descargar en su formato original.');
}

/** ⬇ Botón «Descargar» con la opción de elegir el formato (MP4, MP3, DOCX, PDF, XLSX, PPTX…). */
export function DownloadMenu({ href, name, mime, fileId, className = 'btn-secondary btn-sm' }: { href: string; name: string; mime: string; fileId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<{ p: number; msg: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const kind = kindOf(name, mime);
  const formats = formatsFor(kind).filter((f) => f.ext !== extOf(name));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = async (f: Fmt) => {
    setOpen(false); setErr(null); setBusy({ p: 0, msg: 'Descargando el original…' });
    try {
      const r = await fetch(href, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('No se pudo leer el archivo.');
      const src = await r.blob();
      const out = await convertFile(src, name, mime || src.type, f.id, (p, msg) => setBusy({ p, msg }));
      saveBlob(out, `${baseName(name)}.${f.ext}`);
    } catch (e) { setErr((e as Error).message || 'No se pudo convertir.'); }
    finally { setBusy(null); }
  };
  if (!formats.length) return <a className={className} href={href}>⬇ Descargar</a>;
  const openable = ['doc', 'sheet', 'slides'].includes(kind) && fileId;
  return (
    <span ref={box} className="relative inline-flex flex-col">
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!!busy} data-testid="descargar-como">
        {busy ? `⏳ ${Math.round(busy.p * 100)}%` : '⬇ Descargar ▾'}</button>
      {open && (
        <span className="absolute left-0 top-full z-40 mt-1 max-h-96 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 text-left text-sm text-slate-800 shadow-2xl" data-testid="menu-formatos">
          <a className="block rounded-lg px-3 py-2 font-semibold hover:bg-slate-100" href={href}>Original (.{extOf(name) || 'archivo'})</a>
          {openable && <a className="block rounded-lg px-3 py-2 hover:bg-slate-100" href={`/app/oficina/abrir/${fileId}`}>✏ Abrir y editar en SEMATEC Oficina</a>}
          <span className="block px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Convertir y descargar como</span>
          {formats.map((f) => (
            <button key={f.id} type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100" onClick={() => pick(f)} data-testid={`formato-${f.id}`}>
              {f.label}{f.hint && <span className="block text-xs text-slate-500">{f.hint}</span>}
            </button>))}
          {(kind === 'video' || kind === 'audio') && <span className="block px-3 py-2 text-xs text-slate-500">La conversión se hace en su equipo; un video largo puede tardar varios minutos.</span>}
        </span>)}
      {busy && <span className="mt-1 block text-xs text-slate-500" data-testid="progreso-conversion">{busy.msg}<span className="mt-0.5 block h-1.5 w-40 overflow-hidden rounded bg-slate-200"><span className="block h-full bg-brand-600 transition-all" style={{ width: `${Math.max(3, busy.p * 100)}%` }} /></span></span>}
      {err && <span className="mt-1 block max-w-xs text-xs text-red-600">{err}</span>}
    </span>
  );
}
