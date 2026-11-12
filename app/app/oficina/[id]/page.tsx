import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { env } from '@/lib/env';
import { OfficeEditor } from '@/components/office/editor';
import { OnlyofficeEditor } from '@/components/office/onlyoffice-editor';
import { DocPanels, type Access, type OfficeDocProps } from '@/components/office/shell';
import { appBaseUrl, editorConfig, isOO, onlyofficeUrl } from '@/lib/onlyoffice';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: 'Oficina' };
  const ctx = await getContext();
  const { data } = await ctx.supabase.from('office_documents').select('title').eq('id', id).maybeSingle();
  return { title: data?.title ?? 'Oficina' };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const [{ data: d }, { data: accessRaw }] = await Promise.all([
    ctx.supabase.from('office_documents').select('id, kind, title, content, shared, owner_id, deleted_at, updated_at, version').eq('id', id).maybeSingle(),
    ctx.supabase.rpc('office_my_access', { p_doc: id }),
  ]);
  const access = accessRaw as Access | null;
  if (!access) { await ctx.supabase.rpc('office_log_denied', { p_doc: id }); notFound(); }
  if (!d || d.deleted_at) notFound();
  const isOwner = access === 'owner';
  const server = onlyofficeUrl();
  const doc: OfficeDocProps = { id: d.id, kind: d.kind, title: d.title, content: (d.content ?? {}) as Record<string, unknown>, canEdit: isOwner || access === 'editor', isOwner, access, version: d.version ?? 1, shared: d.shared, orgId, updatedAt: d.updated_at, onlyoffice: !!server && d.kind !== 'pub' };

  if (isOO(d.content)) {
    if (server) {
      const { data: me } = await ctx.supabase.from('profiles').select('full_name').eq('id', ctx.user.id).maybeSingle();
      const config = editorConfig({ base: appBaseUrl(env.siteUrl()), id: d.id, title: d.title, content: d.content, access, user: { id: ctx.user.id, name: me?.full_name ?? ctx.user.email ?? 'Usuario' } });
      return <OnlyofficeEditor server={server} config={config} title={d.title} kind={d.kind} toolbar={<DocPanels doc={doc} />} />;
    }
    // ONLYOFFICE no está activo: se ofrece descargar el archivo original
    const { data: link } = await createAdminClient().storage.from('user-files').createSignedUrl(d.content.oo.path, 300, { download: `${d.title}.${d.content.oo.ext}` });
    return (
      <div className="card mx-auto mt-10 max-w-xl p-6 text-sm" data-testid="onlyoffice-inactivo">
        <h1 className="mb-2 text-lg font-bold">📎 {d.title}.{d.content.oo.ext}</h1>
        <p className="text-slate-600">Este documento se edita con ONLYOFFICE, que no está activo en este momento. Puede descargarlo y abrirlo con Word, Excel o PowerPoint, o pedir a la administración que active el servidor ONLYOFFICE.</p>
        {link?.signedUrl && <a className="btn-primary mt-4 inline-block" href={link.signedUrl} data-testid="descargar-original">⬇ Descargar archivo</a>}
      </div>);
  }
  return <OfficeEditor doc={doc} />;
}
