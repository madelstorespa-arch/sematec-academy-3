import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, StatusBadge, Empty, Badge } from '@/components/ui';
import { ActionForm, Field, SelectField } from '@/components/forms';
import { PersonFields } from '@/components/person-form';
import { campusOptions, countryOptions } from '@/lib/options';
import { fmtDate, fmtMoney, fmtNum, fullName } from '@/lib/format';
import { updateStudent, grantPortalAccess, resetPortalPassword, createInstitutionalAccount } from '../actions';
import { workspaceEnabled, workspaceDomain } from '@/lib/workspace';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  requireOrg(ctx);
  const sb = ctx.supabase;
  const { data: s } = await sb.from('students').select('*').eq('id', id).maybeSingle();
  if (!s) notFound();
  const [campuses, countries, enr, recs, bal, certs] = await Promise.all([
    campusOptions(ctx), countryOptions(ctx),
    sb.from('enrollments').select('id, status, enrolled_at, programs(code, name), academic_periods(code)').eq('student_id', id).order('enrolled_at', { ascending: false }),
    sb.from('academic_records').select('id, result, final_grade, attendance_pct, courses(code, name), academic_periods(code)').eq('student_id', id).order('created_at', { ascending: false }),
    sb.from('account_balances').select('*').eq('student_id', id),
    sb.from('certificates').select('id, title, serial_number, status, issued_at').eq('student_id', id).order('issued_at', { ascending: false }),
  ]);
  const edit = can(ctx, 'students.edit');

  return (
    <>
      <PageHeader title={fullName(s)} subtitle={`${s.student_code} · ${s.id_document_type} ${s.id_document_number}`}
        actions={<><StatusBadge status={s.status} />{s.user_id ? <Badge color="green">Con acceso al portal</Badge> : <Badge>Sin acceso al portal</Badge>}</>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Matrículas">
          {enr.data?.length ? <table className="table"><thead><tr><th>Programa</th><th>Periodo</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>
            {enr.data.map((e: any) => <tr key={e.id}><td>{e.programs?.code} · {e.programs?.name}</td><td>{e.academic_periods?.code}</td><td>{fmtDate(e.enrolled_at)}</td><td><StatusBadge status={e.status} /></td></tr>)}
          </tbody></table> : <Empty>Sin matrículas. {can(ctx, 'enrollments.create') && <Link className="link" href="/app/matriculas">Matricular</Link>}</Empty>}
        </Card>
        <Card title="Estado de cuenta">
          {bal.data?.length ? bal.data.map((b: any) => (
            <div key={b.account_id} className="grid grid-cols-2 gap-2 text-sm">
              <span>Total facturado</span><b className="text-right">{fmtMoney(b.total_billed, b.currency)}</b>
              <span>Pagado</span><b className="text-right">{fmtMoney(b.total_paid, b.currency)}</b>
              <span>Saldo pendiente</span><b className="text-right">{fmtMoney(b.outstanding, b.currency)}</b>
              <span>Vencido</span><b className={`text-right ${Number(b.overdue) > 0 ? 'text-red-600' : ''}`}>{fmtMoney(b.overdue ?? 0, b.currency)}</b>
            </div>)) : <Empty>Sin movimientos financieros visibles.</Empty>}
          {can(ctx, 'finance.view') && <Link className="link mt-3 inline-block text-sm" href={`/app/finanzas/cuenta/${id}`}>Ver detalle de cuotas y pagos →</Link>}
        </Card>
        <Card title="Expediente académico">
          {recs.data?.length ? <table className="table"><thead><tr><th>Asignatura</th><th>Periodo</th><th>Nota</th><th>Asist.</th><th>Resultado</th></tr></thead><tbody>
            {recs.data.map((r: any) => <tr key={r.id}><td>{r.courses?.code} · {r.courses?.name}</td><td>{r.academic_periods?.code}</td><td>{fmtNum(r.final_grade)}</td><td>{r.attendance_pct != null ? `${fmtNum(r.attendance_pct, 0)} %` : '—'}</td><td><StatusBadge status={r.result} /></td></tr>)}
          </tbody></table> : <Empty>Sin asignaturas registradas.</Empty>}
        </Card>
        <Card title="Certificados">
          {certs.data?.length ? <ul className="space-y-1 text-sm">{certs.data.map((c: any) => <li key={c.id} className="flex justify-between"><span>N° {c.serial_number} · {c.title}</span><StatusBadge status={c.status} /></li>)}</ul> : <Empty>Sin certificados.</Empty>}
        </Card>
      </div>
      {edit && (
        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <Card title="Editar ficha" className="xl:col-span-2">
            <ActionForm action={updateStudent} submitLabel="Guardar cambios" resetOnSuccess={false}>
              <input type="hidden" name="id" value={s.id} />
              <PersonFields campuses={campuses} countries={countries} d={s} />
              <SelectField label="Estado" name="status" required defaultValue={s.status} className="max-w-xs"
                options={[['active', 'Activo'], ['inactive', 'Inactivo'], ['suspended', 'Suspendido'], ['withdrawn', 'Retirado'], ['graduated', 'Egresado']].map(([value, label]) => ({ value, label }))} />
            </ActionForm>
          </Card>
          <Card title="Acceso al portal">
            {s.user_id ? (
              <ActionForm action={resetPortalPassword} submitLabel="🔑 Generar nueva contraseña" resetOnSuccess={false}>
                <input type="hidden" name="kind" value="student" /><input type="hidden" name="id" value={s.id} />
                <p className="text-sm text-slate-600">El estudiante ya tiene cuenta. Si olvidó su contraseña, genere una temporal y entréguesela.</p>
              </ActionForm>) : (
              <div className="space-y-4">
              {workspaceEnabled() && (
                <ActionForm action={createInstitutionalAccount} submitLabel={`📧 Crear correo @${workspaceDomain()} y acceso`} resetOnSuccess={false}>
                  <input type="hidden" name="kind" value="student" /><input type="hidden" name="id" value={s.id} />
                  <p className="text-sm text-slate-600">Crea un buzón real en Google Workspace y la cuenta SEMATEC con esa dirección.</p>
                </ActionForm>)}
              <ActionForm action={grantPortalAccess} submitLabel="Crear acceso" resetOnSuccess={false}>
                <input type="hidden" name="kind" value="student" /><input type="hidden" name="id" value={s.id} />
                <Field label="Correo de acceso" name="email" type="email" required defaultValue={s.email} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="invite" /> Enviar invitación por correo (requiere SMTP)</label>
              </ActionForm>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
