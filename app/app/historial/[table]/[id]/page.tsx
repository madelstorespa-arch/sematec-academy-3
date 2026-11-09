import { notFound, redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { TABLE_LABELS, HIDDEN_FIELDS, fieldLabel, fmtValue, recordName } from '@/lib/undo-labels';
import { restoreVersion } from '../../../deshacer-actions';

export const dynamic = 'force-dynamic';

type Ev = {
  event_id: string; occurred_at: string; actor_name: string; operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'ACTION';
  changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null;
  reason: string | null; restorable: boolean;
};

const OP: Record<string, { text: string; color: 'green' | 'blue' | 'red' | 'gray' }> = {
  INSERT: { text: 'Creado', color: 'green' }, UPDATE: { text: 'Editado', color: 'blue' }, DELETE: { text: 'Eliminado', color: 'red' }, ACTION: { text: 'Acción', color: 'gray' },
};

export default async function HistorialPage({ params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  if (!/^[a-z_]{2,40}$/.test(table) || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  if (!ctx.isOwner) redirect('/app');
  const { data, error } = await ctx.supabase.rpc('record_history', { p_table: table, p_id: id });
  const evs = (data ?? []) as Ev[];
  const latest = evs[0];
  const name = recordName(latest?.new_data ?? latest?.old_data);
  return (
    <div>
      <PageHeader title={`🕘 Historial: ${TABLE_LABELS[table] ?? table}${name ? ` «${name}»` : ''}`}
        subtitle="Cada cambio que tuvo este registro, del más reciente al más antiguo. «Volver a esta versión» lo deja como quedó en ese momento (y ese cambio también se puede deshacer)." />
      {error ? <Card><p className="text-sm text-red-700">{error.message}</p></Card> : !evs.length ? <Empty>Sin historial.</Empty> : (
        <ol className="space-y-3">
          {evs.map((e, i) => {
            const fields = e.operation === 'UPDATE'
              ? (e.changed_fields ?? []).filter((f) => !HIDDEN_FIELDS.has(f))
              : Object.keys((e.operation === 'DELETE' ? e.old_data : e.new_data) ?? {}).filter((f) => !HIDDEN_FIELDS.has(f) && !f.endsWith('_id'));
            const data = (e.operation === 'DELETE' ? e.old_data : e.new_data) ?? {};
            return (
              <li key={e.event_id} className="card card-pad" data-testid="version">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge color={OP[e.operation]?.color}>{OP[e.operation]?.text ?? e.operation}</Badge>
                    <span className="font-semibold">{fmtDateTime(e.occurred_at)}</span>
                    <span className="text-slate-500">por {e.actor_name}</span>
                    {i === 0 && e.operation !== 'DELETE' && <Badge color="green">Versión actual</Badge>}
                    {e.reason && <span className="text-xs italic text-slate-500">{e.reason}</span>}
                  </div>
                  {e.restorable && !(i === 0 && e.operation !== 'DELETE') && (
                    <ActionForm action={restoreVersion} inline submitLabel={e.operation === 'DELETE' ? '♻ Restaurar como estaba' : '↺ Volver a esta versión'}
                      submitClass="btn-secondary btn-sm" confirm="¿Dejar el registro como estaba en esta versión?">
                      <input type="hidden" name="event" value={e.event_id} />
                    </ActionForm>
                  )}
                </div>
                {fields.length > 0 && (
                  <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                    {fields.slice(0, 14).map((f) => (
                      <div key={f} className="contents">
                        <dt className="font-medium text-slate-600">{fieldLabel(f)}</dt>
                        <dd className="break-words">
                          {e.operation === 'UPDATE'
                            ? <><span className="text-red-700 line-through">{fmtValue(e.old_data?.[f])}</span> → <span className="text-emerald-800">{fmtValue(e.new_data?.[f])}</span></>
                            : fmtValue(data[f])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
