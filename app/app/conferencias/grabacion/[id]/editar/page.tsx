import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { VideoEditor } from '@/components/video-editor';

export const dynamic = 'force-dynamic';

export default async function EditarGrabacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const { data: r } = await ctx.supabase.from('conference_recordings').select('id, session_id, filename, group_id, conference_sessions(title)').eq('id', id).maybeSingle();
  if (!r) notFound();
  const { data: allowed } = await ctx.supabase.rpc('can_manage_recordings', { p_session: r.session_id });
  if (!allowed) redirect(`/app/conferencias/grabacion/${id}/ver`);
  const { data: parts } = r.group_id
    ? await ctx.supabase.from('conference_recordings').select('id, part_no, filename').eq('group_id', r.group_id).eq('status', 'available').order('part_no')
    : { data: [{ id: r.id, part_no: null, filename: r.filename }] };
  const title = (r.conference_sessions as any)?.title ?? 'Grabación';
  return (
    <div>
      <PageHeader title={`✂ ${r.filename ?? 'Grabación'}`} subtitle="Corte un tramo, una las partes de la clase, descargue o envíe. Solo personas autorizadas ven esta página."
        actions={<Link className="btn-secondary" href={`/app/conferencias/${r.session_id}`}>← Volver a la sesión</Link>} />
      <Card><VideoEditor recId={r.id} sessionId={r.session_id} title={title} parts={parts ?? []} /></Card>
    </div>
  );
}
