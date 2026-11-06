import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, StatusBadge, Empty, Badge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { campusOptions, countryOptions } from '@/lib/options';
import { createTeacher, setTeacherStatus } from './actions';
import { grantPortalAccess, resetPortalPassword, createInstitutionalAccount } from '../estudiantes/actions';
import { workspaceEnabled, workspaceDomain } from '@/lib/workspace';

export const metadata = { title: 'Profesores' };

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'teachers.view');
  const orgId = requireOrg(ctx);
  const [{ data: teachers }, campuses, countries] = await Promise.all([
    ctx.supabase.from('teachers').select('*, campuses(name)').eq('organization_id', orgId).order('last_names'),
    campusOptions(ctx), countryOptions(ctx),
  ]);
  const edit = can(ctx, 'teachers.edit');
  const ws = workspaceEnabled() ? workspaceDomain() : null;
  return (
    <>
      <PageHeader title="Profesores" subtitle="Cuerpo docente y acceso al portal del profesor" />
      {can(ctx, 'teachers.create') && (
        <details className="card mb-6">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Registrar profesor</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createTeacher} submitLabel="Registrar profesor">
              <Grid cols={3}>
                <Field label="Código" name="teacher_code" required />
                <Field label="Nombres" name="first_names" required />
                <Field label="Apellidos" name="last_names" required />
                <SelectField label="País del documento" name="id_document_country" required options={countries} defaultValue="CL" />
                <Field label="Tipo de documento" name="id_document_type" required defaultValue="RUN" />
                <Field label="N° de documento" name="id_document_number" required />
                <Field label="Correo" name="email" type="email" required />
                <Field label="Grado académico" name="academic_degree" />
                <Field label="Especialidad" name="specialty" />
                <SelectField label="Sede" name="campus_id" options={campuses} />
              </Grid>
            </ActionForm>
          </div>
        </details>
      )}
      <Card>
        {teachers?.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Acceso al portal</th><th>Correo</th><th>Especialidad</th><th>Sede</th><th>Estado</th></tr></thead>
          <tbody>{teachers.map((t: any) => (
            <tr key={t.id}>
              <td className="font-mono text-xs">{t.teacher_code}</td><td>{t.last_names}, {t.first_names}</td>
              <td>{edit ? (t.user_id ? (
                <ActionForm action={resetPortalPassword} inline submitLabel="🔑 Nueva contraseña" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                  <input type="hidden" name="kind" value="teacher" /><input type="hidden" name="id" value={t.id} />
                </ActionForm>) : (
                <div className="flex flex-col gap-1">
                  {ws && (
                    <ActionForm action={createInstitutionalAccount} inline submitLabel={`📧 Crear correo @${ws}`} submitClass="btn-primary btn-sm" resetOnSuccess={false}>
                      <input type="hidden" name="kind" value="teacher" /><input type="hidden" name="id" value={t.id} />
                    </ActionForm>)}
                  <ActionForm action={grantPortalAccess} inline submitLabel="🔑 Crear contraseña" submitClass={ws ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} resetOnSuccess={false}>
                    <input type="hidden" name="kind" value="teacher" /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="email" value={t.email} />
                  </ActionForm>
                </div>)) : t.user_id ? <Badge color="green">Con cuenta</Badge> : <Badge>Sin cuenta</Badge>}</td>
              <td>{t.email}</td>
              <td>{t.specialty ?? '—'}</td><td>{t.campuses?.name ?? '—'}</td>
              <td>{edit ? (
                <ActionForm action={setTeacherStatus} inline submitLabel="✓" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                  <input type="hidden" name="id" value={t.id} />
                  <select name="status" defaultValue={t.status} className="input py-1 text-xs">
                    <option value="active">Activo</option><option value="inactive">Inactivo</option><option value="suspended">Suspendido</option>
                  </select>
                </ActionForm>) : <StatusBadge status={t.status} />}</td>
            </tr>))}</tbody>
        </table></div> : <Empty>Aún no hay profesores registrados.</Empty>}
      </Card>
    </>
  );
}
