import { Field, Grid, SelectField } from '@/components/forms';

// El N° de documento no se pide (decisión de la institución).

type Opt = { value: string; label: string };
export function PersonFields({ campuses, d = {}, codeName, codeLabel, withBirth = true, withAccount = false }: {
  campuses: Opt[]; countries?: Opt[]; d?: Record<string, any>; codeName?: string; codeLabel?: string; withBirth?: boolean;
  /** Formulario de alta: correo obligatorio + contraseña para crear su cuenta. */
  withAccount?: boolean;
}) {
  return (
    <Grid cols={3}>
      {codeName && <Field label={codeLabel ?? 'Código'} name={codeName} required defaultValue={d[codeName]} />}
      <Field label="Nombres" name="first_names" required defaultValue={d.first_names} />
      <Field label="Apellidos" name="last_names" required defaultValue={d.last_names} />
      <Field label={withAccount ? 'Correo (será su usuario)' : 'Correo'} name="email" type="email" required={withAccount} defaultValue={d.email} />
      {withAccount && <Field label="Contraseña de su cuenta" name="password" type="password" required autoComplete="new-password" placeholder="Mín. 10, con mayúsculas, minúsculas y números" />}
      <Field label="Teléfono" name="phone" defaultValue={d.phone} placeholder="+56 9 1234 5678" />
      {withBirth && <Field label="Fecha de nacimiento" name="birth_date" type="date" defaultValue={d.birth_date} />}
      <SelectField label="Sede" name="campus_id" options={campuses} defaultValue={d.campus_id} />
    </Grid>
  );
}
