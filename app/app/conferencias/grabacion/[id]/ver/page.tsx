import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ProtectedVideo } from '@/components/protected-video';

export const dynamic = 'force-dynamic';

/** Ver la grabación: los participantes la ven; descargar, enviar y cortar es solo para personas autorizadas. */
export default async function VerGrabacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const { data: r } = await ctx.supabase.from('conference_recordings').select('id, session_id, filename').eq('id', id).maybeSingle();
  if (!r) notFound();
  const { data: allowed } = await ctx.supabase.rpc('can_manage_recordings', { p_session: r.session_id });
  return (
    <div>
      <PageHeader title={`▶ ${r.filename ?? 'Grabación'}`} actions={<span className="flex gap-2">
        {allowed && <Link className="btn-primary" href={`/app/conferencias/grabacion/${id}/editar`}>✂ Cortar, descargar o enviar</Link>}
        <Link className="btn-secondary" href={`/app/conferencias/${r.session_id}`}>← Volver</Link></span>} />
      <Card><ProtectedVideo src={`/app/conferencias/grabacion/${id}`} allowDownload={!!allowed} /></Card>
    </div>
  );
}
