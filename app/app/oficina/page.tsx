import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { OfficeImport } from '@/components/office/import';
import { duplicateOfficeDoc, newOfficeDoc, trashOfficeDoc } from './actions';

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
    templates: [['afiche', 'Afiche'], ['diploma', 'Certificado / diploma'], ['tarjeta', 'Tarjeta de presentación'], ['invitacion', 'Invitación'], ['blanco', 'Página en blanco']] },
] as const;
const ICON: Record<string, string> = { doc: '📄', sheet: '📊', slides: '📽', pub: '📰' };

export default async function Page({ searchParams }: { searchParams: Promise<{ papelera?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  requireOrg(ctx);
  const trash = !!sp.papelera;
  let q = ctx.supabase.from('office_documents').select('id, kind, title, shared, owner_id, updated_at, deleted_at, profiles!office_documents_owner_id_fkey(full_name)').order('updated_at', { ascending: false }).limit(200);
  q = trash ? q.eq('owner_id', ctx.user.id).not('deleted_at', 'is', null) : q.is('deleted_at', null);
  const { data: docs } = await q;
  const mine = (docs ?? []).filter((d: any) => d.owner_id === ctx.user.id);
  const shared = (docs ?? []).filter((d: any) => d.owner_id !== ctx.user.id);
  const list = (rows: any[]) => rows.length ? (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-oficina">{rows.map((d) => (
      <li key={d.id} className="card flex items-center gap-3 p-4">
        <span className="text-3xl" aria-hidden>{ICON[d.kind]}</span>
        <span className="min-w-0 flex-1">
          <Link className="block truncate font-semibold hover:text-brand-700" href={`/app/oficina/${d.id}`}>{d.title}</Link>
          <span className="block text-xs text-slate-500">{fmtDateTime(d.updated_at)}{d.owner_id !== ctx.user.id ? ` · de ${d.profiles?.full_name ?? ''}` : d.shared !== 'private' ? ' · compartido' : ''}</span>
        </span>
        {d.owner_id === ctx.user.id && (
          <details className="relative text-sm"><summary className="cursor-pointer list-none rounded px-2 py-1 hover:bg-slate-100" aria-label="Opciones">⋯</summary>
            <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {!trash && <form action={duplicateOfficeDoc}><input type="hidden" name="id" value={d.id} /><button className="w-full rounded px-3 py-1.5 text-left hover:bg-slate-100">Duplicar</button></form>}
              <form action={trashOfficeDoc}><input type="hidden" name="id" value={d.id} />{trash && <input type="hidden" name="restore" value="1" />}
                <button className={`w-full rounded px-3 py-1.5 text-left hover:bg-slate-100 ${trash ? '' : 'text-red-600'}`}>{trash ? 'Restaurar' : 'Enviar a la papelera'}</button></form>
            </div></details>)}
      </li>))}</ul>) : null;
  return (
    <div>
      <PageHeader title="💼 SEMATEC Oficina" subtitle="Documentos, hojas de cálculo, presentaciones y publicaciones sin salir de la plataforma. Abre y guarda archivos de Word, Excel y PowerPoint."
        actions={<OfficeImport />} />
      {sp.error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">No se pudo crear el documento.</p>}
      {!trash && (
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
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{trash ? '🗑 Papelera' : 'Mis documentos'}</h2>
        <Link className="link text-sm" href={trash ? '/app/oficina' : '/app/oficina?papelera=1'}>{trash ? '← Volver' : 'Ver papelera'}</Link>
      </div>
      {list(mine) ?? <Card><Empty>{trash ? 'La papelera está vacía.' : 'Aún no tiene documentos. Cree uno arriba o abra un archivo de su equipo.'}</Empty></Card>}
      {!trash && shared.length > 0 && <><h2 className="mb-3 mt-8 text-lg font-bold">Compartidos conmigo</h2>{list(shared)}</>}
    </div>
  );
}
