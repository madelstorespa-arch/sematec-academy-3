import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Tabs } from '@/components/ui';
import { ActionForm, Field, SelectField, TextArea, EmailCopy } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { sendMessage } from './actions';

export const metadata = { title: 'Mensajes' };

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string; para?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { v, para } = await searchParams;
  const sent = v === 'enviados';
  const [{ data: msgs }, { data: recips }] = await Promise.all([
    ctx.supabase.from('messages').select('id, subject, body, created_at, read_at, sender_name, recipient_name')
      .eq('organization_id', orgId).eq(sent ? 'sender_id' : 'recipient_id', ctx.user.id).order('created_at', { ascending: false }).limit(100),
    ctx.supabase.rpc('message_recipients', { p_org: orgId }),
  ]);
  const opts = (recips ?? []).map((r: any) => ({ value: r.user_id, label: `${r.full_name || 'Sin nombre'} · ${r.role_name}` }));
  return (
    <>
      <PageHeader title="Mensajes" subtitle="Comunicación directa con profesores, estudiantes y personal" />
      <details className="card mb-6" open={!!para}>
        <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">✉ Nuevo mensaje</summary>
        <div className="border-t border-slate-100 p-5">
          {opts.length ? (
            <ActionForm action={sendMessage} offline={{ key: 'mensaje', label: 'Mensaje' }} submitLabel="Enviar">
              <SelectField label="Para" name="recipient_id" options={opts} required defaultValue={para} />
              <Field label="Asunto" name="subject" required />
              <TextArea label="Mensaje" name="body" required rows={5} />
            <EmailCopy /></ActionForm>) : <p className="text-sm text-slate-500">Aún no tiene destinatarios disponibles.</p>}
        </div>
      </details>
      <Tabs current={sent ? 'enviados' : 'recibidos'} items={[
        { key: 'recibidos', label: 'Recibidos', href: '/app/mensajes' }, { key: 'enviados', label: 'Enviados', href: '/app/mensajes?v=enviados' }]} />
      <Card>
        {msgs?.length ? (
          <ul className="divide-y divide-slate-100">{msgs.map((m: any) => (
            <li key={m.id}>
              <Link href={`/app/mensajes/${m.id}`} className="block py-3 hover:bg-slate-50">
                <p className={`text-sm ${!sent && !m.read_at ? 'font-bold' : ''}`}>{!sent && !m.read_at && '● '}{m.subject}</p>
                <p className="text-xs text-slate-500">{sent ? `Para ${m.recipient_name}` : `De ${m.sender_name}`} · {fmtDateTime(m.created_at)}</p>
                <p className="truncate text-xs text-slate-600">{m.body}</p>
              </Link>
            </li>))}</ul>
        ) : <Empty>{sent ? 'No ha enviado mensajes.' : 'No tiene mensajes.'}</Empty>}
      </Card>
    </>
  );
}
