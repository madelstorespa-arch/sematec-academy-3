import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { OfficeEditor } from '@/components/office/editor';

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
  const { data: d } = await ctx.supabase.from('office_documents').select('id, kind, title, content, shared, owner_id, deleted_at, updated_at').eq('id', id).maybeSingle();
  if (!d || d.deleted_at) notFound();
  const isOwner = d.owner_id === ctx.user.id;
  return <OfficeEditor doc={{ id: d.id, kind: d.kind, title: d.title, content: (d.content ?? {}) as Record<string, unknown>, canEdit: isOwner || d.shared === 'org_edit', isOwner, shared: d.shared, orgId, updatedAt: d.updated_at }} />;
}
