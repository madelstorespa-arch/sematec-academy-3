import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, StatusBadge, Empty } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { PersonFields } from '@/components/person-form';
import { docLabel } from '@/lib/identity';
import { campusOptions, countryOptions } from '@/lib/options';
import { createStudent } from './actions';
import { AccessForm } from '@/components/access-form';
import { OwnerActions } from '@/components/owner-actions';

export const metadata = { title: 'Estudiantes' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; nuevo?: string; acceso?: string; estado?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'students.view');
  const orgId = requireOrg(ctx);
  const { q, nuevo, acceso, estado } = await searchParams;
  let query = ctx.supabase.from('students').select('id, student_code, first_names, last_names, email, status, user_id, id_document_type, id_document_number, campuses(name)')
    .eq('organization_id', orgId).order('last_names').limit(300);
  if (q) { const t = q.replace(/[%,()]/g, ''); query = query.or(`last_names.ilike.%${t}%,first_names.ilike.%${t}%,student_code.ilike.%${t}%,email.ilike.%${t}%,id_document_number.ilike.%${t}%`); }
  if (acceso === 'con') query = query.not('user_id', 'is', null);
  if (acceso === 'sin') query = query.is('user_id', null);
  if (estado) query = query.eq('status', estado);
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
              <PersonFields campuses={campuses} codeName="student_code" codeLabel="Código de estudiante" withAccount docRequired />
            </ActionForm>
          </div>
        </details>
      )}
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Buscar por nombre, código o correo" />
          <select className="input max-w-[11rem]" name="acceso" defaultValue={acceso ?? ''}><option value="">Con y sin cuenta</option><option value="con">🔑 Con cuenta y contraseña</option><option value="sin">Sin cuenta</option></select>
          <select className="input max-w-[10rem]" name="estado" defaultValue={estado ?? ''}><option value="">Todos los estados</option><option value="active">Activos</option><option value="suspended">Suspendidos</option><option value="graduated">Egresados</option><option value="withdrawn">Retirados</option><option value="inactive">Inactivos</option></select>
          <button className="btn-secondary">Filtrar</button>
          {(q || acceso || estado) && <a className="btn-secondary" href="/app/estudiantes">Limpiar</a>}
        </form>
        {students && students.length > 0 ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Cuenta y contraseña</th><th>Sede</th><th>Correo</th><th>Estado</th>{ctx.isOwner && <th>Propietario</th>}</tr></thead>
            <tbody>{students.map((s: any) => (
              <tr key={s.id}>
                <td className="font-mono text-xs">{s.student_code}</td>
                <td><Link className="link" href={`/app/estudiantes/${s.id}`}>{s.last_names}, {s.first_names}</Link>{s.id_document_number && <span className="block text-xs text-slate-500">{docLabel(s.id_document_type).split(' ')[0]} {s.id_document_number}</span>}</td>
                <td>{!edit ? (s.user_id ? 'Con cuenta' : 'Sin cuenta') : (s.user_id || s.email) ? <AccessForm kind="student" id={s.id} email={s.email} hasAccount={!!s.user_id} />
                  : <Link className="link text-xs" href={`/app/estudiantes/${s.id}`}>Agregar correo</Link>}</td>
                <td>{s.campuses?.name ?? '—'}</td><td>{s.email ?? '—'}</td>
                <td><StatusBadge status={s.status} /></td>
                {ctx.isOwner && <td><OwnerActions table="students" id={s.id} active={s.status === 'active'} path="/app/estudiantes" name={`a ${s.first_names} ${s.last_names}`} /></td>}
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>{q ? 'Sin resultados.' : 'Aún no hay estudiantes registrados.'}</Empty>}
      </Card>
    </>
  );
}
