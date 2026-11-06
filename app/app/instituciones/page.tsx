import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { countryOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { createOrganization } from './actions';

export const metadata = { title: 'Instituciones' };

export default async function Page() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) notFound();
  const [{ data: orgs }, countries, { data: currencies }] = await Promise.all([
    ctx.supabase.from('organizations').select('*').order('created_at'), countryOptions(ctx),
    ctx.supabase.from('currencies').select('code, name').order('code'),
  ]);
  return (
    <>
      <PageHeader title="Instituciones" subtitle="Red institucional de la plataforma (solo superadministrador)" />
      <Card title="Nueva institución" className="mb-6">
        <ActionForm action={createOrganization} submitLabel="Crear institución">
          <Grid cols={3}>
            <Field label="Razón social" name="legal_name" required /><Field label="Nombre visible" name="display_name" required />
            <Field label="Identificador (URL)" name="slug" required placeholder="sematec-chile" />
            <SelectField label="País" name="country" required options={countries} defaultValue="CL" />
            <SelectField label="Moneda base" name="currency" required defaultValue="CLP" options={(currencies ?? []).map((c: any) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
            <Field label="Zona horaria" name="timezone" required defaultValue="America/Santiago" />
            <Field label="Identificador tributario" name="tax_id" />
            <Field label="Nombre del propietario" name="owner_name" required /><Field label="Correo del propietario" name="owner_email" type="email" required />
          </Grid>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="invite" /> Invitar al propietario por correo (requiere SMTP)</label>
          <p className="text-xs text-slate-500">El superadministrador no obtiene acceso a los datos personales de la institución; solo el propietario y quienes él autorice.</p>
        </ActionForm>
      </Card>
      <Card>{orgs?.length ? <table className="table"><thead><tr><th>Institución</th><th>País</th><th>Moneda</th><th>Creada</th><th>Estado</th></tr></thead>
        <tbody>{orgs.map((o: any) => <tr key={o.id}><td><b>{o.display_name}</b><br /><span className="text-xs text-slate-500">{o.legal_name}</span></td><td>{o.country_code}</td><td>{o.base_currency}</td><td>{fmtDate(o.created_at)}</td><td><StatusBadge status={o.status} /></td></tr>)}</tbody></table>
        : <Empty>Aún no hay instituciones.</Empty>}</Card>
    </>
  );
}
