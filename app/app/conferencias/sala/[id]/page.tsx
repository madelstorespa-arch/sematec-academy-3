import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { Room } from './room';

export const metadata = { title: 'Sala virtual' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const { data: s } = await ctx.supabase.from('conference_sessions').select('id, title, recording_enabled').eq('id', id).maybeSingle();
  if (!s) notFound();
  return <Room sessionId={s.id} title={s.title} recording={s.recording_enabled} />;
}
