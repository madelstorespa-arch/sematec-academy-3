import { Field, Grid, SelectField } from '@/components/forms';

type Opt = { value: string; label: string };
export function PersonFields({ campuses, countries, d = {}, codeName, codeLabel, withBirth = true }: {
  campuses: Opt[]; countries: Opt[]; d?: Record<string, any>; codeName?: string; codeLabel?: string; withBirth?: boolean;
}) {
  return (
    <Grid cols={3}>
      {codeName && <Field label={codeLabel ?? 'Código'} name={codeName} required defaultValue={d[codeName]} />}
      <Field label="Nombres" name="first_names" required defaultValue={d.first_names} />
      <Field label="Apellidos" name="last_names" required defaultValue={d.last_names} />
      <SelectField label="País del documento" name="id_document_country" required options={countries} defaultValue={d.id_document_country ?? 'CL'} />
      <Field label="Tipo de documento" name="id_document_type" required defaultValue={d.id_document_type ?? 'RUN'} placeholder="RUN, DNI, PASAPORTE…" />
      <Field label="N° de documento" name="id_document_number" required defaultValue={d.id_document_number} />
      <Field label="Correo" name="email" type="email" defaultValue={d.email} />
      <Field label="Teléfono" name="phone" defaultValue={d.phone} placeholder="+56 9 1234 5678" />
      {withBirth && <Field label="Fecha de nacimiento" name="birth_date" type="date" defaultValue={d.birth_date} />}
      <SelectField label="Sede" name="campus_id" options={campuses} defaultValue={d.campus_id} />
    </Grid>
  );
}
