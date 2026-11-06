import Link from 'next/link';
import { getContext, can, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, SelectField, TextArea } from '@/components/forms';
import { courseOptions, studentOptions } from '@/lib/options';
import { fmtDate } from '@/lib/format';
import { issueCertificate, createTemplate } from './actions';

export const metadata = { title: 'Certificados' };
const TYPES = [['enrollment', 'Alumno regular'], ['course_completion', 'Aprobación de asignatura'], ['program_completion', 'Egreso / término de programa'], ['conference_attendance', 'Asistencia a conferencia'], ['other', 'Otro']];

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'certificates.view');
  const orgId = requireOrg(ctx);
  const [students, courses, { data: templates }, { data: certs }] = await Promise.all([
    studentOptions(ctx), courseOptions(ctx),
    ctx.supabase.from('certificate_templates').select('id, name, certificate_type').eq('organization_id', orgId).eq('status', 'active').order('name'),
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
              <Field label="Título" name="title_template" required placeholder="Certificado de aprobación: {{course}}" />
              <TextArea label="Texto (opcional)" name="body_template" />
              <p className="text-xs text-slate-500">Variables: {'{{name}}'}, {'{{course}}'}, {'{{program}}'}</p>
            </ActionForm>
          </Card>
        )}
      </div>
      <Card title="Certificados emitidos">
        {certs?.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>N°</th><th>Fecha</th><th>Destinatario</th><th>Título</th><th>Código</th><th>Estado</th></tr></thead>
          <tbody>{certs.map((c: any) => (
            <tr key={c.id}><td>{c.serial_number}</td><td>{fmtDate(c.issued_at)}</td><td>{c.recipient_name}</td>
              <td><Link className="link" href={`/app/certificados/${c.id}`}>{c.title}</Link></td><td className="font-mono text-xs">{c.verification_code}</td><td><StatusBadge status={c.status} /></td></tr>))}</tbody></table></div>
          : <Empty>Aún no se emiten certificados.</Empty>}
      </Card>
    </>
  );
}
