import Link from 'next/link';
import { ActionForm } from '@/components/forms';
import { ownerManage } from '@/app/app/owner-actions';

/**
 * Botones del propietario institucional: suspender / reactivar / eliminar.
 * `active` undefined = el registro solo se puede eliminar.
 */
export function OwnerActions({ table, id, active, path, name = 'este registro' }: {
  table: string; id: string; active?: boolean; path: string; name?: string;
}) {
  const hidden = (op: string) => (<><input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} />
    <input type="hidden" name="op" value={op} /><input type="hidden" name="path" value={path} /></>);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {active !== undefined && (active
        ? <ActionForm action={ownerManage} inline submitLabel="⏸ Suspender" submitClass="btn-secondary btn-sm" confirm={`¿Suspender ${name}? Podrá reactivarlo después.`}>{hidden('suspend')}</ActionForm>
        : <ActionForm action={ownerManage} inline submitLabel="▶ Activar" submitClass="btn-secondary btn-sm">{hidden('activate')}</ActionForm>)}
      <ActionForm action={ownerManage} inline submitLabel="🗑 Eliminar" submitClass="btn-secondary btn-sm text-red-700" confirm={`¿Eliminar ${name}? Quedará en la Papelera por 30 días y podrá restaurarlo.`}>{hidden('delete')}</ActionForm>
      <Link href={`/app/historial/${table}/${id}`} className="btn-secondary btn-sm" title="Historial de versiones">🕘 Historial</Link>
    </span>
  );
}
