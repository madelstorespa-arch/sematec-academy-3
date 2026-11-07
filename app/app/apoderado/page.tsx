import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContext } from '@/lib/context';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { fmtDate, fmtMoney, fmtNum } from '@/lib/format';

export const metadata = { title: 'Mis pupilos' };
const REL: Record<string, string> = { madre: 'Madre', padre: 'Padre', tutor: 'Tutor/a', apoderado: 'Apoderado/a', otro: 'Otro' };

export default async function Page() {
  const ctx = await getContext();
  if (!ctx.isGuardian) notFound();
  const { data: links } = await ctx.supabase.from('guardian_links').select('id, student_id, relationship')
    .eq('guardian_id', ctx.user.id).eq('status', 'activo').eq('organization_id', ctx.orgId!);
  const summaries = await Promise.all((links ?? []).map(async (l: any) => {
    const { data } = await ctx.supabase.rpc('guardian_summary', { p_student: l.student_id });
    return { link: l, s: data as any };
  }));

  return (
    <>
      <PageHeader title="Mis pupilos" subtitle="Notas publicadas, asistencia y estado de cuenta de los estudiantes a su cargo"
        actions={<Link className="btn-secondary" href="/app/mensajes">✉ Escribir a la institución</Link>} />
      {!summaries.length && <Card><Empty>No tiene estudiantes vinculados.</Empty></Card>}
      <div className="space-y-8">
        {summaries.map(({ link, s }) => {
          if (!s) return null;
          const courses = (s.courses ?? []) as any[];
          const attVals = courses.map((c) => c.attendance).filter((v) => v != null) as number[];
          const att = attVals.length ? attVals.reduce((a, b) => a + Number(b), 0) / attVals.length : null;
          return (
            <section key={link.id}>
              <h2 className="mb-3 text-xl font-bold">{s.student?.name} <span className="text-sm font-normal text-slate-500">· {s.student?.code} · {REL[link.relationship]}</span></h2>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Stat label="Asignaturas" value={courses.length} />
                <Stat label="Asistencia promedio" value={att != null ? `${fmtNum(att)}%` : '—'} hint={att != null && att < 75 ? '⚠ Bajo el mínimo habitual' : undefined} />
                <Stat label="Saldo pendiente" value={fmtMoney(s.balance)} hint={s.overdue ? `⚠ ${s.overdue} cuota(s) vencida(s)` : s.next_due ? `Próximo vencimiento ${fmtDate(s.next_due)}` : 'Al día'} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {courses.length ? courses.map((c, i) => {
                  const graded = (c.grades as any[]).filter((g) => g.grade != null);
                  const w = graded.reduce((a, g) => a + Number(g.weight), 0);
                  const avg = w ? graded.reduce((a, g) => a + Number(g.grade) * Number(g.weight), 0) / w : null;
                  return (
                    <Card key={i} title={`${c.course} · ${c.section}`} actions={c.attendance != null
                      ? <Badge color={Number(c.attendance) >= 75 ? 'green' : 'red'}>Asistencia {fmtNum(c.attendance)}%</Badge> : undefined}>
                      {(c.grades as any[]).length ? (
                        <table className="table"><thead><tr><th>Evaluación</th><th className="text-right">Peso</th><th className="text-right">Nota</th></tr></thead>
                          <tbody>{(c.grades as any[]).map((g, k) => (
                            <tr key={k}><td>{g.name}</td><td className="text-right">{fmtNum(g.weight, 0)}%</td>
                              <td className={`text-right font-semibold ${g.grade != null && Number(g.grade) < 4 ? 'text-red-700' : ''}`}>{g.grade != null ? fmtNum(g.grade) : '—'}</td></tr>))}
                          </tbody></table>
                      ) : <Empty>Sin evaluaciones publicadas.</Empty>}
                      {avg != null && <p className="mt-2 text-right text-sm">Promedio parcial: <b className={avg < 4 ? 'text-red-700' : ''}>{fmtNum(avg)}</b></p>}
                    </Card>);
                }) : <Card><Empty>Sin asignaturas inscritas.</Empty></Card>}
              </div>
            </section>);
        })}
      </div>
    </>
  );
}
