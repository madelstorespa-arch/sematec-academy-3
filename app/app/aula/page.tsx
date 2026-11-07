import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';

export const metadata = { title: 'Aula de aprendizaje' };

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  let q = ctx.supabase.from('sections').select('id, code, courses(code, name), academic_periods(name), teachers(first_names, last_names)').eq('organization_id', orgId).limit(300);
  if (ctx.studentId && !ctx.teacherId && !can(ctx, 'sections.view')) {
    const { data: se } = await ctx.supabase.from('section_enrollments').select('section_id').eq('student_id', ctx.studentId).neq('status', 'dropped');
    q = q.in('id', (se ?? []).map((x: any) => x.section_id).concat(['00000000-0000-0000-0000-000000000000']));
  } else if (ctx.teacherId && !can(ctx, 'sections.view')) q = q.eq('teacher_id', ctx.teacherId);
  const { data: sections } = await q;
  return (
    <>
      <PageHeader title="Aula de aprendizaje" subtitle="Contenidos, tareas, exámenes en línea y foros de cada curso" />
      {sections?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s: any) => (
            <Link key={s.id} href={`/app/aula/${s.id}`} className="card card-pad block transition hover:border-brand-500">
              <p className="text-xs font-bold text-brand-600">{s.courses?.code} · Sección {s.code}</p>
              <h2 className="mt-1 text-lg font-bold">{s.courses?.name}</h2>
              <p className="mt-2 text-sm text-slate-500">{s.academic_periods?.name}{s.teachers && ` · ${s.teachers.first_names} ${s.teachers.last_names}`}</p>
            </Link>))}
        </div>
      ) : can(ctx, 'sections.create') ? (
        <Card title="Aún no hay cursos: créelos en 5 pasos">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li><Link className="link" href="/app/academico">Oferta académica</Link>: cree el programa, la asignatura y el periodo.</li>
            <li><Link className="link" href="/app/profesores">Profesores</Link>: registre al profesor y use «Crear contraseña».</li>
            <li><Link className="link" href="/app/secciones">Secciones y notas</Link>: cree la sección (asignatura + periodo + profesor).</li>
            <li><Link className="link" href="/app/estudiantes">Estudiantes</Link> y <Link className="link" href="/app/matriculas">Matrículas</Link>: registre y matricule. Si el estudiante debe entrar a la plataforma, use «Crear contraseña» en Estudiantes.</li>
            <li>Abra la sección e <b>inscriba</b> a los estudiantes. El curso aparecerá aquí con Contenidos, Tareas, Exámenes y Foro.</li>
          </ol>
        </Card>
      ) : <Card><Empty>Aún no tiene cursos. Aparecerán aquí cuando la institución lo inscriba en una sección.</Empty></Card>}
    </>
  );
}
