import { notFound } from 'next/navigation';
import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { getContext, can, requirePerm } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, Field, SelectField } from '@/components/forms';
import { courseOptions } from '@/lib/options';
import { addCurriculumCourse, removeCurriculumCourse } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  requirePerm(ctx, 'academic.view');
  const { data: p } = await ctx.supabase.from('programs').select('*, curricula(id, version, valid_from, min_attendance_pct, status, curriculum_courses(term_number, is_mandatory, courses(id, code, name, credits)))').eq('id', id).maybeSingle();
  if (!p) notFound();
  const courses = await courseOptions(ctx);
  return (
    <>
      <PageHeader title={`${p.code} · ${p.name}`} subtitle="Mallas curriculares" actions={<Link className="btn-secondary" href="/app/academico">Volver</Link>} />
      {p.curricula.map((c: any) => {
        const byTerm = [...c.curriculum_courses].sort((a: any, b: any) => a.term_number - b.term_number);
        const credits = byTerm.reduce((a: number, r: any) => a + Number(r.courses.credits), 0);
        return (
          <Card key={c.id} title={`Malla ${c.version} · ${credits} créditos · asistencia mínima ${c.min_attendance_pct} %`} className="mb-6"
            actions={ctx.isOwner ? <OwnerActions table="curricula" id={c.id} active={c.status !== 'inactive'} path={`/app/academico/programas/${p.id}`} name={`la malla ${c.version}`} /> : undefined}>
            {byTerm.length ? <table className="table mb-4"><thead><tr><th>Periodo</th><th>Asignatura</th><th>Créditos</th><th>Tipo</th><th></th></tr></thead>
              <tbody>{byTerm.map((r: any) => <tr key={r.courses.id}><td>{r.term_number}</td><td>{r.courses.code} · {r.courses.name}</td><td>{r.courses.credits}</td><td>{r.is_mandatory ? 'Obligatoria' : 'Electiva'}</td>
                <td className="text-right">{can(ctx, 'academic.admin') && (
                  <ActionForm action={removeCurriculumCourse} inline submitLabel="Quitar" submitClass="btn-secondary btn-sm" confirm="¿Quitar la asignatura de la malla?">
                    <input type="hidden" name="curriculum_id" value={c.id} /><input type="hidden" name="course_id" value={r.courses.id} />
                  </ActionForm>)}</td></tr>)}</tbody></table> : <Empty>La malla aún no tiene asignaturas.</Empty>}
            {can(ctx, 'academic.edit') && (
              <ActionForm action={addCurriculumCourse} inline submitLabel="Agregar a la malla">
                <input type="hidden" name="curriculum_id" value={c.id} />
                <SelectField label="Asignatura" name="course_id" required options={courses} className="min-w-64" />
                <Field label="Periodo N°" name="term_number" type="number" min={1} max={20} required className="w-28" />
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="is_mandatory" defaultChecked /> Obligatoria</label>
              </ActionForm>
            )}
          </Card>
        );
      })}
    </>
  );
}
