import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { loadSection } from '@/lib/aula';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { moderateThread, replyThread } from '../../../actions';

export default async function Page({ params }: { params: Promise<{ id: string; tid: string }> }) {
  const { id, tid } = await params;
  const ctx = await getContext();
  const { manager, student } = await loadSection(ctx, id);
  const [{ data: t }, { data: posts }] = await Promise.all([
    ctx.supabase.from('forum_threads').select('*').eq('id', tid).eq('section_id', id).maybeSingle(),
    ctx.supabase.from('forum_posts').select('*').eq('thread_id', tid).order('created_at'),
  ]);
  if (!t) notFound();
  const h = <><input type="hidden" name="section_id" value={id} /><input type="hidden" name="thread_id" value={tid} /></>;
  return (
    <>
      <PageHeader title={`${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${t.title}`} subtitle={`${t.author_name} · ${fmtDateTime(t.created_at)}`}
        actions={manager ? <div className="flex gap-2">
          <ActionForm action={moderateThread} inline submitLabel={t.pinned ? 'Desfijar' : 'Fijar'} submitClass="btn-secondary btn-sm">{h}<input type="hidden" name="field" value="pinned" /><input type="hidden" name="value" value={t.pinned ? '0' : '1'} /></ActionForm>
          <ActionForm action={moderateThread} inline submitLabel={t.locked ? 'Reabrir' : 'Cerrar tema'} submitClass="btn-secondary btn-sm">{h}<input type="hidden" name="field" value="locked" /><input type="hidden" name="value" value={t.locked ? '0' : '1'} /></ActionForm>
        </div> : null} />
      <Link href={`/app/aula/${id}?t=foro`} className="link text-sm">← Foro</Link>
      <div className="mt-4 space-y-3">
        <Card><p className="whitespace-pre-line text-sm">{t.body}</p></Card>
        {(posts ?? []).map((p: any) => (
          <Card key={p.id}><p className="text-xs text-slate-500">{p.author_name} · {fmtDateTime(p.created_at)}</p><p className="mt-2 whitespace-pre-line text-sm">{p.body}</p></Card>))}
        {(manager || (student && !t.locked)) ? (
          <Card title="Responder"><ActionForm action={replyThread} offline={{ key: 'foro_respuesta', label: 'Respuesta en el foro' }} submitLabel="Publicar respuesta">{h}<TextArea label="Mensaje" name="body" required rows={4} /></ActionForm></Card>
        ) : t.locked ? <p className="text-sm text-slate-500">Este tema está cerrado.</p> : null}
      </div>
    </>
  );
}
