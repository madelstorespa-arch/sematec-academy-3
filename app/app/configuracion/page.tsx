import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { OwnerActions } from '@/components/owner-actions';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions, countryOptions } from '@/lib/options';
import { updateOrganization, createCampus, createRoom, saveSetting } from './actions';

export const metadata = { title: 'Configuración' };
const KNOWN = [
  { key: 'certificates.block_if_overdue', label: 'Bloquear certificados con deuda vencida', example: 'true' },
  { key: 'conferences.min_attendance_pct', label: 'Asistencia mínima en conferencias (%)', example: '75' },
];

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'organization.admin', 'settings.admin');
  const orgId = requireOrg(ctx);
  const sb = ctx.supabase;
  const [{ data: org }, { data: campuses }, { data: rooms }, { data: settings }, countries, campusOpts] = await Promise.all([
    sb.from('organizations').select('*').eq('id', orgId).single(),
    sb.from('campuses').select('*').eq('organization_id', orgId).order('name'),
    sb.from('rooms').select('*, campuses(name)').eq('organization_id', orgId).order('code'),
    sb.from('organization_settings').select('*').eq('organization_id', orgId).order('key'),
    countryOptions(ctx), campusOptions(ctx),
  ]);
  const orgAdmin = can(ctx, 'organization.admin');
  return (
    <>
      <PageHeader title="Configuración institucional" subtitle="Datos, sedes, salas y reglas de negocio sin editar código" />
      <div className="grid gap-6 xl:grid-cols-2">
        {orgAdmin && (
          <Card title="Datos de la institución">
            <ActionForm action={updateOrganization} submitLabel="Guardar" resetOnSuccess={false}>
              <Grid>
                <Field label="Razón social" name="legal_name" required defaultValue={org.legal_name} />
                <Field label="Nombre visible" name="display_name" required defaultValue={org.display_name} />
                <Field label="Identificador tributario" name="tax_id" defaultValue={org.tax_id} />
                <Field label="Zona horaria" name="timezone" required defaultValue={org.timezone} />
                <Field label="Idioma" name="default_locale" required defaultValue={org.default_locale} />
                <Field label="Moneda base" name="base_currency_ro" defaultValue={org.base_currency} />
              </Grid>
            </ActionForm>
          </Card>
        )}
        {can(ctx, 'settings.admin') && (
          <Card title="Reglas configurables">
            {settings?.length ? <table className="table mb-4"><thead><tr><th>Parámetro</th><th>Valor</th></tr></thead>
              <tbody>{settings.map((s: any) => <tr key={s.id}><td><code className="text-xs">{s.key}</code><br /><span className="text-xs text-slate-500">{s.description}</span></td><td className="font-mono text-xs">{JSON.stringify(s.value)}</td></tr>)}</tbody></table> : <Empty>Sin parámetros personalizados.</Empty>}
            <ActionForm action={saveSetting} submitLabel="Guardar parámetro">
              <Grid>
                <SelectField label="Parámetro" name="key" required options={KNOWN.map((k) => ({ value: k.key, label: k.label }))} />
                <Field label="Valor (JSON)" name="value" required placeholder="true / 75 / &quot;texto&quot;" />
              </Grid>
            </ActionForm>
          </Card>
        )}
        {orgAdmin && (
          <Card title="Sedes">
            {campuses?.length ? <ul className="mb-4 divide-y divide-slate-100 text-sm">{campuses.map((c: any) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{c.code}</b> · {c.name} · {c.city ?? ''} ({c.timezone})</span>
              {ctx.isOwner && <OwnerActions table="campuses" id={c.id} active={c.status === 'active'} path="/app/configuracion" name={`la sede ${c.name}`} />}</li>)}</ul> : <Empty>Sin sedes.</Empty>}
            <ActionForm action={createCampus} submitLabel="Crear sede">
              <Grid cols={3}>
                <Field label="Código" name="code" required /><Field label="Nombre" name="name" required className="md:col-span-2" />
                <SelectField label="País" name="country_code" required options={countries} defaultValue={org.country_code} />
                <Field label="Ciudad" name="city" /><Field label="Zona horaria" name="timezone" required defaultValue={org.timezone} />
                <Field label="Dirección" name="address" className="md:col-span-3" />
              </Grid>
            </ActionForm>
          </Card>
        )}
        {orgAdmin && (
          <Card title="Salas y laboratorios">
            {rooms?.length ? <ul className="mb-4 divide-y divide-slate-100 text-sm">{rooms.map((r: any) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{r.code}</b> · {r.name} · {r.campuses?.name} · capacidad {r.capacity}</span>
              {ctx.isOwner && <OwnerActions table="rooms" id={r.id} active={r.status === 'active'} path="/app/configuracion" name={`la sala ${r.name}`} />}</li>)}</ul> : <Empty>Sin salas.</Empty>}
            {campusOpts.length > 0 && (
              <ActionForm action={createRoom} submitLabel="Crear sala">
                <Grid cols={3}>
                  <SelectField label="Sede" name="campus_id" required options={campusOpts} />
                  <Field label="Código" name="code" required /><Field label="Nombre" name="name" required />
                  <Field label="Capacidad" name="capacity" type="number" min={1} required />
                  <SelectField label="Tipo" name="room_type" required defaultValue="classroom" options={[{ value: 'classroom', label: 'Sala de clases' }, { value: 'lab', label: 'Laboratorio' }, { value: 'auditorium', label: 'Auditorio' }]} />
                </Grid>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
