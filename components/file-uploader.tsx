'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FILE_ACCEPT, FILE_MAX, FILE_MAX_LABEL, FILE_TYPES, fmtSize } from '@/lib/user-files';

type Opt = { value: string; label: string };
const guessMime = (f: File) => {
  if (f.type) return f.type;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return Object.entries(FILE_TYPES).find(([, e]) => e === ext)?.[0] ?? '';
};

/** Achica fotos grandes (más de 2560 px o 3 MB) a JPEG de buena calidad antes de subirlas. */
async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 3 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

/** Sube con barra de progreso (PUT al enlace firmado de un solo uso). */
function putWithProgress(path: string, token: string, file: Blob, mime: string, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/user-files/${path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`);
    xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((100 * e.loaded) / e.total)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const txt = xhr.responseText || '';
      reject(new Error(xhr.status === 413 || /exceed|too large|maximum allowed size/i.test(txt)
        ? `El archivo es más grande de lo que permite su plan de Supabase por archivo. Suba el límite en Supabase → Storage → Settings (plan Pro).`
        : `No se pudo subir (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Se cortó la conexión durante la subida. Intente de nuevo.'));
    const body = new FormData(); body.append('cacheControl', '3600'); body.append('', new File([file], 'archivo', { type: mime }));
    xhr.send(body);
  });
}

/** Sube fotos, videos y documentos directo al almacenamiento privado (sin pasar por el servidor). */
export async function uploadUserFile(org: string, original: File, opts: { visibility?: string; section?: string; description?: string } = {},
  onProgress?: (pct: number) => void) {
  const file = await shrinkPhoto(original);
  const mime = guessMime(file);
  if (!FILE_TYPES[mime]) throw new Error(`«${file.name}»: tipo de archivo no permitido.`);
  if (file.size > FILE_MAX) throw new Error(`«${file.name}» pesa ${fmtSize(file.size)}: el máximo es ${FILE_MAX_LABEL} por archivo.`);
  const r1 = await fetch('/api/archivos/subir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org, size: file.size, mime }) });
  const j1 = await r1.json(); if (!r1.ok) throw new Error(j1.error);
  await putWithProgress(j1.path, j1.token, file, mime, onProgress);
  const r2 = await fetch('/api/archivos/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org, path: j1.path, name: file.name, size: file.size, mime, ...opts }) });
  const j2 = await r2.json(); if (!r2.ok) throw new Error(j2.error);
  return j2.id as string;
}

export function FileUploader({ org, sections }: { org: string; sections: Opt[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [vis, setVis] = useState('private');
  const [section, setSection] = useState(sections[0]?.value ?? '');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);

  const send = async () => {
    const files = [...(input.current?.files ?? [])];
    if (!files.length) { setLog([{ ok: false, text: 'Elija uno o más archivos.' }]); return; }
    setBusy(true); setLog([]);
    const out: { ok: boolean; text: string }[] = [];
    for (const f of files) {
      setLog([...out, { ok: true, text: `Subiendo «${f.name}» (${fmtSize(f.size)})…` }]);
      try {
        await uploadUserFile(org, f, { visibility: vis, section: vis === 'section' ? section : undefined, description: desc },
          (pct) => setLog([...out, { ok: true, text: `Subiendo «${f.name}» (${fmtSize(f.size)})… ${pct} %` }]));
        out.push({ ok: true, text: `✓ «${f.name}» guardado` });
      }
      catch (e) { out.push({ ok: false, text: `✕ ${(e as Error).message}` }); }
    }
    setLog(out); setBusy(false);
    if (input.current) input.current.value = '';
    setDesc('');
    router.refresh();
    window.dispatchEvent(new CustomEvent('sematec:changed'));
  };

  return (
    <div className="space-y-3" data-testid="subir-archivos">
      <label className="block"><span className="label">Fotos, videos, audio o documentos (máx. {FILE_MAX_LABEL} c/u; las fotos grandes se achican solas)</span>
        <input ref={input} type="file" multiple accept={FILE_ACCEPT} className="block w-full text-sm" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">¿Quién lo puede ver?</span>
          <select className="input" name="visibility" value={vis} onChange={(e) => setVis(e.target.value)}>
            <option value="private">Solo yo</option>
            {sections.length > 0 && <option value="section">Mi curso (profesor y estudiantes)</option>}
            <option value="staff">Personal y profesores de la institución</option>
            <option value="org">Toda la institución</option>
          </select></label>
        {vis === 'section' && <label className="block"><span className="label">Curso</span>
          <select className="input" name="section" value={section} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>}
      </div>
      <label className="block"><span className="label">Descripción (opcional)</span>
        <input className="input" name="description" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></label>
      <button type="button" className="btn-primary" disabled={busy} onClick={send}>{busy ? 'Subiendo…' : '⬆ Subir archivos'}</button>
      {log.length > 0 && <ul role="status" className="space-y-1 text-sm">{log.map((l, i) => <li key={i} className={l.ok ? 'text-emerald-800' : 'text-red-700'}>{l.text}</li>)}</ul>}
    </div>
  );
}
