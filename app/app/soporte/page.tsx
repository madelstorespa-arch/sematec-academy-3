import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea, EmailCopy } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { openTicket } from './actions';
import { CATS, ST } from './labels';

export const metadata = { title: 'Soporte técnico' };
export default async function Page({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { estado } = await searchParams;
  const staff = can(ctx, 'support.view');
  let q = ctx.supabase.from('support_tickets').select('*, profiles:requester_id(full_name)').eq('organization_id', orgId).order('updated_at', { ascending: false }).limit(200);
  if (!staff) q = q.eq('requester_id', ctx.user.id);
  else if (estado) q = q.eq('status', estado);
  else q = q.not('status', 'in', '(resuelto,cerrado)');
  const { data: tickets } = await q;
  return (
    <>
      <PageHeader title="Soporte técnico" subtitle={staff ? 'Mesa de ayuda: solicitudes de usuarios' : '¿Tiene un problema? Escríbanos y le responderemos aquí'} />
      <details className="card mb-6" open={!staff && !tickets?.length}>
        <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nueva solicitud de ayuda</summary>
        <div className="border-t border-slate-100 p-5">
          <ActionForm action={openTicket} offline={{ key: 'soporte', label: 'Solicitud de soporte' }} submitLabel="Enviar solicitud">
            <Field label="Asunto" name="subject" required />
            <Grid>
              <SelectField label="Tema" name="category" defaultValue="general" options={Object.entries(CATS).map(([value, label]) => ({ value, label }))} />
              <SelectField label="Urgencia" name="priority" defaultValue="normal" options={[{ value: 'baja', label: 'Baja' }, { value: 'normal', label: 'Normal' }, { value: 'alta', label: 'Alta' }, { value: 'urgente', label: 'Urgente' }]} />
            </Grid>
            <TextArea label="Describa el problema" name="body" required rows={5} />
          <EmailCopy /></ActionForm>
        </div>
      </details>
      {staff && (
        <nav className="mb-3 flex flex-wrap gap-2 text-sm">
          <Link className={`btn-sm ${!estado ? 'btn-primary' : 'btn-secondary'}`} href="/app/soporte">Pendientes</Link>
          {Object.entries(ST).map(([k, [l]]) => <Link key={k} className={`btn-sm ${estado === k ? 'btn-primary' : 'btn-secondary'}`} href={`/app/soporte?estado=${k}`}>{l}</Link>)}
        </nav>
      )}
      <Card>
        {tickets?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>N°</th><th>Asunto</th>{staff && <th>Solicitante</th>}<th>Tema</th><th>Urgencia</th><th>Estado</th><th>Actualizado</th>{ctx.isOwner && <th></th>}</tr></thead>
          <tbody>{tickets.map((t: any) => (
            <tr key={t.id}>
              <td className="font-mono text-xs">#{t.number}</td>
              <td><Link className="link" href={`/app/soporte/${t.id}`}>{t.subject}</Link></td>
              {staff && <td>{t.profiles?.full_name}</td>}
              <td>{CATS[t.category]}</td><td>{t.priority}</td>
              <td><Badge color={ST[t.status]?.[1]}>{ST[t.status]?.[0]}</Badge></td><td>{fmtDateTime(t.updated_at)}</td>
              {ctx.isOwner && <td><OwnerActions table="support_tickets" id={t.id} path="/app/soporte" name={`el ticket #${t.number}`} /></td>}
            </tr>))}</tbody>
        </table></div> : <Empty>No hay solicitudes.</Empty>}
      </Card>
    </>
  );
}
