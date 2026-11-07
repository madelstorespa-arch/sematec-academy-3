import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, StatusBadge, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { PersonFields } from '@/components/person-form';
import { campusOptions, countryOptions } from '@/lib/options';
import { createStudent, grantPortalAccess, resetPortalPassword } from './actions';

export const metadata = { title: 'Estudiantes' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; nuevo?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'students.view');
  const orgId = requireOrg(ctx);
  const { q, nuevo } = await searchParams;
  let query = ctx.supabase.from('students').select('id, student_code, first_names, last_names, id_document_number, email, status, user_id, campuses(name)')
    .eq('organization_id', orgId).order('last_names').limit(200);
  if (q) query = query.or(`last_names.ilike.%${q.replace(/[%,()]/g, '')}%,first_names.ilike.%${q.replace(/[%,()]/g, '')}%,student_code.ilike.%${q.replace(/[%,()]/g, '')}%,id_document_number.ilike.%${q.replace(/[%,()]/g, '')}%`);
  const edit = can(ctx, 'students.edit');
  const [{ data: students }, campuses, countries] = await Promise.all([query, campusOptions(ctx), countryOptions(ctx)]);

  return (
    <>
      <PageHeader title="Estudiantes" subtitle="Registro estudiantil y expedientes" />
      {can(ctx, 'students.create') && (
        <details className="card mb-6" open={!!nuevo}>
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Registrar estudiante</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createStudent} submitLabel="Registrar estudiante">
              <PersonFields campuses={campuses} countries={countries} codeName="student_code" codeLabel="Código de estudiante" />
            </ActionForm>
          </div>
        </details>
      )}
      <Card>
        <form className="mb-4 flex gap-2">
          <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Buscar por nombre, código o documento" />
          <button className="btn-secondary">Buscar</button>
        </form>
        {students && students.length > 0 ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Acceso al portal</th><th>Documento</th><th>Sede</th><th>Correo</th><th>Estado</th></tr></thead>
            <tbody>{students.map((s: any) => (
              <tr key={s.id}>
                <td className="font-mono text-xs">{s.student_code}</td>
                <td><Link className="link" href={`/app/estudiantes/${s.id}`}>{s.last_names}, {s.first_names}</Link></td>
                <td>{!edit ? (s.user_id ? 'Con cuenta' : 'Sin cuenta') : s.user_id ? (
                  <ActionForm action={resetPortalPassword} inline submitLabel="🔑 Nueva contraseña" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                    <input type="hidden" name="kind" value="student" /><input type="hidden" name="id" value={s.id} />
                  </ActionForm>) : s.email ? (
                  <ActionForm action={grantPortalAccess} inline submitLabel="🔑 Crear contraseña" submitClass="btn-primary btn-sm" resetOnSuccess={false}>
                    <input type="hidden" name="kind" value="student" /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="email" value={s.email} />
                  </ActionForm>) : <Link className="link text-xs" href={`/app/estudiantes/${s.id}`}>Agregar correo</Link>}</td>
                <td>{s.id_document_number}</td><td>{s.campuses?.name ?? '—'}</td><td>{s.email ?? '—'}</td>
                <td><StatusBadge status={s.status} /></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>{q ? 'Sin resultados.' : 'Aún no hay estudiantes registrados.'}</Empty>}
      </Card>
    </>
  );
}
