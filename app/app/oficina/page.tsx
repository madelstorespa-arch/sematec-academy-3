import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { OfficeImport } from '@/components/office/import';
import {
  createFolder, deleteFolder, duplicateOfficeDoc, moveOfficeDoc, newOfficeDoc, purgeExpiredTrash, purgeOfficeDoc, renameFolder, renameOfficeDoc, starOfficeDoc, trashOfficeDoc,
} from './actions';
import { OFFICE_QUOTA_BYTES, TRASH_DAYS } from '@/lib/office/limits';
import { onlyofficeEnabled } from '@/lib/onlyoffice';

export const metadata = { title: 'Oficina' };
export const dynamic = 'force-dynamic';

const APPS = [
  { kind: 'doc', icon: 'W', name: 'Documento', sub: 'Como Word: cartas, informes, trabajos', color: 'from-blue-700 to-blue-500',
    templates: [['blanco', 'En blanco'], ['carta', 'Carta formal'], ['informe', 'Informe'], ['cv', 'Currículum'], ['guia', 'Guía de estudio']] },
  { kind: 'sheet', icon: 'X', name: 'Hoja de cálculo', sub: 'Como Excel: fórmulas, tablas, cálculos', color: 'from-emerald-700 to-emerald-500',
    templates: [['blanco', 'En blanco'], ['presupuesto', 'Presupuesto'], ['notas', 'Planilla de notas'], ['asistencia', 'Control de asistencia'], ['inventario', 'Inventario']] },
  { kind: 'slides', icon: 'P', name: 'Presentación', sub: 'Como PowerPoint: diapositivas para clases', color: 'from-orange-600 to-red-500',
    templates: [['claro', 'Claro'], ['azul', 'Azul institucional'], ['oscuro', 'Oscuro'], ['verde', 'Verde'], ['atardecer', 'Atardecer']] },
  { kind: 'pub', icon: 'Pb', name: 'Publicación', sub: 'Como Publisher: afiches, diplomas, tarjetas', color: 'from-teal-700 to-cyan-500',
    templates: [['afiche', 'Afiche'], ['diploma', 'Certificado / diploma'], ['tarjeta', 'Tarjeta de presentación'], ['invitacion', 'Invitación'], ['calendario', 'Calendario'], ['triptico', 'Tríptico'], ['folleto', 'Folleto'], ['blanco', 'Página en blanco']] },
] as const;
const ICON: Record<string, string> = { doc: '📄', sheet: '📊', slides: '📽', pub: '📰' };
const VIEWS = [['inicio', '🏠', 'Inicio'], ['mios', '📁', 'Mis documentos'], ['compartidos', '👥', 'Compartidos conmigo'], ['recientes', '🕘', 'Recientes'], ['favoritos', '⭐', 'Favoritos'], ['papelera', '🗑', 'Papelera']] as const;
type View = (typeof VIEWS)[number][0];
type Doc = { id: string; kind: string; title: string; shared: string; owner_id: string; folder_id: string | null; updated_at: string; deleted_at: string | null; owner: string; starred: boolean; opened_at: string | null };
type Folder = { id: string; name: string; parent_id: string | null };
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string; carpeta?: string; q?: string; orden?: string; error?: string; papelera?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const view: View = sp.papelera ? 'papelera' : (VIEWS.find((x) => x[0] === sp.v)?.[0] ?? 'inicio');
  const q = (sp.q ?? '').trim().slice(0, 80);
  const folderId = /^[0-9a-f-]{36}$/i.test(sp.carpeta ?? '') ? sp.carpeta! : null;
  const order = sp.orden === 'nombre' ? 'nombre' : 'fecha';

  // Retención de la papelera: lo que lleva más de TRASH_DAYS días se elimina definitivamente
  await purgeExpiredTrash(TRASH_DAYS);

  let dq = ctx.supabase.from('office_documents').select('id, kind, title, shared, owner_id, folder_id, updated_at, deleted_at, profiles!office_documents_owner_id_fkey(full_name)').order('updated_at', { ascending: false }).limit(500);
  dq = view === 'papelera' ? dq.eq('owner_id', ctx.user.id).not('deleted_at', 'is', null) : dq.is('deleted_at', null);
  if (q) dq = dq.ilike('title', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const [{ data: rows }, { data: folderRows }, { data: marks }, { data: usage }] = await Promise.all([
    dq,
    ctx.supabase.from('office_folders').select('id, name, parent_id').eq('owner_id', ctx.user.id).order('name'),
    ctx.supabase.from('office_marks').select('document_id, starred, opened_at').eq('user_id', ctx.user.id),
    ctx.supabase.rpc('office_usage'),
  ]);
  const mk = new Map((marks ?? []).map((m) => [m.document_id, m]));
  const docs: Doc[] = (rows ?? []).map((d) => ({
    id: d.id, kind: d.kind, title: d.title, shared: d.shared, owner_id: d.owner_id, folder_id: d.folder_id, updated_at: d.updated_at, deleted_at: d.deleted_at,
    owner: (d.profiles as { full_name?: string } | null)?.full_name ?? '', starred: !!mk.get(d.id)?.starred, opened_at: mk.get(d.id)?.opened_at ?? null,
  }));
  const folders = (folderRows ?? []) as Folder[];
  const folder = folderId ? folders.find((f) => f.id === folderId) ?? null : null;
  const crumbs: Folder[] = [];
  for (let f = folder; f; f = f.parent_id ? folders.find((x) => x.id === f!.parent_id) ?? null : null) { crumbs.unshift(f); if (crumbs.length > 20) break; }

  let list: Doc[] = docs;
  let subfolders: Folder[] = [];
  if (view === 'mios') {
    list = docs.filter((d) => d.owner_id === ctx.user.id && (q ? true : (d.folder_id ?? null) === folderId));
    subfolders = q ? folders.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())) : folders.filter((f) => (f.parent_id ?? null) === folderId);
  } else if (view === 'compartidos') list = docs.filter((d) => d.owner_id !== ctx.user.id);
  else if (view === 'favoritos') list = docs.filter((d) => d.starred);
  else if (view === 'recientes' || view === 'inicio') list = docs.filter((d) => d.opened_at).sort((a, b) => Date.parse(b.opened_at!) - Date.parse(a.opened_at!)).slice(0, view === 'inicio' && !q ? 8 : 60);
  if (view === 'inicio' && (q || !list.length)) list = q ? docs : docs.slice(0, 8);
  if (order === 'nombre') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'es'));

  const used = Number((usage as { office?: number } | null)?.office ?? 0) + Number((usage as { files?: number } | null)?.files ?? 0);
  const pct = Math.min(100, Math.round((used / OFFICE_QUOTA_BYTES) * 100));
  const href = (p: Record<string, string | null | undefined>) => {
    const u = new URLSearchParams();
    const all = { v: view, carpeta: folderId, q, orden: order === 'fecha' ? null : order, ...p };
    Object.entries(all).forEach(([k, v]) => { if (v && !(k === 'v' && v === 'inicio')) u.set(k, v); });
    return `/app/oficina${u.size ? `?${u}` : ''}`;
  };
  const back = href({});
  const trash = view === 'papelera';

  const item = (d: Doc) => {
    const mine = d.owner_id === ctx.user.id;
    return (
      <li key={d.id} className="card flex items-center gap-3 p-4" data-testid="doc-oficina">
        <span className="text-3xl" aria-hidden>{ICON[d.kind]}</span>
        <span className="min-w-0 flex-1">
          {trash ? <span className="block truncate font-semibold">{d.title}</span>
            : <Link className="block truncate font-semibold hover:text-brand-700" href={`/app/oficina/${d.id}`}>{d.title}</Link>}
          <span className="block text-xs text-slate-500">
            {trash && d.deleted_at ? `En la papelera desde ${fmtDateTime(d.deleted_at)}` : fmtDateTime(d.updated_at)}
            {!mine ? ` · de ${d.owner}` : d.shared !== 'private' ? ' · compartido' : ''}
            {view === 'mios' && q && d.folder_id ? ` · 📁 ${folders.find((f) => f.id === d.folder_id)?.name ?? ''}` : ''}
          </span>
        </span>
        {!trash && (
          <form action={starOfficeDoc}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="on" value={d.starred ? '0' : '1'} />
            <button className={`text-lg ${d.starred ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`} title={d.starred ? 'Quitar de favoritos' : 'Agregar a favoritos'} data-testid="favorito">{d.starred ? '★' : '☆'}</button></form>)}
        <details className="relative text-sm"><summary className="cursor-pointer list-none rounded px-2 py-1 hover:bg-slate-100" aria-label="Opciones" data-testid="doc-opciones">⋯</summary>
          <div className="absolute right-0 z-20 mt-1 w-64 space-y-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            {!trash && <form action={duplicateOfficeDoc}><input type="hidden" name="id" value={d.id} /><button className="w-full rounded px-3 py-1.5 text-left hover:bg-slate-100" data-testid="doc-duplicar">📑 Hacer una copia</button></form>}
            {!trash && mine && (
              <form action={renameOfficeDoc} className="flex gap-1"><input type="hidden" name="id" value={d.id} />
                <input name="title" defaultValue={d.title} className="input h-8 flex-1 text-xs" aria-label="Nuevo nombre" data-testid="doc-nuevo-nombre" /><button className="btn-secondary btn-sm" data-testid="doc-renombrar">Renombrar</button></form>)}
            {!trash && mine && (
              <form action={moveOfficeDoc} className="flex gap-1"><input type="hidden" name="id" value={d.id} />
                <select name="folder" defaultValue={d.folder_id ?? ''} className="input h-8 flex-1 text-xs" aria-label="Mover a carpeta" data-testid="doc-carpeta">
                  <option value="">📁 Mis documentos (raíz)</option>{folders.map((f) => <option key={f.id} value={f.id}>📁 {f.name}</option>)}</select>
                <button className="btn-secondary btn-sm" data-testid="doc-mover">Mover</button></form>)}
            {mine && <form action={trashOfficeDoc}><input type="hidden" name="id" value={d.id} />{trash && <input type="hidden" name="restore" value="1" />}
              <button className={`w-full rounded px-3 py-1.5 text-left hover:bg-slate-100 ${trash ? '' : 'text-red-600'}`} data-testid={trash ? 'doc-restaurar' : 'doc-papelera'}>{trash ? '↩ Restaurar' : '🗑 Enviar a la papelera'}</button></form>}
            {trash && mine && (
              <details><summary className="cursor-pointer list-none rounded px-3 py-1.5 text-red-700 hover:bg-red-50" data-testid="doc-borrar">✖ Eliminar definitivamente…</summary>
                <form action={purgeOfficeDoc} className="mt-1 rounded bg-red-50 p-2 text-xs text-red-800"><input type="hidden" name="id" value={d.id} />
                  No se puede deshacer: se borran el documento, sus versiones y comentarios.
                  <button className="mt-2 block w-full rounded bg-red-600 px-3 py-1.5 font-semibold text-white" data-testid="doc-borrar-confirmar">Sí, eliminar para siempre</button></form></details>)}
          </div></details>
      </li>);
  };

  return (
    <div>
      <PageHeader title="💼 SEMATEC Oficina" subtitle="Documentos, hojas de cálculo, presentaciones y publicaciones, con carpetas, versiones, comentarios y permisos. Abre y guarda archivos de Word, Excel y PowerPoint."
        actions={<OfficeImport folderId={view === 'mios' ? folderId : null} org={orgId} oo={onlyofficeEnabled()} />} />
      {sp.error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.error === 'cuota' ? 'Superó el espacio disponible: vacíe la papelera o elimine archivos para crear documentos nuevos.' : 'No se pudo crear el documento.'}</p>}
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4">
          <nav className="card p-2 text-sm" data-testid="drive-nav">
            {VIEWS.map(([v, i, l]) => (
              <Link key={v} href={v === 'inicio' ? '/app/oficina' : `/app/oficina?v=${v}`} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${view === v ? 'bg-brand-50 font-semibold text-brand-800' : 'hover:bg-slate-100'}`} data-testid={`drive-${v}`}>
                <span aria-hidden>{i}</span>{l}</Link>))}
          </nav>
          <div className="card p-4 text-xs" data-testid="cuota">
            <p className="mb-1 font-semibold text-slate-700">Espacio usado</p>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${pct >= 90 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
            <p className="mt-1 text-slate-500">{mb(used)} de {mb(OFFICE_QUOTA_BYTES)} ({pct}%) · Oficina + Mis archivos</p>
            {pct >= 80 && <p className="mt-1 font-semibold text-amber-700" data-testid="cuota-alerta">⚠ Queda poco espacio. Vacíe la papelera o elimine archivos que no use.</p>}
          </div>
        </aside>

        <section className="min-w-0">
          <form className="mb-4 flex flex-wrap gap-2" action="/app/oficina">
            {view !== 'inicio' && <input type="hidden" name="v" value={view} />}
            {folderId && !q && <input type="hidden" name="carpeta" value={folderId} />}
            <input name="q" defaultValue={q} placeholder={view === 'inicio' ? 'Buscar en todos mis documentos…' : 'Buscar en esta sección…'} className="input min-w-0 flex-1" data-testid="drive-buscar" />
            <select name="orden" defaultValue={order} className="input w-auto" aria-label="Ordenar"><option value="fecha">Más recientes</option><option value="nombre">Por nombre (A-Z)</option></select>
            <button className="btn-secondary">Buscar</button>
            {q && <Link href={href({ q: null })} className="btn-secondary">Limpiar</Link>}
          </form>

          {view === 'inicio' && !q && (
            <div className="mb-8 grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
              {APPS.map((a) => (
                <div key={a.kind} className="card overflow-hidden" data-testid={`app-${a.kind}`}>
                  <div className={`flex items-center gap-4 bg-gradient-to-br ${a.color} p-5 text-white`}>
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-2xl font-black">{a.icon}</span>
                    <span><span className="block text-lg font-bold">{a.name}</span><span className="block text-xs text-white/85">{a.sub}</span></span>
                  </div>
                  <div className="flex flex-wrap gap-2 p-4">
                    {a.templates.map(([t, l], i) => (
                      <form key={t} action={newOfficeDoc}>
                        <input type="hidden" name="kind" value={a.kind} /><input type="hidden" name="template" value={t} />
                        <input type="hidden" name="title" value={i === 0 ? '' : l} />
                        <button className={i === 0 ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} data-testid={`nuevo-${a.kind}-${t}`}>{i === 0 ? `+ ${l}` : l}</button>
                      </form>))}
                  </div>
                </div>))}
            </div>)}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold" data-testid="drive-titulo">
              {view === 'mios' ? (
                <span className="flex flex-wrap items-center gap-1">
                  <Link href="/app/oficina?v=mios" className="hover:text-brand-700">📁 Mis documentos</Link>
                  {crumbs.map((c) => <span key={c.id}> / <Link href={`/app/oficina?v=mios&carpeta=${c.id}`} className="hover:text-brand-700">{c.name}</Link></span>)}
                </span>) : q ? `Resultados para «${q}»` : view === 'inicio' ? 'Recientes' : VIEWS.find((x) => x[0] === view)?.[2]}
            </h2>
            {view === 'mios' && !q && (
              <span className="ml-auto flex flex-wrap gap-2">
                <details className="relative"><summary className="btn-secondary btn-sm cursor-pointer list-none" data-testid="nueva-carpeta">+ Nueva carpeta</summary>
                  <form action={createFolder} className="absolute right-0 z-20 mt-1 flex w-72 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                    <input type="hidden" name="parent" value={folderId ?? ''} /><input type="hidden" name="back" value={back} />
                    <input name="name" required maxLength={120} placeholder="Nombre de la carpeta" className="input h-9 flex-1" data-testid="carpeta-nombre" />
                    <button className="btn-primary btn-sm" data-testid="carpeta-crear">Crear</button></form></details>
                {folder && (
                  <details className="relative"><summary className="btn-secondary btn-sm cursor-pointer list-none" data-testid="carpeta-opciones">Carpeta ⋯</summary>
                    <div className="absolute right-0 z-20 mt-1 w-72 space-y-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                      <form action={renameFolder} className="flex gap-2"><input type="hidden" name="id" value={folder.id} />
                        <input name="name" defaultValue={folder.name} className="input h-9 flex-1" aria-label="Nuevo nombre de carpeta" /><button className="btn-secondary btn-sm">Renombrar</button></form>
                      <form action={deleteFolder}><input type="hidden" name="id" value={folder.id} />
                        <button className="w-full rounded px-3 py-1.5 text-left text-red-600 hover:bg-red-50" data-testid="carpeta-eliminar">Eliminar carpeta (los documentos pasan a la raíz)</button></form>
                    </div></details>)}
              </span>)}
            {trash && <p className="w-full text-xs text-slate-500">Los documentos se eliminan definitivamente a los {TRASH_DAYS} días en la papelera. Solo el dueño puede restaurarlos o eliminarlos.</p>}
          </div>

          {subfolders.length > 0 && (
            <ul className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="lista-carpetas">
              {subfolders.map((f) => (
                <li key={f.id}><Link href={`/app/oficina?v=mios&carpeta=${f.id}`} className="card flex items-center gap-3 p-3 font-medium hover:border-brand-300" data-testid="carpeta">
                  <span className="text-2xl" aria-hidden>📁</span><span className="truncate">{f.name}</span></Link></li>))}
            </ul>)}
          {list.length ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-oficina">{list.map(item)}</ul>
            : !subfolders.length && <Card><Empty>{q ? 'No se encontraron documentos.' : trash ? 'La papelera está vacía.' : view === 'compartidos' ? 'Nadie ha compartido documentos con usted todavía.' : view === 'favoritos' ? 'Marque documentos con ☆ para verlos aquí.' : view === 'mios' && folderId ? 'Esta carpeta está vacía.' : 'Aún no tiene documentos. Cree uno o abra un archivo de su equipo.'}</Empty></Card>}
        </section>
      </div>
    </div>
  );
}
