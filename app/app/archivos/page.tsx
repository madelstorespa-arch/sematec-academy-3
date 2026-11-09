import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Tabs } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { FileUploader } from '@/components/file-uploader';
import { fmtDateTime } from '@/lib/format';
import { fileKind, fmtSize } from '@/lib/user-files';
import { deleteFile, restoreFile, purgeFile } from './actions';

export const dynamic = 'force-dynamic';

const VIS: Record<string, string> = { private: '🔒 Solo yo', section: '👥 Curso', staff: '🏢 Personal', org: '🌐 Institución' };
type F = { id: string; name: string; description: string | null; mime_type: string; size_bytes: number; visibility: string; created_at: string;
  deleted_at: string | null; owner_id: string; deleted_by: string | null; owner: { full_name: string } | null; remover: { full_name: string } | null;
  sections: { code: string; courses: { name: string } | null } | null };

export default async function ArchivosPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = 'mios' } = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const sel = 'id, name, description, mime_type, size_bytes, visibility, created_at, deleted_at, owner_id, deleted_by, owner:profiles!user_files_owner_id_fkey(full_name), remover:profiles!user_files_deleted_by_fkey(full_name), sections(code, courses(name))';
  let q = ctx.supabase.from('user_files').select(sel).eq('organization_id', orgId).order('created_at', { ascending: false }).limit(300);
  if (t === 'mios') q = q.eq('owner_id', ctx.user.id).is('deleted_at', null);
  else if (t === 'compartidos') q = q.neq('owner_id', ctx.user.id).is('deleted_at', null);
  else if (t === 'eliminados' && ctx.isOwner) q = q.not('deleted_at', 'is', null);
  else if (t === 'todos' && ctx.isOwner) q = q.is('deleted_at', null);
  const { data, error } = await q;
  const files = (data ?? []) as unknown as F[];
  // Cursos del usuario (para compartir con su curso)
  const secs: { value: string; label: string }[] = [];
  if (ctx.teacherId) {
    const { data: s } = await ctx.supabase.from('sections').select('id, code, courses(name)').eq('teacher_id', ctx.teacherId).eq('status', 'active');
    for (const x of (s ?? []) as any[]) secs.push({ value: x.id, label: `${x.courses?.name ?? ''} (${x.code})` });
  }
  if (ctx.studentId) {
    const { data: s } = await ctx.supabase.from('section_enrollments').select('sections(id, code, courses(name))').eq('student_id', ctx.studentId).neq('status', 'dropped');
    for (const x of (s ?? []) as any[]) if (x.sections) secs.push({ value: x.sections.id, label: `${x.sections.courses?.name ?? ''} (${x.sections.code})` });
  }
  const tabs = [['mios', 'Mis archivos'], ['compartidos', 'Compartidos conmigo'], ...(ctx.isOwner ? [['todos', 'Todos'], ['eliminados', '🗂 Historial de eliminados']] : [])]
    .map(([key, label]) => ({ key, label, href: `/app/archivos?t=${key}` }));

  return (
    <div>
      <PageHeader title="📁 Archivos" subtitle="Suba fotos, videos, audio y documentos. Quedan guardados en el almacenamiento privado de la institución." />
      <Card title="Subir archivos" className="mb-6"><FileUploader org={orgId} sections={secs} /></Card>
      <Tabs items={tabs} current={t} />
      {t === 'eliminados' && <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Aquí está todo lo que los usuarios eliminaron. Puede <b>restaurarlo</b> (vuelve a su dueño) o <b>eliminarlo definitivamente</b> (se borra el archivo; queda solo el registro en la Auditoría).</p>}
      {error ? <Card><p className="text-sm text-red-700">{error.message}</p></Card> : files.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((f) => (
            <div key={f.id} className="card overflow-hidden" data-testid="archivo">
              {f.mime_type.startsWith('image/') && !f.deleted_at ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={`/app/archivos/ver/${f.id}`} target="_blank" rel="noopener noreferrer"><img src={`/app/archivos/ver/${f.id}`} alt={f.name} className="h-40 w-full bg-slate-100 object-cover" loading="lazy" /></a>
              ) : f.mime_type.startsWith('video/') && !f.deleted_at ? (
                <video src={`/app/archivos/ver/${f.id}`} controls preload="metadata" className="h-40 w-full bg-black" />
              ) : <div className="flex h-24 items-center justify-center bg-slate-50 text-4xl">{fileKind(f.mime_type)}</div>}
              <div className="space-y-1 p-4 text-sm">
                <p className="break-words font-semibold">{f.name}</p>
                {f.description && <p className="text-xs text-slate-600">{f.description}</p>}
                <p className="text-xs text-slate-500">{fmtSize(f.size_bytes)} · {fmtDateTime(f.created_at)}{f.owner_id !== ctx.user.id && ` · ${f.owner?.full_name ?? ''}`}</p>
                <p className="flex flex-wrap gap-1"><Badge color="blue">{VIS[f.visibility]}{f.sections ? ` ${f.sections.courses?.name ?? ''}` : ''}</Badge>
                  {f.deleted_at && <Badge color="red">Eliminado {fmtDateTime(f.deleted_at)}{f.remover ? ` por ${f.remover.full_name}` : ''}</Badge>}</p>
                <div className="flex flex-wrap gap-1 pt-2">
                  <a className="btn-secondary btn-sm" href={`/app/archivos/ver/${f.id}?descargar=1`}>⬇ Descargar</a>
                  {!f.deleted_at && (f.owner_id === ctx.user.id || ctx.isOwner) && (
                    <ActionForm action={deleteFile} inline submitLabel="🗑 Eliminar" submitClass="btn-secondary btn-sm text-red-700" confirm={`¿Eliminar «${f.name}»?`}>
                      <input type="hidden" name="id" value={f.id} /></ActionForm>)}
                  {f.deleted_at && ctx.isOwner && <>
                    <ActionForm action={restoreFile} inline submitLabel="♻ Restaurar" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={f.id} /></ActionForm>
                    <ActionForm action={purgeFile} inline submitLabel="✖ Eliminar definitivamente" submitClass="btn-secondary btn-sm text-red-700"
                      confirm={`¿Eliminar DEFINITIVAMENTE «${f.name}»? No se puede recuperar.`}><input type="hidden" name="id" value={f.id} /></ActionForm>
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>{t === 'eliminados' ? 'No hay archivos eliminados.' : t === 'compartidos' ? 'Nadie ha compartido archivos con usted todavía.' : 'Aún no hay archivos.'}</Empty>}
    </div>
  );
}
