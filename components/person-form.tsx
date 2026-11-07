import { Field, Grid, SelectField } from '@/components/forms';

// El N° de documento ya no se pide (decisión de la institución); `countries` se mantiene por compatibilidad.

type Opt = { value: string; label: string };
export function PersonFields({ campuses, countries, d = {}, codeName, codeLabel, withBirth = true }: {
  campuses: Opt[]; countries: Opt[]; d?: Record<string, any>; codeName?: string; codeLabel?: string; withBirth?: boolean;
}) {
  return (
    <Grid cols={3}>
      {codeName && <Field label={codeLabel ?? 'Código'} name={codeName} required defaultValue={d[codeName]} />}
      <Field label="Nombres" name="first_names" required defaultValue={d.first_names} />
      <Field label="Apellidos" name="last_names" required defaultValue={d.last_names} />
      <Field label="Correo" name="email" type="email" defaultValue={d.email} />
      <Field label="Teléfono" name="phone" defaultValue={d.phone} placeholder="+56 9 1234 5678" />
      {withBirth && <Field label="Fecha de nacimiento" name="birth_date" type="date" defaultValue={d.birth_date} />}
      <SelectField label="Sede" name="campus_id" options={campuses} defaultValue={d.campus_id} />
    </Grid>
  );
}
