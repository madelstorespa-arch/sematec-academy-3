import { getContext, can, requireOrg } from '@/lib/context';
import { OwnerActions } from '@/components/owner-actions';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions } from '@/lib/options';
import { addResource, cancelReservation, reserve, setResourceStatus } from './actions';

export const metadata = { title: 'Salas y recursos' };
const TZ = 'America/Santiago';
const fmt = (r: string) => {
  const m = /[\[(]"?([^",]+)"?,"?([^")\]]+)"?/.exec(r); if (!m) return r;
  const a = new Date(m[1]), b = new Date(m[2]);
  return `${a.toLocaleDateString('es-CL', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short' })} ${a.toLocaleTimeString('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}–${b.toLocaleTimeString('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`;
};

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const admin = can(ctx, 'facilities.create');
  const canBook = admin || !!ctx.teacherId;
  const now = new Date().toISOString();
  const [{ data: rooms }, { data: res }, { data: rsv }, campuses] = await Promise.all([
    ctx.supabase.from('rooms').select('id, code, name, capacity, room_type, campuses(name)').eq('organization_id', orgId).eq('status', 'active').order('code'),
    ctx.supabase.from('resources').select('*').eq('organization_id', orgId).order('code'),
    ctx.supabase.from('reservations').select('*, rooms(code, name), resources(code, name)').eq('organization_id', orgId).eq('status', 'confirmada')
      .not('during', 'sl', `["${now}","${now}"]`).order('created_at').limit(300),
    admin ? campusOptions(ctx) : Promise.resolve([]),
  ]);
  const list = (rsv ?? []).sort((a: any, b: any) => String(a.during).localeCompare(String(b.during)));
  const targets = [
    ...(rooms ?? []).map((r: any) => ({ value: `room:${r.id}`, label: `🏫 ${r.code} · ${r.name} (${r.capacity} personas)` })),
    ...(res ?? []).filter((r: any) => r.status === 'disponible').map((r: any) => ({ value: `res:${r.id}`, label: `🔧 ${r.code} · ${r.name}` })),
  ];
  return (
    <>
      <PageHeader title="Salas y recursos" subtitle="Reservas de salas, laboratorios y equipos sin choques de horario" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {canBook ? (
          <Card title="Nueva reserva">
            <ActionForm action={reserve} submitLabel="Reservar">
              <SelectField label="Sala o recurso" name="target" required options={targets} />
              <Grid cols={3}><Field label="Fecha" name="day" type="date" required /><Field label="Desde" name="start" type="time" required /><Field label="Hasta" name="end" type="time" required /></Grid>
              <Field label="Motivo" name="purpose" required placeholder="Clase de recuperación, reunión de apoderados…" />
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">El sistema impide reservar una sala ocupada por otra reserva o por clases programadas.</p>
          </Card>) : <Card><p className="text-sm text-slate-600">Para reservar una sala o equipo, contacte a secretaría o a su profesor.</p></Card>}
        {admin && (
          <Card title="Agregar equipo o recurso">
            <ActionForm action={addResource} submitLabel="Agregar">
              <Grid><Field label="Código" name="code" required placeholder="PROY-01" /><Field label="Nombre" name="name" required placeholder="Proyector Epson" /></Grid>
              <Grid><SelectField label="Tipo" name="kind" defaultValue="equipo" options={['equipo', 'proyector', 'notebook', 'laboratorio', 'vehiculo', 'otro'].map((v) => ({ value: v, label: v }))} />
                <SelectField label="Sede" name="campus_id" options={campuses} /></Grid>
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">Las salas y laboratorios se crean en Configuración → Salas y laboratorios.</p>
          </Card>)}
      </div>
      <Card title="Próximas reservas" className="mb-6">
        {list.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Cuándo</th><th>Sala / recurso</th><th>Motivo</th><th>Reservado por</th><th></th></tr></thead>
          <tbody>{list.map((r: any) => (
            <tr key={r.id}><td className="whitespace-nowrap">{fmt(String(r.during))}</td>
              <td>{r.rooms ? `🏫 ${r.rooms.code} · ${r.rooms.name}` : `🔧 ${r.resources?.code} · ${r.resources?.name}`}</td><td>{r.purpose}</td><td>{r.reserved_name}</td>
              <td>{(r.reserved_by === ctx.user.id || can(ctx, 'facilities.edit')) && <ActionForm action={cancelReservation} inline submitLabel="Cancelar" submitClass="btn-secondary btn-sm" confirm="¿Cancelar la reserva?"><input type="hidden" name="id" value={r.id} /></ActionForm>}
                {ctx.isOwner && <OwnerActions table="reservations" id={r.id} path="/app/reservas" name="la reserva" />}</td></tr>))}</tbody>
        </table></div> : <Empty>No hay reservas próximas.</Empty>}
      </Card>
      <Card title="Equipos y recursos">
        {res?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Estado</th>{ctx.isOwner && <th></th>}</tr></thead>
          <tbody>{res.map((r: any) => (
            <tr key={r.id}><td className="font-mono text-xs">{r.code}</td><td>{r.name}</td><td>{r.kind}</td>
              <td>{can(ctx, 'facilities.edit') ? (
                <ActionForm action={setResourceStatus} inline submitLabel="✓" submitClass="btn-secondary btn-sm" resetOnSuccess={false}><input type="hidden" name="id" value={r.id} />
                  <select name="status" defaultValue={r.status} className="input py-1 text-xs"><option value="disponible">Disponible</option><option value="mantencion">En mantención</option><option value="baja">De baja</option></select>
                </ActionForm>) : <Badge color={r.status === 'disponible' ? 'green' : 'amber'}>{r.status}</Badge>}</td>
              {ctx.isOwner && <td><OwnerActions table="resources" id={r.id} active={r.status !== 'mantencion'} path="/app/reservas" name={r.name} /></td>}</tr>))}</tbody>
        </table></div> : <Empty>No hay equipos registrados.</Empty>}
      </Card>
    </>
  );
}
