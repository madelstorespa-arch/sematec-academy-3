import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, Grid, SelectField, TextArea, EmailCopy } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { replyTicket, updateTicket } from '../actions';
import { CATS, ST } from '../labels';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const { data: t } = await ctx.supabase.from('support_tickets').select('*, profiles:requester_id(full_name, email)').eq('id', id).maybeSingle();
  if (!t) notFound();
  const staff = can(ctx, 'support.edit');
  const [{ data: msgs }, { data: agents }] = await Promise.all([
    ctx.supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at'),
    staff ? ctx.supabase.rpc('message_recipients', { p_org: t.organization_id }) : Promise.resolve({ data: [] as any[] }),
  ]);
  return (
    <>
      <PageHeader title={`#${t.number} · ${t.subject}`} subtitle={`${t.profiles?.full_name} · ${CATS[t.category]} · abierto ${fmtDateTime(t.created_at)}`}
        actions={<Badge color={ST[t.status]?.[1]}>{ST[t.status]?.[0]}</Badge>} />
      <Link href="/app/soporte" className="link text-sm">← Volver</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {(msgs ?? []).map((m: any) => (
            <Card key={m.id} className={m.internal ? 'border-amber-300 bg-amber-50' : m.author_id === t.requester_id ? '' : 'border-brand-200 bg-brand-50'}>
              <p className="text-xs text-slate-500">{m.author_name} · {fmtDateTime(m.created_at)}{m.internal && ' · Nota interna'}</p>
              <p className="mt-2 whitespace-pre-line text-sm">{m.body}</p>
            </Card>))}
          {t.status !== 'cerrado' || staff ? (
            <Card title="Responder">
              <ActionForm action={replyTicket} offline={{ key: 'soporte_respuesta', label: 'Respuesta a soporte' }} submitLabel="Enviar">
                <input type="hidden" name="ticket_id" value={t.id} />
                <TextArea label="Mensaje" name="body" required rows={4} />
                {staff && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" /> Nota interna (no la ve el solicitante)</label>}
              <EmailCopy /></ActionForm>
            </Card>) : <p className="text-sm text-slate-500">Este ticket está cerrado. Si el problema continúa, abra una nueva solicitud.</p>}
        </div>
        {staff && (
          <Card title="Gestión">
            <ActionForm action={updateTicket} submitLabel="Actualizar" resetOnSuccess={false}>
              <input type="hidden" name="ticket_id" value={t.id} />
              <Grid cols={2}>
                <SelectField label="Estado" name="status" required defaultValue={t.status} options={Object.entries(ST).map(([value, [label]]) => ({ value, label }))} />
                <SelectField label="Urgencia" name="priority" required defaultValue={t.priority} options={['baja', 'normal', 'alta', 'urgente'].map((v) => ({ value: v, label: v }))} />
              </Grid>
              <SelectField label="Asignado a" name="assigned_to" defaultValue={t.assigned_to} placeholder="Sin asignar"
                options={[{ value: ctx.user.id, label: 'Yo' }, ...(agents ?? []).map((a: any) => ({ value: a.user_id, label: a.full_name }))]} />
            </ActionForm>
            <p className="mt-3 text-xs text-slate-500">Solicitante: {t.profiles?.email}</p>
          </Card>)}
      </div>
    </>
  );
}
