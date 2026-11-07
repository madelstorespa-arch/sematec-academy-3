import { getContext, can, requireOrg } from '@/lib/context';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge, Empty } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField } from '@/components/forms';
import { PersonFields } from '@/components/person-form';
import { campusOptions, countryOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { addContract, clock, createEmployee, createEmployeeAccount, decideLeave, requestLeave } from './actions';

export const metadata = { title: 'Personal y RR. HH.' };
const TZ = 'America/Santiago';
const hm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—';
const LEAVE: Record<string, string> = { vacaciones: 'Vacaciones', administrativo: 'Día administrativo', licencia_medica: 'Licencia médica', sin_goce: 'Permiso sin goce', otro: 'Otro' };
const STAFF_ROLES = [['secretaria', 'Secretaría académica'], ['admision', 'Admisión'], ['matriculas', 'Matrículas'], ['coordinador', 'Coordinador académico'], ['tesoreria', 'Tesorería (MFA)'],
  ['contabilidad', 'Contabilidad (MFA)'], ['recursos_humanos', 'Recursos humanos (MFA)'], ['bibliotecario', 'Bibliotecario'], ['soporte_tecnico', 'Soporte técnico (MFA)'], ['administrador_sede', 'Administrador de sede (MFA)']]
  .map(([value, label]) => ({ value, label }));
const CT: Record<string, string> = { indefinite: 'Indefinido', fixed_term: 'Plazo fijo', hourly: 'Por horas', fee: 'Honorarios' };

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const hr = can(ctx, 'employees.view');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const { data: me } = await ctx.supabase.from('employees').select('id, first_names').eq('organization_id', orgId).eq('user_id', ctx.user.id).maybeSingle();
  if (!hr && !me) notFound();
  const [{ data: myToday }, { data: myLeaves }] = me ? await Promise.all([
    ctx.supabase.from('staff_attendance').select('*').eq('employee_id', me.id).eq('work_date', today).maybeSingle(),
    ctx.supabase.from('leave_requests').select('*').eq('employee_id', me.id).order('created_at', { ascending: false }).limit(10),
  ]) : [{ data: null }, { data: [] as any[] }];
  const [{ data: emps }, { data: att }, { data: leaves }, { data: contracts }, campuses, countries] = hr ? await Promise.all([
    ctx.supabase.from('employees').select('*, campuses(name)').eq('organization_id', orgId).order('last_names'),
    ctx.supabase.from('staff_attendance').select('*').eq('organization_id', orgId).eq('work_date', today),
    ctx.supabase.from('leave_requests').select('*, employees(first_names, last_names)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
    can(ctx, 'employees.edit') ? ctx.supabase.from('employment_contracts').select('*').eq('organization_id', orgId).not('employee_id', 'is', null) : Promise.resolve({ data: [] as any[] }),
    campusOptions(ctx), countryOptions(ctx),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, [], []] as any;
  return (
    <>
      <PageHeader title="Personal y RR. HH." subtitle="Funcionarios, contratos, asistencia del personal y permisos" />
      {me && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card title={`Mi asistencia de hoy`}>
            <p className="mb-3 text-sm">Entrada: <b>{hm(myToday?.check_in)}</b> · Salida: <b>{hm(myToday?.check_out)}</b></p>
            <div className="flex gap-2">
              {!myToday && <ActionForm action={clock} inline submitLabel="Marcar entrada"><input type="hidden" name="out" value="0" /></ActionForm>}
              {myToday && !myToday.check_out && <ActionForm action={clock} inline submitLabel="Marcar salida"><input type="hidden" name="out" value="1" /></ActionForm>}
            </div>
          </Card>
          <Card title="Solicitar permiso o vacaciones">
            <ActionForm action={requestLeave} submitLabel="Enviar solicitud"><input type="hidden" name="employee_id" value={me.id} />
              <Grid cols={3}><SelectField label="Tipo" name="kind" required defaultValue="vacaciones" options={Object.entries(LEAVE).map(([value, label]) => ({ value, label }))} />
                <Field label="Desde" name="starts_on" type="date" required /><Field label="Hasta" name="ends_on" type="date" required /></Grid>
              <Field label="Motivo (opcional)" name="reason" />
            </ActionForm>
            {myLeaves?.length ? <ul className="mt-3 space-y-1 text-xs">{myLeaves.map((l: any) => <li key={l.id}>{LEAVE[l.kind]} {fmtDate(l.starts_on)}–{fmtDate(l.ends_on)} · <Badge color={l.status === 'aprobado' ? 'green' : l.status === 'rechazado' ? 'red' : 'amber'}>{l.status}</Badge></li>)}</ul> : null}
          </Card>
        </div>)}
      {hr && (
        <>
          {can(ctx, 'employees.create') && (
            <details className="card mb-6"><summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Registrar funcionario</summary>
              <div className="border-t border-slate-100 p-5"><ActionForm action={createEmployee} submitLabel="Registrar">
                <PersonFields campuses={campuses} countries={countries} codeName="employee_code" codeLabel="Código de funcionario" withBirth={false} />
                <Field label="Cargo" name="position" required placeholder="Secretaria, auxiliar, contador…" />
              </ActionForm></div></details>)}
          <Card title={`Funcionarios (${emps?.length ?? 0})`} className="mb-6">
            {emps?.length ? <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Nombre</th><th>Cargo</th><th>Sede</th><th>Hoy</th><th>Contrato</th><th>Cuenta</th></tr></thead>
              <tbody>{emps.map((e: any) => {
                const a = (att ?? []).find((x: any) => x.employee_id === e.id);
                const c = (contracts ?? []).find((x: any) => x.employee_id === e.id && x.status === 'active');
                return (
                  <tr key={e.id}><td>{e.last_names}, {e.first_names}<span className="block text-xs text-slate-500">{e.email ?? ''}</span></td><td>{e.position}</td><td>{e.campuses?.name ?? '—'}</td>
                    <td>{a ? <span className="text-xs">{hm(a.check_in)}–{hm(a.check_out)}</span> : <Badge>Sin marca</Badge>}</td>
                    <td>{c ? <span className="text-xs">{CT[c.contract_type]} desde {fmtDate(c.starts_on)}{c.ends_on && ` hasta ${fmtDate(c.ends_on)}`}</span> : can(ctx, 'employees.edit') ? (
                      <details><summary className="link cursor-pointer text-xs">+ Contrato</summary>
                        <ActionForm action={addContract} submitLabel="Guardar" className="mt-2 w-64 space-y-2"><input type="hidden" name="employee_id" value={e.id} />
                          <SelectField label="Tipo" name="contract_type" required options={Object.entries(CT).map(([value, label]) => ({ value, label }))} />
                          <Field label="Inicio" name="starts_on" type="date" required /><Field label="Término (opcional)" name="ends_on" type="date" />
                          <Field label="Sueldo bruto (CLP)" name="salary_amount" type="number" />
                        </ActionForm></details>) : '—'}</td>
                    <td>{e.user_id ? <Badge color="green">Con cuenta</Badge> : can(ctx, 'employees.edit') && e.email ? (
                      <details><summary className="link cursor-pointer text-xs">🔑 Crear cuenta</summary>
                        <ActionForm action={createEmployeeAccount} submitLabel="Crear cuenta" className="mt-2 w-60 space-y-2"><input type="hidden" name="id" value={e.id} />
                          <SelectField label="Rol" name="role" required defaultValue="secretaria" options={STAFF_ROLES} />
                          <Field label="Contraseña" name="password" type="text" autoComplete="new-password" placeholder="Mín. 10, A-z y 0-9" />
                        </ActionForm></details>) : '—'}</td></tr>);
              })}</tbody></table></div> : <Empty>No hay funcionarios registrados.</Empty>}
          </Card>
          <Card title="Solicitudes de permiso">
            {leaves?.length ? <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Funcionario</th><th>Tipo</th><th>Fechas</th><th>Motivo</th><th>Estado</th></tr></thead>
              <tbody>{leaves.map((l: any) => (
                <tr key={l.id}><td>{l.employees?.last_names}, {l.employees?.first_names}</td><td>{LEAVE[l.kind]}</td><td>{fmtDate(l.starts_on)} – {fmtDate(l.ends_on)}</td><td>{l.reason ?? '—'}</td>
                  <td>{l.status === 'pendiente' && can(ctx, 'employees.edit') ? <div className="flex gap-1">
                    <ActionForm action={decideLeave} inline submitLabel="Aprobar" submitClass="btn-primary btn-sm"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="approve" value="1" /></ActionForm>
                    <ActionForm action={decideLeave} inline submitLabel="Rechazar" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="approve" value="0" /></ActionForm>
                  </div> : <Badge color={l.status === 'aprobado' ? 'green' : l.status === 'rechazado' ? 'red' : 'amber'}>{l.status}</Badge>}</td></tr>))}</tbody>
            </table></div> : <Empty>No hay solicitudes.</Empty>}
          </Card>
        </>)}
    </>
  );
}
