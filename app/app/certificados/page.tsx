import Link from 'next/link';
import { OwnerActions } from '@/components/owner-actions';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { courseOptions, studentOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { issueCertificate, createTemplate, updateTemplate } from './actions';

export const metadata = { title: 'Certificados' };
const VARS = 'Variables: {{name}} nombre · {{program}} programa · {{course}} asignatura · {{grade}} nota · {{date}} fecha';

function TemplateFields({ t = {} as any }) {
  return (
    <>
      <Field label="Título" name="title_template" required defaultValue={t.title_template} placeholder="Certificado de aprobación: {{course}}" />
      <Field label="Subtítulo (opcional)" name="subtitle" defaultValue={t.subtitle} placeholder="Otorgado por la Dirección Académica" />
      <TextArea label="Texto principal del certificado" name="body_template" rows={5} defaultValue={t.body_template}
        placeholder="Por haber aprobado satisfactoriamente el programa {{program}}, con una duración de 120 horas cronológicas, cumpliendo todos los requisitos académicos." />
      <p className="text-xs text-slate-500">{VARS}. Puede escribir varios párrafos (Enter).</p>
      <Grid>
        <Field label="Firma 1: nombre" name="signer1_name" defaultValue={t.signer1_name} placeholder="Manuel Stok" />
        <Field label="Firma 1: cargo" name="signer1_title" defaultValue={t.signer1_title} placeholder="Director Académico" />
        <Field label="Firma 2: nombre (opcional)" name="signer2_name" defaultValue={t.signer2_name} />
        <Field label="Firma 2: cargo" name="signer2_title" defaultValue={t.signer2_title} placeholder="Secretaría Académica" />
      </Grid>
      <Grid>
        <Field label="Ciudad (opcional)" name="city" defaultValue={t.city} placeholder="Santiago, Chile" />
        <Field label="Pie de página (opcional)" name="footer_text" defaultValue={t.footer_text} placeholder="Registro institucional N° …" />
      </Grid>
    </>
  );
}

const TYPES = [['enrollment', 'Alumno regular'], ['course_completion', 'Aprobación de asignatura'], ['program_completion', 'Egreso / término de programa'], ['conference_attendance', 'Asistencia a conferencia'], ['other', 'Otro']];

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'certificates.view');
  const orgId = requireOrg(ctx);
  const [students, courses, { data: templates }, { data: certs }] = await Promise.all([
    studentOptions(ctx), courseOptions(ctx),
    ctx.supabase.from('certificate_templates').select('*').eq('organization_id', orgId).eq('status', 'active').order('name'),
    ctx.supabase.from('certificates').select('id, serial_number, title, recipient_name, status, issued_at, verification_code').eq('organization_id', orgId).order('issued_at', { ascending: false }).limit(200),
  ]);
  return (
    <>
      <PageHeader title="Certificados" subtitle="Emisión con validación de requisitos y verificación pública por código QR" actions={<Link className="btn-secondary" href="/verificar" target="_blank">Página de verificación</Link>} />
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        {can(ctx, 'certificates.create') && (
          <Card title="Emitir certificado">
            {templates?.length ? (
              <ActionForm action={issueCertificate} submitLabel="Emitir">
                <SelectField label="Plantilla" name="template_id" required options={templates.map((t: any) => ({ value: t.id, label: `${t.name} (${TYPES.find(([k]) => k === t.certificate_type)?.[1]})` }))} />
                <SelectField label="Estudiante" name="student_id" required options={students} />
                <SelectField label="Asignatura (solo aprobación de asignatura)" name="course_id" options={courses} placeholder="No aplica" />
                <TextArea label="Texto adicional solo para este certificado (opcional)" name="extra" rows={3} placeholder="Ej.: Con distinción máxima. Práctica realizada en Clínica Santa María." />
                <p className="text-xs text-slate-500">El sistema verifica los requisitos (asignatura aprobada, matrícula vigente, egreso) y, si está configurado, que no exista deuda vencida.</p>
              </ActionForm>
            ) : <Empty>Cree una plantilla primero.</Empty>}
          </Card>
        )}
        {can(ctx, 'certificates.admin') && (
          <Card title="Nueva plantilla">
            <ActionForm action={createTemplate} submitLabel="Crear plantilla">
              <Grid><Field label="Código" name="code" required /><Field label="Nombre" name="name" required /></Grid>
              <SelectField label="Tipo" name="certificate_type" required options={TYPES.map(([value, label]) => ({ value, label }))} />
              <TemplateFields />
            </ActionForm>
          </Card>
        )}
      </div>
      {can(ctx, 'certificates.admin') && !!templates?.length && (
        <Card title="✏️ Editar texto de las plantillas" className="mb-6">
          <div className="space-y-2">{templates.map((t: any) => (
            <details key={t.id} className="rounded-lg border border-slate-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{t.name} <span className="font-normal text-slate-500">· {TYPES.find(([k]) => k === t.certificate_type)?.[1]}</span></summary>
              <div className="border-t border-slate-100 p-4"><ActionForm action={updateTemplate} submitLabel="Guardar plantilla" resetOnSuccess={false}>
                <input type="hidden" name="id" value={t.id} />
                <Field label="Nombre de la plantilla" name="name" required defaultValue={t.name} />
                <TemplateFields t={t} />
              </ActionForm>
              {ctx.isOwner && <div className="mt-3 border-t border-slate-100 pt-3"><OwnerActions table="certificate_templates" id={t.id} active={t.status === 'active'} path="/app/certificados" name={`la plantilla «${t.name}»`} /></div>}</div>
            </details>))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Los cambios se aplican a los certificados que emita desde ahora. Los ya emitidos no cambian (su texto está protegido por la huella SHA-256); si necesita otro texto, revóquelo y emítalo de nuevo.</p>
        </Card>
      )}
      <Card title="Certificados emitidos">
        {certs?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>N°</th><th>Fecha</th><th>Destinatario</th><th>Título</th><th>Código</th><th>Estado</th><th></th></tr></thead>
          <tbody>{certs.map((c: any) => (
            <tr key={c.id}><td>{c.serial_number}</td><td>{fmtDate(c.issued_at)}</td><td>{c.recipient_name}</td>
              <td><Link className="link" href={`/app/certificados/${c.id}`}>{c.title}</Link></td><td className="font-mono text-xs">{c.verification_code}</td><td><StatusBadge status={c.status} /></td>
              <td><a className="link text-xs" href={`/app/certificados/${c.id}/pdf`} download>⬇ PDF</a></td></tr>))}</tbody></table></div>
          : <Empty>Aún no se emiten certificados.</Empty>}
      </Card>
    </>
  );
}
