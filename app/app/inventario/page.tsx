import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { OwnerActions } from '@/components/owner-actions';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions } from '@/lib/options';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { addItem, updateItem } from './actions';

export const metadata = { title: 'Inventario' };
const CAT: Record<string, string> = { computador: 'Computador', mobiliario: 'Mobiliario', audiovisual: 'Audiovisual', redes: 'Redes', laboratorio: 'Laboratorio', oficina: 'Oficina', otro: 'Otro' };
const ST: Record<string, [string, 'green' | 'amber' | 'blue' | 'red']> = { operativo: ['Operativo', 'green'], en_reparacion: ['En reparación', 'amber'], prestado: ['Prestado', 'blue'], de_baja: ['De baja', 'red'] };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string; ver?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'inventory.view');
  const orgId = requireOrg(ctx);
  const { q, estado, ver } = await searchParams;
  const edit = can(ctx, 'inventory.edit');
  const clean = (q ?? '').replace(/[%,()]/g, '');
  let query = ctx.supabase.from('inventory_items').select('*, rooms(code, name), campuses(name)').eq('organization_id', orgId).order('code').limit(500);
  if (clean) query = query.or(`code.ilike.%${clean}%,name.ilike.%${clean}%,serial_number.ilike.%${clean}%,assigned_to.ilike.%${clean}%`);
  if (estado) query = query.eq('status', estado);
  const [{ data: items }, { data: rooms }, campuses, { data: moves }] = await Promise.all([
    query, ctx.supabase.from('rooms').select('id, code, name').eq('organization_id', orgId).order('code'), campusOptions(ctx),
    ver ? ctx.supabase.from('inventory_movements').select('*').eq('item_id', ver).order('created_at', { ascending: false }) : Promise.resolve({ data: null }),
  ]);
  const roomOpts = (rooms ?? []).map((r: any) => ({ value: r.id, label: `${r.code} · ${r.name}` }));
  const all = items ?? [];
  const total = all.filter((i: any) => i.status !== 'de_baja').reduce((n: number, i: any) => n + Number(i.purchase_value ?? 0), 0);
  return (
    <>
      <PageHeader title="Inventario" subtitle="Bienes de la institución: ubicación, responsable, estado e historial" />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Bienes" value={all.length} /><Stat label="Operativos" value={all.filter((i: any) => i.status === 'operativo').length} />
        <Stat label="En reparación" value={all.filter((i: any) => i.status === 'en_reparacion').length} /><Stat label="Valor (vigentes)" value={fmtMoney(total, 'CLP')} />
      </div>
      {can(ctx, 'inventory.create') && (
        <details className="card mb-6"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Ingresar bien</summary>
          <div className="border-t border-slate-100 p-5"><ActionForm action={addItem} submitLabel="Ingresar">
            <Grid cols={3}><Field label="Código de inventario" name="code" required placeholder="INV-0001" /><Field label="Nombre" name="name" required placeholder="Notebook HP 240" />
              <SelectField label="Categoría" name="category" defaultValue="computador" options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} /></Grid>
            <Grid cols={3}><Field label="Marca" name="brand" /><Field label="Modelo" name="model" /><Field label="N° de serie" name="serial_number" /></Grid>
            <Grid cols={3}><SelectField label="Sede" name="campus_id" options={campuses} /><SelectField label="Sala / ubicación" name="room_id" options={roomOpts} /><Field label="Responsable / asignado a" name="assigned_to" /></Grid>
            <Grid cols={3}><Field label="Fecha de compra" name="purchase_date" type="date" /><Field label="Valor de compra (CLP)" name="purchase_value" type="number" /><Field label="Observaciones" name="notes" /></Grid>
          </ActionForm></div></details>)}
      {moves && <Card title="Historial del bien" className="mb-6" actions={<a className="btn-secondary btn-sm" href="/app/inventario">Cerrar</a>}>
        <ul className="space-y-1 text-sm">{moves.map((m: any) => <li key={m.id}>{fmtDateTime(m.created_at)} · <b>{m.kind}</b> · {m.detail} <span className="text-slate-500">({m.moved_by_name ?? 'sistema'})</span></li>)}</ul></Card>}
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-xs" name="q" defaultValue={q} placeholder="Buscar código, nombre, serie, responsable" />
          <select name="estado" defaultValue={estado ?? ''} className="input max-w-[12rem]"><option value="">Todos los estados</option>{Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn-secondary">Filtrar</button>
        </form>
        {all.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Código</th><th>Bien</th><th>Ubicación</th><th>Responsable</th><th>Compra</th><th>Estado</th><th></th></tr></thead>
          <tbody>{all.map((i: any) => (
            <tr key={i.id}><td className="font-mono text-xs">{i.code}</td>
              <td>{i.name}<span className="block text-xs text-slate-500">{CAT[i.category]}{i.brand && ` · ${i.brand}`}{i.model && ` ${i.model}`}{i.serial_number && ` · S/N ${i.serial_number}`}</span></td>
              <td>{i.rooms ? `${i.rooms.code}` : i.campuses?.name ?? '—'}</td><td>{i.assigned_to ?? '—'}</td>
              <td className="text-xs">{i.purchase_date ? fmtDate(i.purchase_date) : '—'}{i.purchase_value != null && <span className="block">{fmtMoney(i.purchase_value, 'CLP')}</span>}</td>
              <td>{edit ? (
                <ActionForm action={updateItem} inline submitLabel="✓" submitClass="btn-secondary btn-sm" resetOnSuccess={false}><input type="hidden" name="id" value={i.id} />
                  <select name="status" defaultValue={i.status} className="input py-1 text-xs">{Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
                  <select name="room_id" defaultValue={i.room_id ?? ''} className="input py-1 text-xs"><option value="">Sin sala</option>{roomOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  <input name="assigned_to" defaultValue={i.assigned_to ?? ''} placeholder="Responsable" className="input w-28 py-1 text-xs" />
                </ActionForm>) : <Badge color={ST[i.status][1]}>{ST[i.status][0]}</Badge>}</td>
              <td className="space-y-1"><a className="link text-xs" href={`/app/inventario?ver=${i.id}`}>Historial</a>
                {ctx.isOwner && <OwnerActions table="inventory_items" id={i.id} active={i.status !== 'de_baja'} path="/app/inventario" name={i.name} />}</td></tr>))}</tbody>
        </table></div> : <Empty>{q || estado ? 'Sin resultados.' : 'El inventario está vacío.'}</Empty>}
      </Card>
    </>
  );
}
