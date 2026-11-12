import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader } from '@/components/ui';
import { Opener } from './opener';

export const metadata = { title: 'Abrir en Oficina' };

export default async function Page({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(fid)) notFound();
  const ctx = await getContext();
  const { data: f } = await ctx.supabase.from('user_files').select('id, name, mime_type').eq('id', fid).is('deleted_at', null).maybeSingle();
  if (!f) notFound();
  return <><PageHeader title="💼 SEMATEC Oficina" /><Opener fid={f.id} name={f.name} mime={f.mime_type} /></>;
}
