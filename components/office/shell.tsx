'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { saveOfficeDoc, shareOfficeDoc } from '@/app/app/oficina/actions';
import { saveBlob, type Fmt } from '@/lib/convert/media';
import { uploadUserFile } from '@/components/file-uploader';

export type OfficeDocProps = { id: string; kind: 'doc' | 'sheet' | 'slides' | 'pub'; title: string; content: Record<string, unknown>; canEdit: boolean; isOwner: boolean; shared: string; orgId: string; updatedAt: string };

/** Guardado automático: guarda 1,2 s después del último cambio y al salir de la página. */
export function useAutosave(id: string, canEdit: boolean) {
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [msg, setMsg] = useState<string | null>(null);
  const pending = useRef<{ title: string; content: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (!pending.current || !canEdit) return;
    const p = pending.current; pending.current = null; setStatus('saving');
    const r = await saveOfficeDoc(id, p.title, p.content).catch(() => ({ ok: false, error: 'Sin conexión' }));
    if (r.ok) { setStatus(pending.current ? 'dirty' : 'saved'); setMsg(null); }
    else { pending.current = pending.current ?? p; setStatus('error'); setMsg(r.error ?? 'No se pudo guardar'); timer.current = setTimeout(flush, 5000); }
  }, [id, canEdit]);
  const change = useCallback((title: string, content: unknown) => {
    if (!canEdit) return;
    pending.current = { title, content }; setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
  }, [canEdit, flush]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (pending.current) { flush(); e.preventDefault(); } };
    window.addEventListener('beforeunload', before);
    return () => { window.removeEventListener('beforeunload', before); if (pending.current) flush(); };
  }, [flush]);
  return { status, msg, change, flush };
}

const STATUS = { saved: '✓ Guardado', dirty: '● Cambios sin guardar', saving: 'Guardando…', error: '⚠ No guardado' };

/** Barra superior común de los editores: nombre, estado, descargar en varios formatos, guardar en Mis archivos y compartir. */
export function OfficeBar({ doc, title, setTitle, status, msg, formats, exportAs, extra, saveExt }: {
  doc: OfficeDocProps; title: string; setTitle: (t: string) => void; status: keyof typeof STATUS; msg: string | null;
  formats: Fmt[]; exportAs: (fmt: string) => Promise<Blob>; extra?: React.ReactNode; saveExt: string;
}) {
  const [open, setOpen] = useState<null | 'download' | 'share'>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shared, setShared] = useState(doc.shared);
  const APP = { doc: ['📄', 'Documento', 'bg-blue-700'], sheet: ['📊', 'Hoja de cálculo', 'bg-emerald-700'], slides: ['📽', 'Presentación', 'bg-orange-600'], pub: ['📰', 'Publicación', 'bg-teal-700'] }[doc.kind];
  const download = async (f: Fmt) => {
    setOpen(null); setBusy(`Preparando ${f.label}…`); setNote(null);
    try { saveBlob(await exportAs(f.id), `${title || 'Documento'}.${f.ext}`); } catch (e) { setNote(`No se pudo exportar: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  const toFiles = async () => {
    const f = formats.find((x) => x.id === saveExt)!; setOpen(null); setBusy('Guardando en Mis archivos…'); setNote(null);
    try {
      const blob = await exportAs(f.id);
      await uploadUserFile(doc.orgId, new File([blob], `${title || 'Documento'}.${f.ext}`, { type: f.mime }), { description: 'Creado en SEMATEC Oficina' });
      setNote(`✓ Copia guardada en Mis archivos como ${f.label}.`);
    } catch (e) { setNote(`No se pudo guardar: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  const share = async (v: string) => { const r = await shareOfficeDoc(doc.id, v); if (r.ok) { setShared(v); setNote(v === 'private' ? 'Ahora solo usted ve este documento.' : v === 'org_view' ? 'Toda la institución puede verlo.' : 'Toda la institución puede verlo y editarlo.'); } else setNote(r.error ?? 'No se pudo compartir.'); setOpen(null); };
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8" data-testid="barra-oficina">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/app/oficina" className={`grid h-9 w-9 place-items-center rounded-lg text-lg text-white ${APP[2]}`} title="Volver a SEMATEC Oficina">{APP[0]}</Link>
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!doc.canEdit} className="min-w-0 max-w-md flex-1 rounded-lg border border-transparent px-2 py-1 text-lg font-semibold hover:border-slate-200 focus:border-brand-500 focus:outline-none" aria-label="Nombre del documento" data-testid="titulo-documento" />
        <span className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-slate-500'}`} title={msg ?? ''} data-testid="estado-guardado">{doc.canEdit ? STATUS[status] : '👁 Solo lectura'}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {extra}
          <span className="relative">
            <button className="btn-primary btn-sm" onClick={() => setOpen(open === 'download' ? null : 'download')} disabled={!!busy} data-testid="oficina-descargar">⬇ Descargar ▾</button>
            {open === 'download' && (
              <span className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-2xl" data-testid="oficina-formatos">
                {formats.map((f) => <button key={f.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100" onClick={() => download(f)} data-testid={`exportar-${f.id}`}>{f.label}{f.hint && <span className="block text-xs text-slate-500">{f.hint}</span>}</button>)}
                <span className="my-1 block border-t border-slate-100" />
                <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100" onClick={toFiles} data-testid="guardar-en-archivos">💾 Guardar una copia en Mis archivos</button>
              </span>)}
          </span>
          {doc.isOwner && <span className="relative">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(open === 'share' ? null : 'share')} data-testid="oficina-compartir">{shared === 'private' ? '🔒' : '👥'} Compartir</button>
            {open === 'share' && (
              <span className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-2xl">
                {[['private', '🔒 Solo yo'], ['org_view', '👁 Toda la institución puede ver'], ['org_edit', '✏ Toda la institución puede editar']].map(([v, l]) => (
                  <button key={v} className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 ${shared === v ? 'font-bold text-brand-700' : ''}`} onClick={() => share(v)}>{l}</button>))}
              </span>)}
          </span>}
        </span>
      </div>
      {(busy || note) && <p className="mt-1 text-xs text-slate-600" data-testid="oficina-aviso">{busy ?? note}</p>}
    </div>
  );
}

/** Menús desplegables de las cintas (<details>): se cierran al elegir una opción o al hacer clic fuera. */
export function useMenus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current; if (!root) return;
    const outside = (e: MouseEvent) => root.querySelectorAll('details[open]').forEach((d) => { if (!d.contains(e.target as Node)) d.removeAttribute('open'); });
    const pick = (e: MouseEvent) => {
      const t = e.target as HTMLElement; const d = t.closest('details');
      if (d && root.contains(d) && t.closest('button') && !t.closest('summary')) setTimeout(() => d.removeAttribute('open'), 0);
    };
    const toggle = (e: Event) => { const d = e.target as HTMLDetailsElement; if (d.open) root.querySelectorAll('details[open]').forEach((x) => { if (x !== d && !x.contains(d)) x.removeAttribute('open'); }); };
    document.addEventListener('mousedown', outside); root.addEventListener('click', pick); root.addEventListener('toggle', toggle, true);
    return () => { document.removeEventListener('mousedown', outside); root.removeEventListener('click', pick); root.removeEventListener('toggle', toggle, true); };
  }, []);
  return ref;
}
