'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  saveOfficeDoc, shareOfficeDoc, officePulse, createOfficeDoc, searchPeople, listShares, shareWith, revokeShare,
  listVersions, saveVersion, restoreVersion, listComments, addComment, resolveComment, deleteComment, type SaveResult,
} from '@/app/app/oficina/actions';
import { saveBlob, type Fmt } from '@/lib/convert/media';
import { uploadUserFile } from '@/components/file-uploader';
import { fmtDateTime } from '@/lib/format';
import { uploadToOnlyoffice } from './onlyoffice-client';

export type Access = 'owner' | 'editor' | 'commenter' | 'viewer';
export type OfficeDocProps = {
  id: string; kind: 'doc' | 'sheet' | 'slides' | 'pub'; title: string; content: Record<string, unknown>;
  canEdit: boolean; isOwner: boolean; access: Access; version: number; shared: string; orgId: string; updatedAt: string;
  /** ONLYOFFICE disponible para abrir este documento con el formato exacto de Office. */
  onlyoffice?: boolean;
};
type Status = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
type Conflict = NonNullable<SaveResult['conflict']>;

/**
 * Guardado automático con control de versiones: guarda 1,2 s después del último cambio y al salir.
 * Si otra persona guardó entretanto, NO sobrescribe: avisa y deja elegir qué hacer (sin pérdidas silenciosas).
 * Cada 15 s consulta si hubo cambios de otras personas y quién más tiene el documento abierto.
 */
export function useAutosave(doc: OfficeDocProps) {
  const { id, canEdit } = doc;
  const [status, setStatus] = useState<Status>('saved');
  const [msg, setMsg] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [remote, setRemote] = useState<string | null>(null);
  const [present, setPresent] = useState<string[]>([]);
  const version = useRef(doc.version);
  const pending = useRef<{ title: string; content: unknown } | null>(null);
  const last = useRef<{ title: string; content: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);
  const leaving = useRef(false);
  const flush = useCallback(async (force?: number) => {
    if (!pending.current || !canEdit || (blocked.current && force === undefined)) return;
    const p = pending.current; pending.current = null; last.current = p; setStatus('saving');
    const r: SaveResult = await saveOfficeDoc(id, p.title, p.content, force ?? version.current).catch(() => ({ ok: false, error: 'Sin conexión' }));
    if (r.ok) {
      version.current = r.version ?? version.current; blocked.current = false; setConflict(null); setRemote(null);
      setStatus(pending.current ? 'dirty' : 'saved'); setMsg(null);
      if (pending.current) timer.current = setTimeout(() => flush(), 300);
    } else if (r.conflict) {
      pending.current = pending.current ?? p; blocked.current = true; setConflict(r.conflict); setStatus('conflict'); setMsg('Otra persona guardó cambios');
    } else {
      pending.current = pending.current ?? p; setStatus('error'); setMsg(r.error ?? 'No se pudo guardar'); timer.current = setTimeout(() => flush(), 5000);
    }
  }, [id, canEdit]);
  const change = useCallback((title: string, content: unknown) => {
    if (!canEdit) return;
    pending.current = { title, content };
    if (blocked.current) return;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 1200);
  }, [canEdit, flush]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (pending.current && !leaving.current) { if (!blocked.current) flush(); e.preventDefault(); } };
    window.addEventListener('beforeunload', before);
    return () => { window.removeEventListener('beforeunload', before); if (pending.current && !blocked.current) flush(); };
  }, [flush]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await officePulse(id).catch(() => null);
      if (!alive || !r?.ok) return;
      setPresent(r.present ?? []);
      if (typeof r.version === 'number' && r.version > version.current && !pending.current && !blocked.current) setRemote(r.by ?? 'Otra persona');
    };
    tick(); const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);
  /** Conflicto: reemplazar la versión del servidor con la mía (decisión explícita de la persona). */
  const overwrite = () => { if (conflict) { pending.current = pending.current ?? last.current; flush(conflict.version); } };
  /** Conflicto: guardar mis cambios como un documento aparte y abrirlo. */
  const saveAsCopy = async () => {
    const p = pending.current ?? last.current; if (!p) return;
    const r = await createOfficeDoc(doc.kind, `${p.title} (mi versión)`.slice(0, 200), p.content);
    if (r.ok && r.id) { leaving.current = true; pending.current = null; blocked.current = false; window.location.assign(`/app/oficina/${r.id}`); } else setMsg(r.error ?? 'No se pudo crear la copia');
  };
  const discard = () => { leaving.current = true; pending.current = null; blocked.current = false; window.location.reload(); };
  return { status, msg, change, flush, conflict, remote, present, overwrite, saveAsCopy, discard };
}
export type Saver = ReturnType<typeof useAutosave>;

