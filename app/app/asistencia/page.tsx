import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Stat, Tabs } from '@/components/ui';
import { ActionForm, Field } from '@/components/forms';
import { OwnerActions } from '@/components/owner-actions';
import { fmtDate, fmtDateTime, fmtNum, label } from '@/lib/format';
import { checkin } from './actions';
import { studentReport, teacherReport, staffReport, type Filters } from './data';

export const dynamic = 'force-dynamic';

const SRC: Record<string, string> = { teacher: 'Profesor', qr: '📱 QR', virtual: '🎥 Aula virtual', admin: 'Administración' };
const ST_COLOR: Record<string, 'green' | 'amber' | 'red' | 'blue'> = { present: 'green', late: 'amber', absent: 'red', excused: 'blue' };

export default async function AsistenciaPage({ searchParams }: { searchParams: Promise<Filters & { t?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const staffView = ctx.isOwner || can(ctx, 'attendance.view') || can(ctx, 'reports.view');
  const teacherView = staffView || !!ctx.teacherId;
  const hrView = ctx.isOwner || can(ctx, 'employees.view');

  // ---------------- Estudiante: marcar y ver su asistencia ----------------
  if (!teacherView) {
    const { data } = await ctx.supabase.rpc('my_attendance');
    const rows = (data ?? []) as { section_label: string; starts_at: string; topic: string | null; status: string; source: string }[];
    const byCourse = new Map<string, { att: number; den: number }>();
    for (const r of rows) {
      const c = byCourse.get(r.section_label) ?? { att: 0, den: 0 };
      if (r.status !== 'excused') { c.den++; if (r.status === 'present' || r.status === 'late') c.att++; }
      byCourse.set(r.section_label, c);
    }
    return (
      <div>
        <PageHeader title="✅ Mi asistencia" subtitle="Marque su asistencia con el código o el QR que muestra el profesor, y revise su porcentaje por asignatura." />
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Marcar asistencia">
            {ctx.studentId ? (
              <ActionForm action={checkin} submitLabel="✅ Marcar" submitClass="btn-primary w-full">
                <Field label="Código de la clase (6 caracteres)" name="code" required placeholder="Ej.: K7P2QX" autoComplete="off" />
              </ActionForm>
            ) : <p className="text-sm text-slate-600">Solo los estudiantes marcan asistencia en clases. Si es funcionario, marque su entrada y salida en <Link className="link" href="/app/personal">Personal</Link>.</p>}
          </Card>
          <Card title="Porcentaje por asignatura" className="lg:col-span-2">
            {byCourse.size ? <ul className="divide-y divide-slate-100 text-sm">{[...byCourse].map(([k, v]) => {
              const p = v.den ? Math.round((100 * v.att) / v.den) : null;
              return <li key={k} className="flex justify-between py-2"><span>{k}</span><b className={p != null && p < 75 ? 'text-red-600' : 'text-emerald-700'}>{p != null ? `${p} %` : '—'}</b></li>;
            })}</ul> : <Empty>Aún no tiene asistencia registrada.</Empty>}
          </Card>
        </div>
        <Card title="Detalle de clases" className="mt-6">
          {rows.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Fecha</th><th>Asignatura</th><th>Tema</th><th>Estado</th><th>Registro</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td>{fmtDateTime(r.starts_at)}</td><td>{r.section_label}</td><td>{r.topic ?? '—'}</td>
              <td><Badge color={ST_COLOR[r.status]}>{label(r.status)}</Badge></td><td className="text-xs">{SRC[r.source] ?? r.source}</td></tr>)}</tbody></table></div>
            : <Empty>Sin clases registradas.</Empty>}
        </Card>
      </div>
    );
  }

  // ---------------- Profesores y administración ----------------
  const t = sp.t ?? 'estudiantes';
  const q = new URLSearchParams(Object.entries({ desde: sp.desde ?? '', hasta: sp.hasta ?? '', seccion: sp.seccion ?? '' }).filter(([, v]) => v)).toString();
  const tabs = [['estudiantes', 'Estudiantes'], ['alertas', '⚠ Alertas'], ['profesores', 'Profesores'], ...(hrView ? [['personal', 'Personal']] : [])]
    .map(([key, l]) => ({ key, label: l, href: `/app/asistencia?t=${key}${q ? `&${q}` : ''}` }));
  let secQ = ctx.supabase.from('sections').select('id, code, courses(code, name)').eq('organization_id', orgId).order('code').limit(500);
  if (!staffView && ctx.teacherId) secQ = secQ.eq('teacher_id', ctx.teacherId);
  const { data: secs } = await secQ;

  const filters = (
    <form className="mb-5 flex flex-wrap items-end gap-2">
      <input type="hidden" name="t" value={t} />
      <label className="block"><span className="label">Desde</span><input type="date" name="desde" defaultValue={sp.desde} className="input" /></label>
      <label className="block"><span className="label">Hasta</span><input type="date" name="hasta" defaultValue={sp.hasta} className="input" /></label>
      {(t === 'estudiantes' || t === 'alertas') && (
        <label className="block"><span className="label">Sección</span>
          <select name="seccion" defaultValue={sp.seccion ?? ''} className="input max-w-xs"><option value="">Todas</option>
            {(secs ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.courses?.code} · {s.courses?.name} ({s.code})</option>)}</select></label>)}
      <button className="btn-secondary">Ver</button>
      <a className="btn-secondary" href={`/app/asistencia/exportar?tipo=${t === 'alertas' ? 'estudiantes' : t}${q ? `&${q}` : ''}`} data-testid="exportar">⬇ Descargar Excel</a>
    </form>
  );

  let body: React.ReactNode = null;
  if (t === 'estudiantes' || t === 'alertas') {
    const { rows: all, error } = await studentReport(ctx, sp);
    const rows = t === 'alertas' ? all.filter((r) => r.below) : all;
    const avg = all.filter((r) => r.pct != null);
    body = (
      <>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Stat label="Estudiantes en secciones" value={all.length} />
          <Stat label="Asistencia promedio" value={avg.length ? `${fmtNum(avg.reduce((a, r) => a + Number(r.pct), 0) / avg.length, 1)} %` : '—'} />
          <Stat label="Bajo el mínimo" value={all.filter((r) => r.below).length} hint="Riesgo de reprobar por asistencia" />
        </div>
        <Card>
          {error ? <p className="text-sm text-red-700">{error.message}</p> : rows.length ? (
            <div className="overflow-x-auto"><table className="table" data-testid="tabla-asistencia">
              <thead><tr><th>Asignatura</th><th>Estudiante</th><th>Clases</th><th>Presente</th><th>Atraso</th><th>Ausente</th><th>Justif.</th><th>%</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={`${r.section_id}-${r.student_id}`} className={r.below ? 'bg-red-50' : ''}>
                  <td className="text-xs"><Link className="link" href={`/app/secciones/${r.section_id}?t=asistencia`}>{r.section_label}</Link></td>
                  <td>{r.student_name} <span className="text-xs text-slate-500">{r.student_code}</span></td>
                  <td>{r.sessions}</td><td>{r.present}</td><td>{r.late}</td><td>{r.absent}</td><td>{r.excused}</td>
                  <td>{r.pct != null ? <b className={r.below ? 'text-red-700' : 'text-emerald-700'}>{fmtNum(r.pct, 1)} %</b> : '—'}
                    {r.below && <Badge color="red">bajo {fmtNum(r.min_pct, 0)} %</Badge>}</td>
                </tr>))}</tbody></table></div>
          ) : <Empty>{t === 'alertas' ? '¡Sin alertas! Nadie está bajo el mínimo de asistencia.' : 'No hay clases registradas en este rango.'}</Empty>}
        </Card>
      </>
    );
  } else if (t === 'profesores') {
    const { rows, error } = await teacherReport(ctx, sp);
    body = (
      <Card>
        {error ? <p className="text-sm text-red-700">{error.message}</p> : rows.length ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Profesor</th><th>Programadas</th><th>Dictadas</th><th>Suspendidas</th><th>Pendientes</th><th>Horas dictadas</th><th>Cumplimiento</th><th>Última clase</th></tr></thead>
            <tbody>{rows.map((r) => {
              const done = r.scheduled - r.pending > 0 ? Math.round((100 * r.held) / (r.scheduled - r.pending)) : null;
              return <tr key={r.teacher_id}><td>{r.teacher_name}</td><td>{r.scheduled}</td><td>{r.held}</td><td>{r.cancelled}</td><td>{r.pending}</td>
                <td>{fmtNum(r.hours, 1)} h</td><td>{done != null ? <b className={done < 90 ? 'text-red-700' : 'text-emerald-700'}>{done} %</b> : '—'}</td><td>{r.last_class ? fmtDateTime(r.last_class) : '—'}</td></tr>;
            })}</tbody></table></div>
        ) : <Empty>No hay clases registradas en este rango.</Empty>}
        <p className="mt-3 text-xs text-slate-500">Una clase cuenta como dictada cuando el profesor marca «Iniciar/Terminar clase» o guarda la asistencia. Las suspendidas no cuentan para la asistencia de los estudiantes.</p>
      </Card>
    );
  } else if (t === 'personal' && hrView) {
    const { rows, error } = await staffReport(ctx, sp);
    let q2 = ctx.supabase.from('staff_attendance').select('id, work_date, check_in, check_out, notes, employees(first_names, last_names)')
      .eq('organization_id', orgId).order('work_date', { ascending: false }).order('check_in', { ascending: false }).limit(200);
    if (sp.desde) q2 = q2.gte('work_date', sp.desde);
    if (sp.hasta) q2 = q2.lte('work_date', sp.hasta);
    const { data: marks } = await q2;
    body = (
      <div className="space-y-6">
        <Card title="Resumen por funcionario">
          {error ? <p className="text-sm text-red-700">{error.message}</p> : rows.length ? (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Funcionario</th><th>Cargo</th><th>Días</th><th>Sin marcar salida</th><th>Horas</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.employee_id}><td>{r.employee_name}</td><td>{r.job_title ?? '—'}</td><td>{r.days}</td>
                <td>{r.open_days ? <Badge color="amber">{r.open_days}</Badge> : 0}</td><td>{fmtNum(r.hours, 1)} h</td></tr>)}</tbody></table></div>
          ) : <Empty>No hay funcionarios activos.</Empty>}
        </Card>
        <Card title="Marcajes (entrada y salida)">
          {marks?.length ? <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Fecha</th><th>Funcionario</th><th>Entrada</th><th>Salida</th><th>Nota</th>{ctx.isOwner && <th></th>}</tr></thead>
            <tbody>{marks.map((m: any) => <tr key={m.id}><td>{fmtDate(m.work_date)}</td><td>{m.employees?.last_names}, {m.employees?.first_names}</td>
              <td>{new Date(m.check_in).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{m.check_out ? new Date(m.check_out).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }) : <Badge color="amber">Sin salida</Badge>}</td>
              <td className="text-xs">{m.notes ?? ''}</td>
              {ctx.isOwner && <td><OwnerActions table="staff_attendance" id={m.id} path="/app/asistencia?t=personal" name="este marcaje" /></td>}</tr>)}</tbody></table></div>
            : <Empty>No hay marcajes en este rango.</Empty>}
          <p className="mt-3 text-xs text-slate-500">Cada funcionario marca su entrada y salida en <Link className="link" href="/app/personal">Personal y RR. HH.</Link> El propietario puede corregir un marcaje con ✏️ Editar (queda en el historial).</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="✅ Asistencia" subtitle="Estudiantes, profesores y personal: porcentajes, alertas y descarga a Excel." />
      <Tabs items={tabs} current={t} />
      {filters}
      {body}
      <Card title="¿Cómo se toma la asistencia?" className="mt-6">
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
          <li><b>Profesor pasa lista</b> en la sección → «Libro de clases y asistencia».</li>
          <li><b>📱 QR:</b> en la misma pantalla, «Asistencia con QR»: los estudiantes lo escanean o escriben el código. Después de 15 minutos queda como atraso.</li>
          <li><b>🎥 Aula virtual:</b> si la clase se dictó en el aula virtual, «Tomar asistencia desde el aula virtual» marca presente a quienes entraron.</li>
          <li><b>Profesores:</b> «Iniciar / Terminar clase» registra la clase como dictada.</li>
          <li><b>Personal:</b> cada funcionario marca entrada y salida en «Personal y RR. HH.».</li>
        </ul>
      </Card>
    </div>
  );
}
