import { Field, Grid, SelectField } from '@/components/forms';
import { DOC_TYPES } from '@/lib/identity';

type Opt = { value: string; label: string };
export function PersonFields({ campuses, d = {}, codeName, codeLabel, withBirth = true, withAccount = false, docRequired = false }: {
  campuses: Opt[]; countries?: Opt[]; d?: Record<string, any>; codeName?: string; codeLabel?: string; withBirth?: boolean;
  /** Matrícula y postulación: la identificación es obligatoria. */
  docRequired?: boolean;
  /** Formulario de alta: correo obligatorio + contraseña para crear su cuenta. */
  withAccount?: boolean;
}) {
  return (
    <Grid cols={3}>
      {codeName && <Field label={codeLabel ?? 'Código'} name={codeName} required defaultValue={d[codeName]} />}
      <Field label="Nombres" name="first_names" required defaultValue={d.first_names} />
      <Field label="Apellidos" name="last_names" required defaultValue={d.last_names} />
      <SelectField label="Documento de identidad" name="id_document_type" required={docRequired} defaultValue={d.id_document_type ?? 'RUN'}
        options={DOC_TYPES.map(([value, label]) => ({ value, label }))} placeholder={docRequired ? undefined : '— Sin documento —'} />
      <Field label="N° de documento (RUT, pasaporte…)" name="id_document_number" required={docRequired} defaultValue={d.id_document_number} placeholder="Ej.: 12.345.678-5" />
      <Field label={withAccount ? 'Correo (será su usuario)' : 'Correo'} name="email" type="email" required={withAccount} defaultValue={d.email} />
      {withAccount && <Field label="Contraseña de su cuenta" name="password" type="password" required autoComplete="new-password" placeholder="Mín. 10, con mayúsculas, minúsculas y números" />}
      <Field label="Teléfono" name="phone" defaultValue={d.phone} placeholder="+56 9 1234 5678" />
      {withBirth && <Field label="Fecha de nacimiento" name="birth_date" type="date" defaultValue={d.birth_date} />}
      <SelectField label="Sede" name="campus_id" options={campuses} defaultValue={d.campus_id} />
    </Grid>
  );
}