const STATUS: Record<Status, string> = { saved: '✓ Guardado', dirty: '● Cambios sin guardar', saving: 'Guardando…', error: '⚠ No guardado', conflict: '⚠ Conflicto de edición' };
const ACCESS_LABEL: Record<Access, string> = { owner: 'Dueño', editor: 'Puede editar', commenter: 'Puede comentar', viewer: 'Solo lectura' };
const PERM: [string, string][] = [['viewer', 'Lector'], ['commenter', 'Comentarista'], ['editor', 'Editor']];

/** Barra superior común de los editores: nombre, estado, descargar, compartir, versiones y comentarios. */
export function OfficeBar({ doc, title, setTitle, save, formats, exportAs, extra, saveExt }: {
  doc: OfficeDocProps; title: string; setTitle: (t: string) => void; save: Saver;
  formats: Fmt[]; exportAs: (fmt: string) => Promise<Blob>; extra?: React.ReactNode; saveExt: string;
}) {
  const [open, setOpen] = useState<null | 'download'>(null);
  const [panel, setPanel] = useState<null | 'share' | 'versions' | 'comments'>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
  const OOX = { doc: 'docx', sheet: 'xlsx', slides: 'pptx' } as Record<string, string>;
  const toOnlyoffice = async () => {
    const ext = OOX[doc.kind]; if (!ext) return;
    if (!confirm('El documento se abrirá con ONLYOFFICE (formato exacto de Word, Excel o PowerPoint). La versión actual queda guardada en el historial. ¿Continuar?')) return;
    setBusy('Preparando el documento para ONLYOFFICE…'); setNote(null);
    try { await save.flush(); await uploadToOnlyoffice(await exportAs(ext), `${title}.${ext}`, { id: doc.id }); window.location.reload(); }
    catch (e) { setNote(`No se pudo abrir en ONLYOFFICE: ${(e as Error).message}`); setBusy(null); }
  };
  const tab = (k: 'share' | 'versions' | 'comments', label: string, testid: string) => (
    <button className={`btn-sm ${panel === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPanel(panel === k ? null : k)} data-testid={testid}>{label}</button>);
  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 mb-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8 print:hidden" data-testid="barra-oficina">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/oficina" className={`grid h-9 w-9 place-items-center rounded-lg text-lg text-white ${APP[2]}`} title="Volver a SEMATEC Oficina">{APP[0]}</Link>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!doc.canEdit} className="min-w-0 max-w-md flex-1 rounded-lg border border-transparent px-2 py-1 text-lg font-semibold hover:border-slate-200 focus:border-brand-500 focus:outline-none" aria-label="Nombre del documento" data-testid="titulo-documento" />
          <span className={`text-xs ${save.status === 'error' || save.status === 'conflict' ? 'text-red-600' : 'text-slate-500'}`} title={save.msg ?? ''} data-testid="estado-guardado">{doc.canEdit ? STATUS[save.status] : doc.access === 'commenter' ? '💬 Puede comentar' : '👁 Solo lectura'}</span>
          {save.present.length > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800" title={save.present.join(', ')} data-testid="presencia">
            🟢 También aquí: {save.present.slice(0, 3).join(', ')}{save.present.length > 3 ? ` y ${save.present.length - 3} más` : ''}</span>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {extra}
            {doc.onlyoffice && doc.canEdit && OOX[doc.kind] && <button className="btn-secondary btn-sm" onClick={toOnlyoffice} disabled={!!busy} title="Editar con el formato exacto de Office (ONLYOFFICE)" data-testid="abrir-onlyoffice">🧩 Abrir en ONLYOFFICE</button>}
            {tab('comments', '💬 Comentarios', 'oficina-comentarios')}
            {tab('versions', '🕘 Versiones', 'oficina-versiones')}
            <span className="relative">
              <button className="btn-primary btn-sm" onClick={() => setOpen(open === 'download' ? null : 'download')} disabled={!!busy} data-testid="oficina-descargar">⬇ Descargar ▾</button>
              {open === 'download' && (
                <span className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-2xl" data-testid="oficina-formatos">
                  {formats.map((f) => <button key={f.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100" onClick={() => download(f)} data-testid={`exportar-${f.id}`}>{f.label}{f.hint && <span className="block text-xs text-slate-500">{f.hint}</span>}</button>)}
                  <span className="my-1 block border-t border-slate-100" />
                  <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100" onClick={toFiles} data-testid="guardar-en-archivos">💾 Guardar una copia en Mis archivos</button>
                </span>)}
            </span>
            {doc.isOwner && tab('share', '👥 Compartir', 'oficina-compartir')}
          </span>
        </div>
        {(busy || note) && <p className="mt-1 text-xs text-slate-600" data-testid="oficina-aviso">{busy ?? note}</p>}
        {save.conflict && (
          <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="aviso-conflicto">
            <b>⚠ {save.conflict.by} guardó cambios en este documento ({fmtDateTime(save.conflict.at)}) mientras usted editaba.</b> Sus cambios siguen en esta pantalla y no se han perdido. Elija qué hacer:
            <span className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" onClick={save.saveAsCopy} data-testid="conflicto-copia">Guardar mi versión como copia</button>
              <button className="btn-secondary btn-sm" onClick={() => { if (confirm('Sus cambios reemplazarán los de la otra persona (quedarán en el historial de versiones). ¿Continuar?')) save.overwrite(); }} data-testid="conflicto-reemplazar">Reemplazar con mi versión</button>
              <button className="btn-secondary btn-sm" onClick={() => { if (confirm('Se descartarán sus cambios no guardados. ¿Continuar?')) save.discard(); }} data-testid="conflicto-recargar">Descartar mis cambios y ver la versión nueva</button>
            </span>
          </div>)}
        {!save.conflict && save.remote && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-2 text-sm text-sky-900" data-testid="aviso-cambio-remoto">
            🔄 {save.remote} actualizó este documento. <button className="btn-secondary btn-sm" onClick={() => window.location.reload()} data-testid="recargar-documento">Ver la versión nueva</button>
          </div>)}
      </div>
      {panel && (
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl print:hidden" data-testid={`panel-${panel}`}>
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="font-bold">{panel === 'share' ? '👥 Compartir' : panel === 'versions' ? '🕘 Historial de versiones' : '💬 Comentarios'}</h2>
            <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setPanel(null)} aria-label="Cerrar panel">✕</button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
            {panel === 'share' && <SharePanel doc={doc} />}
            {panel === 'versions' && <VersionsPanel doc={doc} save={save} />}
            {panel === 'comments' && <CommentsPanel doc={doc} />}
          </div>
        </aside>)}
    </>
  );
}

function SharePanel({ doc }: { doc: OfficeDocProps }) {
  const [shared, setShared] = useState(doc.shared);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listShares>>>([]);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [who, setWho] = useState<{ id: string; full_name: string } | null>(null);
  const [perm, setPerm] = useState('viewer');
  const [exp, setExp] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => listShares(doc.id).then(setRows), [doc.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => { if (q.trim().length >= 2) searchPeople(q).then(setPeople); else setPeople([]); }, 250); return () => clearTimeout(t); }, [q]);
  const org = async (v: string) => { const r = await shareOfficeDoc(doc.id, v); if (r.ok) setShared(v); setNote(r.ok ? '✓ Acceso de la institución actualizado.' : r.error ?? 'Error'); };
  const add = async () => {
    if (!who) return;
    const r = await shareWith(doc.id, who.id, perm, exp || null);
    setNote(r.ok ? `✓ Compartido con ${who.full_name}.` : r.error ?? 'Error');
    if (r.ok) { setWho(null); setQ(''); setExp(''); load(); }
  };
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 font-semibold">Personas con acceso</h3>
        <div className="relative">
          <input className="input" placeholder="Buscar por nombre o correo…" value={who ? who.full_name : q} onChange={(e) => { setWho(null); setQ(e.target.value); }} data-testid="compartir-buscar" />
          {!who && people.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {people.map((p) => <li key={p.id}><button className="block w-full px-3 py-2 text-left hover:bg-slate-100" onClick={() => { setWho(p); setPeople([]); }} data-testid="compartir-persona">{p.full_name}<span className="block text-xs text-slate-500">{p.email}</span></button></li>)}
            </ul>)}
        </div>
        {who && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs">Permiso<select className="input mt-1" value={perm} onChange={(e) => setPerm(e.target.value)} data-testid="compartir-permiso">{PERM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="text-xs">Caduca (opcional)<input type="date" className="input mt-1" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="compartir-caduca" /></label>
            <button className="btn-primary btn-sm col-span-2" onClick={add} data-testid="compartir-agregar">Compartir con {who.full_name}</button>
          </div>)}
        <ul className="mt-3 divide-y divide-slate-100" data-testid="lista-accesos">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-slate-500">{PERM.find((p) => p[0] === s.permission)?.[1]}{s.expires_at ? ` · hasta ${fmtDateTime(s.expires_at)}` : ''}{s.expires_at && Date.parse(s.expires_at) < Date.now() ? ' (caducado)' : ''}</span></span>
              <button className="text-xs text-red-600 hover:underline" onClick={async () => { await revokeShare(s.id); load(); }} data-testid="compartir-quitar">Quitar</button>
            </li>))}
          {!rows.length && <li className="py-2 text-xs text-slate-500">Aún no lo comparte con personas específicas.</li>}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">Toda la institución</h3>
        {[['private', '🔒 Solo las personas indicadas'], ['org_view', '👁 Toda la institución puede ver'], ['org_edit', '✏ Toda la institución puede editar']].map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 py-1"><input type="radio" name="org-share" checked={shared === v} onChange={() => org(v)} data-testid={`compartir-org-${v}`} />{l}</label>))}
      </section>
      {note && <p className="rounded-lg bg-slate-50 p-2 text-xs" data-testid="compartir-aviso">{note}</p>}
    </div>
  );
}

function VersionsPanel({ doc, save }: { doc: OfficeDocProps; save?: Saver }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listVersions>>>([]);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => listVersions(doc.id).then(setRows), [doc.id]);
  useEffect(() => { load(); }, [load]);
  const keep = async () => { await save?.flush(); const r = await saveVersion(doc.id, label); setNote(r.ok ? '✓ Versión guardada.' : r.error ?? 'Error'); if (r.ok) { setLabel(''); load(); } };
  const restore = async (vid: string) => {
    if (!confirm('¿Restaurar esta versión? La versión actual se guardará primero en el historial.')) return;
    await save?.flush();
    const r = await restoreVersion(vid);
    if (r.ok) window.location.reload(); else setNote(r.error ?? 'No se pudo restaurar');
  };
  return (
    <div className="space-y-4">
      {doc.canEdit && (
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Nombre de la versión (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} data-testid="version-nombre" />
          <button className="btn-primary btn-sm" onClick={keep} data-testid="guardar-version">Guardar versión</button>
        </div>)}
      <p className="text-xs text-slate-500">Se guarda una versión automática cada 10 minutos de edición.</p>
      {note && <p className="rounded-lg bg-slate-50 p-2 text-xs" data-testid="version-aviso">{note}</p>}
      <ul className="divide-y divide-slate-100" data-testid="lista-versiones">
        {rows.map((v) => (
          <li key={v.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{v.label ?? 'Versión automática'}</span>
              <span className="block text-xs text-slate-500">{fmtDateTime(v.at)} · {v.by} · «{v.title}»</span></span>
            {doc.canEdit && <button className="text-xs text-brand-700 hover:underline" onClick={() => restore(v.id)} data-testid="restaurar-version">Restaurar</button>}
          </li>))}
        {!rows.length && <li className="py-2 text-xs text-slate-500">Aún no hay versiones guardadas.</li>}
      </ul>
    </div>
  );
}

function CommentsPanel({ doc }: { doc: OfficeDocProps }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listComments>>>([]);
  const [body, setBody] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => listComments(doc.id).then(setRows), [doc.id]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const s = window.getSelection()?.toString().trim(); if (s) setQuote(s.slice(0, 500)); }, []);
  const canComment = doc.access !== 'viewer';
  const send = async () => {
    const r = await addComment(doc.id, body, quote);
    setNote(r.ok ? null : r.error ?? 'Error');
    if (r.ok) { setBody(''); setQuote(null); load(); }
  };
  const visible = rows.filter((c) => showResolved || !c.resolved);
  return (
    <div className="space-y-4">
      {canComment ? (
        <div className="space-y-2">
          {quote && <p className="rounded border-l-4 border-amber-400 bg-amber-50 px-2 py-1 text-xs italic">«{quote}» <button className="ml-1 not-italic text-slate-500" onClick={() => setQuote(null)}>✕</button></p>}
          <textarea className="input" rows={3} placeholder="Escriba un comentario… (seleccione texto antes de abrir el panel para citarlo)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="comentario-texto" />
          <button className="btn-primary btn-sm" onClick={send} disabled={!body.trim()} data-testid="comentario-enviar">Comentar</button>
        </div>) : <p className="text-xs text-slate-500">Tiene acceso de solo lectura: puede ver los comentarios, pero no agregar.</p>}
      {note && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{note}</p>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Mostrar resueltos</label>
      <ul className="space-y-3" data-testid="lista-comentarios">
        {visible.map((c) => (
          <li key={c.id} className={`rounded-lg border p-3 ${c.resolved ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200'}`} data-testid="comentario">
            <p className="text-xs text-slate-500"><b className="text-slate-700">{c.by}</b> · {fmtDateTime(c.at)}{c.resolved ? ' · ✓ resuelto' : ''}</p>
            {c.quote && <p className="mt-1 border-l-4 border-amber-300 pl-2 text-xs italic text-slate-600">«{c.quote}»</p>}
            <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            <p className="mt-2 flex gap-3 text-xs">
              {(doc.canEdit || c.mine) && <button className="text-brand-700 hover:underline" onClick={async () => { await resolveComment(c.id, !c.resolved); load(); }} data-testid="comentario-resolver">{c.resolved ? 'Reabrir' : 'Resolver'}</button>}
              {(c.mine || doc.isOwner) && <button className="text-red-600 hover:underline" onClick={async () => { await deleteComment(c.id); load(); }} data-testid="comentario-eliminar">Eliminar</button>}
            </p>
          </li>))}
        {!visible.length && <li className="text-xs text-slate-500">No hay comentarios.</li>}
      </ul>
    </div>
  );
}

export { ACCESS_LABEL };

/** Botones y panel lateral de Compartir y Versiones (para el editor ONLYOFFICE). */
export function DocPanels({ doc }: { doc: OfficeDocProps }) {
  const [panel, setPanel] = useState<null | 'share' | 'versions'>(null);
  return (
    <>
      <button className={`btn-sm ${panel === 'versions' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPanel(panel === 'versions' ? null : 'versions')} data-testid="oficina-versiones">🕘 Versiones</button>
      {doc.isOwner && <button className={`btn-sm ${panel === 'share' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPanel(panel === 'share' ? null : 'share')} data-testid="oficina-compartir">👥 Compartir</button>}
      {panel && (
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl" data-testid={`panel-${panel}`}>
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="font-bold">{panel === 'share' ? '👥 Compartir' : '🕘 Historial de versiones'}</h2>
            <button className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setPanel(null)} aria-label="Cerrar panel">✕</button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">{panel === 'share' ? <SharePanel doc={doc} /> : <VersionsPanel doc={doc} />}</div>
        </aside>)}
    </>
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
