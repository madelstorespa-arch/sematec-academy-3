import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { periodOptions } from '@/lib/options';
import { fmtMoney, fmtNum } from '@/lib/format';

export const metadata = { title: 'Reportes' };

export default async function Page({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const ctx = await getContext();
  requirePerm(ctx, 'reports.view');
  const orgId = requireOrg(ctx);
  const periods = await periodOptions(ctx);
  const periodo = (await searchParams).periodo ?? periods[0]?.value;
  const [enr, acad, fin] = await Promise.all([
    periodo ? ctx.supabase.rpc('report_enrollment_summary', { p_org: orgId, p_period: periodo }) : Promise.resolve({ data: [] }),
    periodo ? ctx.supabase.rpc('report_academic_summary', { p_org: orgId, p_period: periodo }) : Promise.resolve({ data: [] }),
    can(ctx, 'finance.view') ? ctx.supabase.rpc('report_finance_summary', { p_org: orgId }) : Promise.resolve({ data: null }),
  ]);
  return (
    <>
      <PageHeader title="Reportes" subtitle="Indicadores calculados con la información almacenada" />
      <form className="mb-6 flex gap-2"><select name="periodo" defaultValue={periodo} className="input max-w-xs">{periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select><button className="btn-secondary">Ver</button></form>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Matrícula por programa">
          {(enr.data as any[])?.length ? <table className="table"><thead><tr><th>Programa</th><th>Activos</th><th>Suspendidos</th><th>Retirados</th><th>Total</th></tr></thead>
            <tbody>{(enr.data as any[]).map((r) => <tr key={r.program_code}><td>{r.program_code} · {r.program_name}</td><td>{r.active}</td><td>{r.suspended}</td><td>{r.withdrawn}</td><td className="font-bold">{r.total}</td></tr>)}</tbody></table> : <Empty>Sin datos.</Empty>}
        </Card>
        {fin.data && (
          <Card title="Finanzas">
            {(fin.data as any[]).length ? <table className="table"><thead><tr><th>Moneda</th><th>Facturado</th><th>Recaudado</th><th>Por cobrar</th><th>Vencido</th><th>Morosos</th></tr></thead>
              <tbody>{(fin.data as any[]).map((r) => <tr key={r.currency}><td>{r.currency}</td><td>{fmtMoney(r.billed, r.currency)}</td><td>{fmtMoney(r.collected, r.currency)}</td><td>{fmtMoney(r.outstanding, r.currency)}</td><td className="text-red-600">{fmtMoney(r.overdue, r.currency)}</td><td>{r.students_overdue}</td></tr>)}</tbody></table> : <Empty>Sin datos.</Empty>}
          </Card>
        )}
        <Card title="Rendimiento académico por sección" className="xl:col-span-2">
          {(acad.data as any[])?.length ? <table className="table"><thead><tr><th>Asignatura</th><th>Sección</th><th>Estudiantes</th><th>Aprobados</th><th>Reprobados</th><th>Tasa aprobación</th><th>Promedio</th><th>Asistencia</th></tr></thead>
            <tbody>{(acad.data as any[]).map((r) => <tr key={r.course_code + r.section_code}><td>{r.course_code}</td><td>{r.section_code}</td><td>{r.students}</td><td>{r.approved}</td><td>{r.failed}</td>
              <td>{r.approved + r.failed ? `${Math.round((100 * r.approved) / (r.approved + r.failed))} %` : '—'}</td><td>{fmtNum(r.avg_grade)}</td><td>{r.avg_attendance != null ? `${fmtNum(r.avg_attendance, 0)} %` : '—'}</td></tr>)}</tbody></table> : <Empty>Sin datos.</Empty>}
        </Card>
      </div>
    </>
  );
}
