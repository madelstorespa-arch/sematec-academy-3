import { getContext, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { verifyChain } from './actions';

export const metadata = { title: 'Auditoría' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tabla?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'audit.view');
  const orgId = requireOrg(ctx);
  const { tabla } = await searchParams;
  let q = ctx.supabase.from('audit_events').select('id, chain_seq, occurred_at, actor_id, table_name, record_id, operation, action, changed_fields, reason').eq('organization_id', orgId);
  if (tabla) q = q.eq('table_name', tabla);
  const [{ data: events }, { data: security }] = await Promise.all([
    q.order('chain_seq', { ascending: false }).limit(300),
    ctx.supabase.from('system_events').select('id, occurred_at, event_type, severity, details').eq('organization_id', orgId).order('occurred_at', { ascending: false }).limit(50),
  ]);
  const actorIds = [...new Set((events ?? []).map((e: any) => e.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length ? await ctx.supabase.from('profiles').select('id, full_name, email').in('id', actorIds) : { data: [] as any[] };
  const who = (id: string | null) => { if (!id) return 'Sistema'; const a = actors?.find((x: any) => x.id === id); return a?.full_name || a?.email || id.slice(0, 8); };
  const opColor = { INSERT: 'green', UPDATE: 'blue', DELETE: 'red', ACTION: 'amber' } as const;

  return (
    <>
      <PageHeader title="Auditoría" subtitle="Registro inmutable y encadenado de operaciones sensibles"
        actions={<ActionForm action={verifyChain} submitLabel="Verificar integridad" resetOnSuccess={false} inline />} />
      <Card title="Eventos de auditoría (últimos 300)">
        <form className="mb-4 flex gap-2"><input className="input max-w-xs" name="tabla" defaultValue={tabla} placeholder="Filtrar por tabla (p. ej. payments)" /><button className="btn-secondary">Filtrar</button></form>
        {events?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>#</th><th>Fecha</th><th>Usuario</th><th>Operación</th><th>Tabla</th><th>Campos</th><th>Motivo</th></tr></thead>
          <tbody>{events.map((e: any) => (
            <tr key={e.id}><td className="font-mono text-xs">{e.chain_seq}</td><td className="whitespace-nowrap">{fmtDateTime(e.occurred_at)}</td><td>{who(e.actor_id)}</td>
              <td><Badge color={opColor[e.operation as keyof typeof opColor] ?? 'gray'}>{e.operation}</Badge></td><td><code className="text-xs">{e.table_name}</code></td>
              <td className="text-xs">{e.changed_fields?.join(', ') ?? '—'}</td><td className="text-xs">{e.reason ?? ''}</td></tr>))}</tbody></table></div> : <Empty>Sin eventos.</Empty>}
      </Card>
      <Card title="Eventos de seguridad" className="mt-6">
        {security?.length ? <table className="table"><tbody>{security.map((s: any) => <tr key={s.id}><td>{fmtDateTime(s.occurred_at)}</td><td>{s.event_type}</td><td><Badge color={s.severity === 'critical' ? 'red' : s.severity === 'warning' ? 'amber' : 'gray'}>{s.severity}</Badge></td></tr>)}</tbody></table> : <Empty>Sin eventos de seguridad.</Empty>}
      </Card>
    </>
  );
}
