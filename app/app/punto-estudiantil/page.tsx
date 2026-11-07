import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge, Empty, Stat } from '@/components/ui';
import { ActionForm, Field, SelectField, TextArea } from '@/components/forms';
import { fmtDateTime } from '@/lib/format';
import { createRequest, answerRequest } from './actions';

export const metadata = { title: 'Punto estudiantil' };
const KINDS: Record<string, string> = {
  cert_alumno_regular: 'Certificado de alumno regular', cert_notas: 'Certificado de notas / concentración', cert_titulo: 'Certificado de título o egreso',
  justificacion: 'Justificación de inasistencia', cambio_seccion: 'Cambio de sección u horario', congelamiento: 'Congelamiento de estudios',
  retiro: 'Retiro de asignatura o de la carrera', beca: 'Beca, convenio o rebaja de arancel', reclamo: 'Reclamo o sugerencia', otro: 'Otro trámite',
};
const ST: Record<string, [string, 'gray' | 'blue' | 'green' | 'red']> = {
  recibida: ['Recibida', 'gray'], en_proceso: ['En proceso', 'blue'], resuelta: ['Resuelta', 'green'], rechazada: ['Rechazada', 'red'],
};

export default async function Page({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const staff = can(ctx, 'students.view');
  if (!staff && !ctx.studentId) notFound();
  const sp = await searchParams;
  let q = ctx.supabase.from('student_requests').select('*, students(first_names, last_names, student_code)').eq('organization_id', orgId)
    .order('created_at', { ascending: false }).limit(300);
  if (!staff) q = q.eq('student_id', ctx.studentId!);
  if (staff && sp.estado) q = q.eq('status', sp.estado);
  const { data: list } = await q;
  const all = list ?? [];
  const edit = can(ctx, 'students.edit');

  return (
    <>
      <PageHeader title="Punto estudiantil" subtitle="Trámites, certificados y solicitudes en línea, con seguimiento" />
      {ctx.studentId && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[['🪪', 'Mi credencial', '/app/credencial'], ['📚', 'Mis libros virtuales', '/app/biblioteca'], ['📅', 'Agendar cita con Secretaría', '/app/oficinas/secretaria'], ['💳', 'Pagar mis cuotas', '/app/mi']].map(([i, l, h]) => (
              <Link key={h} href={h} className="card card-pad flex items-center gap-3 transition hover:shadow-md"><span className="text-2xl">{i}</span><b className="text-sm">{l}</b></Link>))}
          </div>
          <Card title="Nueva solicitud" className="mb-6">
            <ActionForm action={createRequest} submitLabel="Enviar solicitud">
              <SelectField label="Trámite" name="kind" required defaultValue="cert_alumno_regular" options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} />
              <Field label="Asunto" name="subject" required placeholder="Ej.: Certificado para la beca municipal" />
              <TextArea label="Detalle (opcional)" name="details" rows={3} />
            </ActionForm>
          </Card>
        </>)}
      {staff && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {Object.entries(ST).map(([k, [l]]) => <Stat key={k} label={l} value={all.filter((r: any) => r.status === k).length} />)}
        </div>)}
      <Card title={staff ? 'Solicitudes de estudiantes' : 'Mis solicitudes'}>
        {staff && (
          <nav className="mb-4 flex flex-wrap gap-2 text-sm">
            {[['', 'Todas'], ...Object.entries(ST).map(([k, [l]]) => [k, l])].map(([k, l]) => (
              <a key={k} href={k ? `?estado=${k}` : '?'} className={(sp.estado ?? '') === k ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>{l}</a>))}
          </nav>)}
        {all.length ? (
          <ul className="divide-y divide-slate-100">
            {all.map((r: any) => (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">N° {r.number} · {r.subject}</p>
                    <p className="text-xs text-slate-500">{KINDS[r.kind]} · {fmtDateTime(r.created_at)}{staff && r.students ? ` · ${r.students.first_names} ${r.students.last_names} (${r.students.student_code})` : ''}</p>
                  </div>
                  <Badge color={ST[r.status][1]}>{ST[r.status][0]}</Badge>
                </div>
                {r.details && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{r.details}</p>}
                {r.response && <p className="mt-2 rounded-lg bg-brand-50 p-3 text-sm"><b>Respuesta:</b> {r.response}</p>}
                {staff && edit && (
                  <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-brand-700">Responder / cambiar estado</summary>
                    <div className="mt-2 max-w-xl"><ActionForm action={answerRequest} submitLabel="Guardar y notificar">
                      <input type="hidden" name="id" value={r.id} />
                      <SelectField label="Estado" name="status" required defaultValue={r.status === 'recibida' ? 'en_proceso' : r.status} options={Object.entries(ST).map(([value, [label]]) => ({ value, label }))} />
                      <TextArea label="Respuesta al estudiante" name="response" rows={3} />
                    </ActionForm></div></details>)}
              </li>))}
          </ul>
        ) : <Empty>{staff ? 'No hay solicitudes.' : 'Aún no ha ingresado solicitudes.'}</Empty>}
      </Card>
    </>
  );
}
