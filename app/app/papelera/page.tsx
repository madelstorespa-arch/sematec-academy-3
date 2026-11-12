import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { restoreChange } from '../deshacer-actions';
import { unhideRecord } from '../hide-actions';
import { AUDIENCES } from '@/lib/hideable';

const TABLE_LABEL: Record<string, string> = { announcements: 'Anuncio', calendar_events: 'Evento', library_items: 'Biblioteca', job_postings: 'Empleo', surveys: 'Encuesta', catalog_offerings: 'Curso del sitio', offices: 'Oficina', resources: 'Recurso', course_contents: 'Contenido del aula', course_units: 'Unidad del aula', class_materials: 'Material', forum_threads: 'Foro', user_files: 'Archivo', conference_sessions: 'Aula virtual', products: 'Producto', media_assets: 'Imagen', quizzes: 'Evaluación', assignments: 'Tarea', benefits: 'Beneficio' };
const AUD = Object.fromEntries(AUDIENCES);

export const dynamic = 'force-dynamic';

type Row = { tx_id: string; deleted_at: string; actor_name: string; label: string; items: number; table_name: string; record_id: string };

export default async function PapeleraPage() {
  const ctx = await getContext();
  if (!ctx.isOwner || !ctx.orgId) redirect('/app');
  const { data, error } = await ctx.supabase.rpc('trash_list', { p_org: ctx.orgId });
  const rows = (data ?? []) as Row[];
  const { data: hid } = await ctx.supabase.from('hidden_records').select('id, table_name, record_id, audience, hidden_until, reason, created_at, profiles!hidden_records_hidden_by_fkey(full_name)')
    .eq('organization_id', ctx.orgId).order('created_at', { ascending: false }).limit(200);
  const activeHidden = (hid ?? []).filter((h: any) => !h.hidden_until || Date.parse(h.hidden_until) > Date.now());
  return (
    <div>
      <PageHeader title="🗑 Papelera y ocultos"
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
      <Card title={`🙈 Ocultos (${activeHidden.length})`} className="mt-6">
        {activeHidden.length ? (
          <div className="overflow-x-auto"><table className="table" data-testid="lista-ocultos">
            <thead><tr><th>Qué</th><th>Oculto para</th><th>Hasta</th><th>Por</th><th></th></tr></thead>
            <tbody>{activeHidden.map((h: any) => (
              <tr key={h.id}><td>{TABLE_LABEL[h.table_name] ?? h.table_name}{h.reason && <span className="block text-xs text-slate-500">{h.reason}</span>}</td>
                <td>{h.audience.map((a: string) => AUD[a] ?? a).join(', ')}</td>
                <td className="whitespace-nowrap">{h.hidden_until ? fmtDateTime(h.hidden_until) : 'Hasta mostrarlo'}</td>
                <td>{h.profiles?.full_name ?? ''}</td>
                <td><ActionForm action={unhideRecord} inline submitLabel="👁 Mostrar" submitClass="btn-secondary btn-sm">
                  <input type="hidden" name="table" value={h.table_name} /><input type="hidden" name="id" value={h.record_id} /><input type="hidden" name="path" value="/app/papelera" /></ActionForm></td></tr>))}</tbody></table></div>
        ) : <Empty>No hay nada oculto. Use «👁 Ocultar» en anuncios, cursos, eventos, contenidos y más para ocultarlos a un público o por un tiempo.</Empty>}
      </Card>
      <p className="mt-4 text-xs text-slate-500">
        Pagos, notas, actas y certificados no pasan por la papelera: se anulan o rectifican con motivo y quedan en la Auditoría.
        Cada usuario puede además deshacer sus propios cambios de las últimas 24 horas con el botón ↶ Deshacer (Ctrl+Z).
      </p>
    </div>
  );
}
