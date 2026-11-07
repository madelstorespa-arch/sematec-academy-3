import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { createSurvey } from './actions';

export const metadata = { title: 'Encuestas' };
const AUD: Record<string, string> = { all: 'Toda la comunidad', students: 'Estudiantes', teachers: 'Profesores', staff: 'Personal', section: 'Sección' };

function state(s: any) {
  const now = Date.now();
  if (!s.published) return <Badge>Borrador</Badge>;
  if (now < new Date(s.opens_at).getTime()) return <Badge color="blue">Programada</Badge>;
  if (now > new Date(s.closes_at).getTime()) return <Badge color="gray">Cerrada</Badge>;
  return <Badge color="green">Abierta</Badge>;
}

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const manage = can(ctx, 'surveys.view');
  const sb = ctx.supabase;
  const [{ data: surveys }, { data: mine }, { data: sections }, { data: open }] = await Promise.all([
    sb.from('surveys').select('*, sections(code, teacher_id, courses(name))').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(300),
    sb.from('survey_participation').select('survey_id, user_id'),
    can(ctx, 'surveys.create')
      ? sb.from('sections').select('id, code, courses(name), teachers(first_names, last_names)').eq('organization_id', orgId).eq('status', 'active').order('code').limit(300)
      : Promise.resolve({ data: [] as any[] }),
    sb.rpc('my_open_surveys', { p_org: orgId }),
  ]);
  const answered = new Set((mine ?? []).filter((p: any) => p.user_id === ctx.user.id).map((p: any) => p.survey_id));
  const counts = new Map<string, number>();
  for (const p of mine ?? []) counts.set(p.survey_id, (counts.get(p.survey_id) ?? 0) + 1);
  const all = surveys ?? [];
  const toAnswer = (open ?? []) as any[];
  const myEvaluations = ctx.teacherId ? all.filter((s: any) => s.section_id && s.sections?.teacher_id === ctx.teacherId && s.published) : [];
  const sectionOpts = [{ value: '__all', label: '— Todas las secciones activas —' },
    ...(sections ?? []).map((s: any) => ({ value: s.id, label: `${s.code} · ${s.courses?.name ?? ''}${s.teachers ? ` · ${s.teachers.first_names} ${s.teachers.last_names}` : ''}` }))];

  return (
    <>
      <PageHeader title="Encuestas" subtitle="Encuestas de satisfacción y evaluación docente. Las anónimas no guardan quién respondió qué." />

      {can(ctx, 'surveys.create') && (
        <details className="card mb-6">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nueva encuesta o evaluación docente</summary>
          <div className="border-t border-slate-100 p-5">
            <ActionForm action={createSurvey} submitLabel="Crear">
              <SelectField label="Tipo" name="template" required defaultValue="docente"
                options={[{ value: 'docente', label: 'Evaluación docente (8 preguntas listas, anónima)' }, { value: 'libre', label: 'Encuesta libre (usted escribe las preguntas)' }]} />
              <Field label="Título" name="title" placeholder="Ej.: Evaluación docente 1er semestre / Satisfacción con la biblioteca" />
              <TextArea label="Descripción (opcional)" name="description" rows={2} />
              <Grid cols={3}>
                <SelectField label="Sección (obligatoria en evaluación docente)" name="section_id" options={sectionOpts} placeholder="Sin sección" />
                <SelectField label="Dirigida a (encuesta libre sin sección)" name="audience" defaultValue="all" required
                  options={Object.entries(AUD).filter(([k]) => k !== 'section').map(([value, label]) => ({ value, label }))} />
                <Field label="Cierra el" name="closes_at" type="datetime-local" required />
              </Grid>
              <div className="flex flex-wrap gap-6 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="anonymous" defaultChecked /> Anónima</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="published" /> Publicar de inmediato</label>
              </div>
            </ActionForm>
          </div>
        </details>
      )}

      <Card title="Por responder">
        {toAnswer.length ? (
          <ul className="divide-y divide-slate-100">
            {toAnswer.map((s: any) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div><p className="font-semibold">{s.title}</p><p className="text-xs text-slate-500">Cierra {fmtDateTime(s.closes_at)}{s.anonymous ? ' · Anónima' : ''}</p></div>
                <Link className="btn-primary btn-sm" href={`/app/encuestas/${s.id}/responder`}>Responder</Link>
              </li>
            ))}
          </ul>
        ) : <Empty>No tiene encuestas pendientes. {answered.size ? `Ha respondido ${answered.size}.` : ''}</Empty>}
      </Card>

      {myEvaluations.length > 0 && (
        <Card title="Mis evaluaciones docentes" className="mt-6">
          <ul className="divide-y divide-slate-100">
            {myEvaluations.map((s: any) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div><p className="font-semibold">{s.title}</p><p className="text-xs text-slate-500">{state(s)}</p></div>
                <Link className="btn-secondary btn-sm" href={`/app/encuestas/${s.id}`}>Ver resultados</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {manage && (
        <Card title="Todas las encuestas" className="mt-6">
          {all.length ? (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Título</th><th>Para</th><th>Estado</th><th>Cierra</th><th className="text-right">Respuestas</th><th></th></tr></thead>
              <tbody>{all.map((s: any) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.title}{s.anonymous && <span className="ml-2 text-xs text-slate-400">anónima</span>}</td>
                  <td>{s.audience === 'section' ? `Sección ${s.sections?.code ?? ''}` : AUD[s.audience]}</td>
                  <td>{state(s)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(s.closes_at)}</td>
                  <td className="text-right font-semibold">{counts.get(s.id) ?? 0}</td>
                  <td className="space-y-1"><Link className="link" href={`/app/encuestas/${s.id}`}>Abrir</Link>
                    {ctx.isOwner && <OwnerActions table="surveys" id={s.id} active={s.published} path="/app/encuestas" name={`la encuesta ${s.title}`} />}</td>
                </tr>))}
              </tbody>
            </table></div>
          ) : <Empty>Aún no hay encuestas. Cree la primera arriba.</Empty>}
        </Card>
      )}
    </>
  );
}
