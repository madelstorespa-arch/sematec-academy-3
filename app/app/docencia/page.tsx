import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';

export const metadata = { title: 'Mis secciones' };

export default async function Page() {
  const ctx = await getContext();
  if (!ctx.teacherId) notFound();
  const { data } = await ctx.supabase.from('sections')
    .select('id, code, grades_closed_at, courses(code, name), academic_periods(code, status), campuses(name)')
    .eq('teacher_id', ctx.teacherId).order('created_at', { ascending: false });
  return (
    <>
      <PageHeader title="Mis secciones" subtitle="Libro de clases, asistencia, evaluaciones y actas" />
      <Card>{data?.length ? <table className="table"><thead><tr><th>Asignatura</th><th>Sección</th><th>Periodo</th><th>Sede</th><th>Acta</th><th></th></tr></thead>
        <tbody>{data.map((s: any) => <tr key={s.id}><td>{s.courses?.code} · {s.courses?.name}</td><td>{s.code}</td><td>{s.academic_periods?.code}</td><td>{s.campuses?.name}</td>
          <td>{s.grades_closed_at ? 'Cerrada' : 'Abierta'}</td>
          <td className="space-x-2 text-right"><Link className="btn-secondary btn-sm" href={`/app/secciones/${s.id}?t=asistencia`}>Asistencia</Link><Link className="btn-primary btn-sm" href={`/app/secciones/${s.id}?t=notas`}>Notas</Link></td></tr>)}</tbody></table>
        : <Empty>No tiene secciones asignadas.</Empty>}</Card>
    </>
  );
}
