import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, StatusBadge, Tabs } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { decide, updateMessage } from './actions';

export const metadata = { title: 'Admisión web' };
const MSG: Record<string, [string, 'red' | 'amber' | 'green' | 'gray']> = { new: ['Nuevo', 'red'], in_progress: ['En gestión', 'amber'], answered: ['Respondido', 'green'], spam: ['Spam', 'gray'] };
const ORD: Record<string, [string, 'red' | 'amber' | 'green' | 'gray']> = { pending: ['Pendiente', 'amber'], paid: ['Pagado', 'green'], failed: ['Rechazado', 'red'], cancelled: ['Anulado', 'gray'], expired: ['Vencido', 'gray'] };

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'admissions.view');
  const orgId = requireOrg(ctx);
  const t = (await searchParams).t ?? 'postulaciones';
  const sb = ctx.supabase;
  const tabs = [['postulaciones', 'Postulaciones web'], ['mensajes', 'Mensajes de contacto'], ['pedidos', 'Compras en línea']].map(([key, label]) => ({ key, label, href: `/app/admision?t=${key}` }));
  return (
    <>
      <PageHeader title="Admisión web" subtitle="Solicitudes, mensajes y compras recibidas desde el sitio público" />
      <Tabs items={tabs} current={t} />
      {t === 'postulaciones' && <Apps />}
      {t === 'mensajes' && <Msgs />}
      {t === 'pedidos' && <Orders />}
    </>
  );

  async function Apps() {
    const { data } = await sb.from('applications').select('id, tracking_code, applicant_name, applicant_email, status, submitted_at, decision_notes, form_data, catalog_offerings(title)')
      .eq('organization_id', orgId).not('tracking_code', 'is', null).order('submitted_at', { ascending: false }).limit(300);
    return <Card>{data?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Código</th><th>Postulante</th><th>Curso</th><th>Fecha</th><th>Antecedentes</th><th>Estado</th>{can(ctx, 'admissions.approve') && <th>Decisión</th>}</tr></thead>
      <tbody>{data.map((a: any) => (
        <tr key={a.id}><td className="font-mono text-xs">{a.tracking_code}</td><td>{a.applicant_name}<br /><span className="text-xs text-slate-500">{a.applicant_email} · {a.form_data?.phone}</span></td>
          <td>{a.catalog_offerings?.title}</td><td>{fmtDateTime(a.submitted_at)}</td>
          <td className="max-w-xs text-xs">{a.form_data?.doc_type} {a.form_data?.doc_number}<br />{a.form_data?.education}<br /><i>{a.form_data?.motivation}</i></td>
          <td><StatusBadge status={a.status} />{a.decision_notes && <p className="text-xs text-slate-500">{a.decision_notes}</p>}</td>
          {can(ctx, 'admissions.approve') && <td>{['submitted', 'under_review'].includes(a.status) && (
            <ActionForm action={decide} inline submitLabel="Aplicar" submitClass="btn-secondary btn-sm">
              <input type="hidden" name="id" value={a.id} />
              <select name="decision" className="input py-1 text-xs"><option value="approve">Aprobar</option><option value="reject">Rechazar</option></select>
              <input name="notes" placeholder="Observación al postulante" className="input w-40 py-1 text-xs" />
            </ActionForm>)}</td>}
        </tr>))}</tbody></table></div> : <Empty>Sin postulaciones web.</Empty>}</Card>;
  }

  async function Msgs() {
    const { data } = await sb.from('contact_messages').select('*, catalog_offerings(title)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(300);
    return <div className="space-y-4">{data?.length ? data.map((m: any) => (
      <Card key={m.id} title={`${m.subject}`} actions={<Badge color={MSG[m.status][1]}>{MSG[m.status][0]}</Badge>}>
        <p className="text-sm"><b>{m.full_name}</b> · <a className="link" href={`mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject)}`}>{m.email}</a>{m.phone && ` · ${m.phone}`} · {fmtDateTime(m.created_at)}{m.catalog_offerings && ` · Curso: ${m.catalog_offerings.title}`}</p>
        <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{m.message}</p>
        {can(ctx, 'admissions.edit') && (
          <ActionForm action={updateMessage} inline submitLabel="Guardar" submitClass="btn-secondary btn-sm" resetOnSuccess={false} className="mt-3">
            <input type="hidden" name="id" value={m.id} />
            <select name="status" defaultValue={m.status} className="input py-1 text-xs">{Object.entries(MSG).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            <input name="internal_notes" defaultValue={m.internal_notes ?? ''} placeholder="Nota interna" className="input w-72 py-1 text-xs" />
          </ActionForm>)}
      </Card>)) : <Empty>Sin mensajes.</Empty>}</div>;
  }

  async function Orders() {
    const { data } = await sb.from('checkout_orders').select('*, catalog_offerings(title)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(300);
    return <Card>{data?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>N°</th><th>Fecha</th><th>Comprador</th><th>Curso</th><th>Medio</th><th className="text-right">Monto</th><th>Estado</th><th>Matrícula</th></tr></thead>
      <tbody>{data.map((o: any) => (
        <tr key={o.id}><td>{o.order_number}</td><td>{fmtDateTime(o.created_at)}</td><td>{o.buyer_name}<br /><span className="text-xs text-slate-500">{o.buyer_email}</span></td>
          <td>{o.catalog_offerings?.title}</td><td>{({ webpay: 'Webpay Plus', mercadopago: 'Mercado Pago', flow: 'Flow', stripe: 'Stripe' } as Record<string, string>)[o.provider] ?? o.provider}</td><td className="text-right font-semibold">{fmtMoney(o.amount, o.currency)}</td>
          <td><Badge color={ORD[o.status][1]}>{ORD[o.status][0]}</Badge>{o.provider_status && o.status !== 'paid' && <p className="text-xs text-slate-500">{o.provider_status}</p>}</td>
          <td>{o.enrollment_id ? <Badge color="green">Creada</Badge> : '—'}</td></tr>))}</tbody></table></div> : <Empty>Sin compras.</Empty>}</Card>;
  }
}
