import Link from 'next/link';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Stat } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime, fmtMoney, PAY_METHODS } from '@/lib/format';
import { DOC_TYPES } from '@/lib/identity';
import { registerInternal, saveRegistrationConfig } from './actions';

export const metadata = { title: 'Inscripciones' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!can(ctx, 'students.view')) return <Empty>No tiene acceso a las inscripciones.</Empty>;
  const sb = ctx.supabase;
  const [{ data: cfgRow }, { data: org }, { data: regs }] = await Promise.all([
    sb.rpc('registration_info', { p_org: orgId }),
    sb.from('organizations').select('base_currency').eq('id', orgId).maybeSingle(),
    sb.from('registrations').select('id, created_at, source, amount, currency, method, form_data, student_id, students(id, first_names, last_names, student_code, email, id_document_number)')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200),
  ]);
  const cfg = (cfgRow ?? {}) as { enabled?: boolean; fee?: number; currency?: string; title?: string; intro?: string; ask_birth?: boolean; ask_address?: boolean; ask_education?: boolean; ask_guardian?: boolean };
  const currency = cfg.currency ?? org?.base_currency ?? 'CLP';
  const ids = [...new Set((regs ?? []).map((r: any) => r.student_id))];
  const { data: enr } = ids.length ? await sb.from('enrollments').select('student_id').in('student_id', ids).neq('status', 'cancelled') : { data: [] as any[] };
  const enrolled = new Set((enr ?? []).map((e: any) => e.student_id));
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = (regs ?? []).filter((r: any) => String(r.created_at).startsWith(month));
  const total = thisMonth.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const waiting = (regs ?? []).filter((r: any) => !enrolled.has(r.student_id)).length;
  const admin = ctx.isOwner || ctx.isPlatformAdmin || can(ctx, 'settings.edit');
  const canCreate = can(ctx, 'students.create');
  const canFin = can(ctx, 'finance.create');
  return (
    <div>
      <PageHeader title="📝 Inscripciones" subtitle="Inscripción general, aparte de los cursos: la persona queda registrada como estudiante con su pago, lista para matricular."
        actions={<a className="btn-secondary" href="/inscripcion" target="_blank" rel="noopener noreferrer">Ver formulario del sitio ↗</a>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Inscritos este mes" value={thisMonth.length} />
        <Stat label="Recaudado este mes" value={fmtMoney(total, currency)} />
        <Stat label="Por matricular" value={<span data-testid="por-matricular">{waiting}</span>} hint="Inscritos que aún no tienen matrícula" />
        <Stat label="Inscripción en línea" value={cfg.enabled ? 'Activa' : 'Inactiva'} hint={cfg.enabled ? (Number(cfg.fee) > 0 ? fmtMoney(Number(cfg.fee), currency) : 'Sin costo') : 'Actívela abajo'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {canCreate && (
          <Card title="+ Nueva inscripción (caja o secretaría)" className="xl:col-span-3">
            <ActionForm action={registerInternal} submitLabel="Inscribir">
              <Grid><Field label="Nombres" name="first_names" required /><Field label="Apellidos" name="last_names" required /></Grid>
              <Grid>
                <SelectField label="Documento" name="id_document_type" required defaultValue="RUN" options={DOC_TYPES.map(([value, label]) => ({ value, label }))} />
                <Field label="N° de documento" name="id_document_number" required placeholder="12.345.678-5" />
              </Grid>
              <Grid><Field label="Correo" name="email" type="email" /><Field label="Teléfono" name="phone" /></Grid>
              <Grid cols={3}><Field label="Fecha de nacimiento" name="birth_date" type="date" /><Field label="Dirección" name="address" /><Field label="Ciudad / comuna" name="city" /></Grid>
              <Grid cols={3}><Field label="Estudios previos" name="education" /><Field label="Apoderado" name="guardian_name" /><Field label="Teléfono del apoderado" name="guardian_phone" /></Grid>
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-xs font-bold uppercase text-slate-500">Pago de la inscripción</legend>
                <Grid cols={3}>
                  <Field label="Monto pagado" name="amount" type="number" min={0} step="0.01" defaultValue={String(cfg.fee ?? 0)} />
                  <Field label="Moneda" name="currency" defaultValue={currency} />
                  <SelectField label="Medio de pago" name="method" defaultValue="cash" options={PAY_METHODS} />
                </Grid>
                <Field label="N° de comprobante / referencia (opcional)" name="reference" />
                {!canFin && <p className="text-xs text-amber-700">Usted no tiene permiso de finanzas: inscriba con monto 0 y pida a caja registrar el pago.</p>}
              </fieldset>
              <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">🔑 Crear también su cuenta de acceso a la plataforma</summary>
                <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="create_account" /> Crear la cuenta con el correo indicado</label>
                <Field label="Contraseña inicial (mín. 8 caracteres)" name="password" type="password" autoComplete="new-password" />
              </details>
              <TextArea label="Observaciones" name="notes" rows={2} />
            </ActionForm>
          </Card>)}
        {admin && (
          <Card title="🌐 Inscripción en línea (sitio web)" className="xl:col-span-2">
            <ActionForm action={saveRegistrationConfig} submitLabel="Guardar" resetOnSuccess={false}>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="enabled" defaultChecked={!!cfg.enabled} data-testid="inscripcion-activa" /> Recibir inscripciones desde el sitio web</label>
              <Grid><Field label="Monto de la inscripción (0 = sin costo)" name="fee" type="number" min={0} step="0.01" defaultValue={String(cfg.fee ?? 0)} /><Field label="Moneda" name="currency" defaultValue={currency} /></Grid>
              <Field label="Título" name="title" defaultValue={cfg.title ?? 'Inscripción'} />
              <TextArea label="Texto de bienvenida (opcional)" name="intro" rows={3} defaultValue={cfg.intro ?? ''} />
              <p className="label">Preguntar además</p>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="ask_birth" defaultChecked={cfg.ask_birth ?? true} /> Fecha de nacimiento</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="ask_address" defaultChecked={cfg.ask_address ?? true} /> Dirección y ciudad</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="ask_education" defaultChecked={cfg.ask_education ?? true} /> Estudios previos</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="ask_guardian" defaultChecked={cfg.ask_guardian ?? false} /> Apoderado (menores)</label>
              </div>
              <p className="text-xs text-slate-500">Con monto mayor a 0 se paga en línea con los medios de pago activos (Sitio web → Medios de pago). La persona queda inscrita al confirmarse el pago.</p>
            </ActionForm>
          </Card>)}
      </div>

      <Card title={`Inscritos (${regs?.length ?? 0})`} className="mt-6">
        {regs?.length ? (
          <div className="overflow-x-auto"><table className="table" data-testid="lista-inscripciones">
            <thead><tr><th>Fecha</th><th>Estudiante</th><th>Origen</th><th>Pagado</th><th>Estado</th><th /></tr></thead>
            <tbody>{regs.map((r: any) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                <td><Link className="link" href={`/app/estudiantes/${r.student_id}`}>{r.students ? `${r.students.last_names}, ${r.students.first_names}` : '—'}</Link>
                  <span className="block text-xs text-slate-500">{r.students?.student_code} · {r.students?.email ?? 'sin correo'}</span></td>
                <td>{r.source === 'web' ? <Badge color="blue">Sitio web</Badge> : <Badge>Interna</Badge>}</td>
                <td>{Number(r.amount) > 0 ? <>{fmtMoney(r.amount, r.currency)}<span className="block text-xs text-slate-500">{PAY_METHODS.find((m) => m.value === r.method)?.label}</span></> : 'Sin costo'}</td>
                <td>{enrolled.has(r.student_id) ? <Badge color="green">Matriculado</Badge> : <Badge color="amber">Por matricular</Badge>}</td>
                <td>{!enrolled.has(r.student_id) && can(ctx, 'enrollments.create') && <Link className="btn-primary btn-sm" href={`/app/matriculas?estudiante=${r.student_id}`} data-testid="matricular">Matricular →</Link>}</td>
              </tr>))}</tbody></table></div>
        ) : <Empty>Aún no hay inscripciones.</Empty>}
      </Card>
    </div>
  );
}
