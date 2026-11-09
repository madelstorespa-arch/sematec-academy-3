import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { restoreChange } from '../deshacer-actions';

export const dynamic = 'force-dynamic';

type Row = { tx_id: string; deleted_at: string; actor_name: string; label: string; items: number; table_name: string; record_id: string };

export default async function PapeleraPage() {
  const ctx = await getContext();
  if (!ctx.isOwner || !ctx.orgId) redirect('/app');
  const { data, error } = await ctx.supabase.rpc('trash_list', { p_org: ctx.orgId });
  const rows = (data ?? []) as Row[];
  return (
    <div>
      <PageHeader title="🗑 Papelera"
        subtitle="Todo lo eliminado en los últimos 30 días. Restaurar lo devuelve tal como estaba, con sus registros relacionados." />
      <Card>
        {error ? <p className="text-sm text-red-700">{error.message}</p> : rows.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Eliminado</th><th>Qué se eliminó</th><th>Por</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tx_id} data-testid="papelera-fila">
                    <td className="whitespace-nowrap">{fmtDateTime(r.deleted_at)}</td>
                    <td>{r.label}</td>
                    <td>{r.actor_name}</td>
                    <td className="space-x-2 whitespace-nowrap">
                      <ActionForm action={restoreChange} inline submitLabel="♻ Restaurar" submitClass="btn-primary btn-sm">
                        <input type="hidden" name="tx" value={r.tx_id} />
                      </ActionForm>
                      {r.record_id && <Link className="text-xs text-brand-700 hover:underline" href={`/app/historial/${r.table_name}/${r.record_id}`}>🕘 Historial</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>La papelera está vacía.</Empty>}
      </Card>
      <p className="mt-4 text-xs text-slate-500">
        Pagos, notas, actas y certificados no pasan por la papelera: se anulan o rectifican con motivo y quedan en la Auditoría.
        Cada usuario puede además deshacer sus propios cambios de la última hora con el botón ↶ Deshacer (Ctrl+Z).
      </p>
    </div>
  );
}
