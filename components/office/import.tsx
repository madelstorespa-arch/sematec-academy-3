'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOfficeDoc } from '@/app/app/oficina/actions';
import { kindOf } from '@/components/download-menu';
import { OO_CLIENT_EXT, uploadToOnlyoffice } from './onlyoffice-client';

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

/** Convierte un archivo de Office (o compatible) al formato del editor y crea el documento. */
export async function importToOffice(file: Blob, name: string, folderId?: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
  const kind = kindOf(name, file.type);
  if (kind === 'doc' || kind === 'pdf') {
    const d = await import('@/lib/convert/docs');
    const html = kind === 'pdf' ? await d.pdfToHtml(file) : await d.readDocument(file, name);
    return createOfficeDoc('doc', baseName(name), { html }, folderId);
  }
  if (kind === 'sheet') { const s = await import('@/lib/office/sheet'); return createOfficeDoc('sheet', baseName(name), { wb: await s.readWorkbook(file, name) }, folderId); }
  if (kind === 'slides') { const s = await import('@/lib/office/deck'); return createOfficeDoc('slides', baseName(name), { deck: await s.readPptx(file) }, folderId); }
  return { ok: false, error: 'Formato no compatible. Use Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, ODT, ODS, RTF, TXT, Markdown o PDF.' };
}

export function OfficeImport({ folderId, org, oo }: { folderId?: string | null; org?: string; oo?: boolean } = {}) {
  const [exact, setExact] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const go = async (f?: File) => {
    if (!f) return;
    setBusy(true); setErr(null);
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    if (oo && org && exact && OO_CLIENT_EXT.includes(ext)) {
      try { const id = await uploadToOnlyoffice(f, f.name, { org, title: baseName(f.name), folder: folderId }); router.push(`/app/oficina/${id}`); }
      catch (e) { setErr(`No se pudo abrir «${f.name}»: ${(e as Error).message}`); }
      finally { setBusy(false); if (input.current) input.current.value = ''; }
      return;
    }
    try { const r = await importToOffice(f, f.name, folderId); if (r.ok && r.id) router.push(`/app/oficina/${r.id}`); else setErr(r.error ?? 'No se pudo abrir.'); }
    catch (e) { setErr(`No se pudo abrir «${f.name}»: ${(e as Error).message}`); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div>
      <input ref={input} type="file" className="hidden" accept=".docx,.odt,.rtf,.txt,.md,.html,.htm,.pdf,.xlsx,.csv,.tsv,.ods,.pptx" onChange={(e) => go(e.target.files?.[0])} data-testid="importar-oficina" />
      <button className="btn-secondary" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Abriendo…' : '📂 Abrir archivo de mi equipo'}</button>
      {oo && <label className="mt-1 flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} data-testid="importar-exacto" /> Abrir Word/Excel/PowerPoint con ONLYOFFICE (formato exacto)</label>}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
