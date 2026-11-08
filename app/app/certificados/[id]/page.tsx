import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { getContext, can } from '@/lib/context';
import { Card, StatusBadge } from '@/components/ui';
import { ActionForm, Field, Grid, TextArea } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { env } from '@/lib/env';
import { fmtDate } from '@/lib/format';
import { revokeCertificate, amendCertificate } from '../actions';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ editado?: string }> }) {
  const { id } = await params;
  const { editado } = await searchParams;
  const ctx = await getContext();
  const { data: c } = await ctx.supabase.from('certificates').select('*, certificate_templates(body_template)').eq('id', id).maybeSingle();
  if (!c) notFound();
  const { data: org } = await ctx.supabase.from('organizations').select('legal_name, display_name').eq('id', c.organization_id).maybeSingle();
  const url = `${env.siteUrl()}/verificar/${c.verification_code}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  const P = c.payload ?? {};
  // Certificados nuevos: el texto viene fijado en el certificado; antiguos: desde la plantilla
  const body: string = P.body ?? (c.certificate_templates?.body_template || '').replaceAll('{{name}}', c.recipient_name)
    .replaceAll('{{program}}', P.program ?? '').replaceAll('{{course}}', P.course ?? '').replaceAll('{{grade}}', P.final_grade ?? '').replaceAll('{{date}}', '');
  const signers: { name: string; title?: string }[] = P.signers ?? [];
  const orgName = org?.display_name || P.organization;
  const legal = org?.legal_name && org.legal_name !== orgName ? org.legal_name : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link className="btn-secondary" href={can(ctx, 'certificates.view') ? '/app/certificados' : '/app/mi'}>Volver</Link>
        <div className="flex items-center gap-3"><StatusBadge status={c.status} /><PrintButton /></div>
      </div>
      <article className="mx-auto max-w-3xl overflow-hidden border-8 border-double border-brand-700 bg-white px-5 py-8 text-center shadow-sm sm:p-12 print:border-4 print:p-10 print:shadow-none">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-brand-600 sm:tracking-[0.4em]">{orgName}</p>
        {legal && <p className="mt-1 text-sm text-slate-600">{legal}</p>}
        <h1 className="mt-8 text-2xl font-bold sm:mt-10 sm:text-3xl">{c.title}</h1>
        {P.subtitle && <p className="mt-2 text-sm italic text-slate-600">{P.subtitle}</p>}
        <p className="mt-8 text-slate-600">Se certifica que</p>
        <p className="mt-2 text-2xl font-semibold">{c.recipient_name}</p>
        {body && <p className="mx-auto mt-6 max-w-xl whitespace-pre-line text-slate-700">{body}</p>}
        {P.program && !body.includes(P.program) && <p className="mt-4">Programa: <b>{P.program}</b></p>}
        {P.course && !body.includes(P.course) && <p className="mt-2">Asignatura: <b>{P.course}</b>{P.final_grade ? ` · Nota final ${P.final_grade}` : ''}</p>}
        {P.extra && <p className="mx-auto mt-4 max-w-xl whitespace-pre-line font-medium text-slate-800">{P.extra}</p>}
        <p className="mt-8 text-sm text-slate-600">{P.city ? `${P.city}, ` : 'Emitido el '}{fmtDate(c.issued_at)} · Certificado N° {c.serial_number}</p>
        {signers.length > 0 && (
          <div className={`mt-12 grid gap-10 ${signers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {signers.map((g, i) => (
              <div key={i} className="mx-auto w-56">
                <div className="border-t border-slate-800 pt-2 text-sm font-semibold">{g.name}</div>
                {g.title && <div className="text-xs text-slate-600">{g.title}</div>}
              </div>))}
          </div>)}
        <div className="mt-10 flex flex-col-reverse items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
          <div className="min-w-0 text-xs text-slate-500">
            <p>Verifique la autenticidad en:</p><p className="break-all font-mono">{url}</p>
            <p className="mt-1">Código: <b className="font-mono text-slate-700">{c.verification_code}</b></p>
            <p className="mt-1 break-all">Huella SHA-256: {c.content_hash.slice(0, 32)}…</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR de verificación" className="h-28 w-28 shrink-0 sm:h-32 sm:w-32" />
        </div>
        {P.footer && <p className="mt-6 border-t border-slate-200 pt-3 text-[11px] text-slate-500">{P.footer}</p>}
        {c.status === 'revoked' && <p className="mt-6 rounded bg-red-50 p-2 font-bold text-red-700">CERTIFICADO REVOCADO el {fmtDate(c.revoked_at)}</p>}
      </article>
      {editado && <p className="mx-auto max-w-3xl rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">✓ Certificado corregido. Este es el nuevo (con nuevo código QR); el anterior quedó revocado como «reemplazado». Imprima o envíe este.</p>}
      {P.replaces && <p className="mx-auto max-w-3xl text-center text-xs text-slate-500 print:hidden">Versión corregida del certificado con código {P.replaces}.</p>}
      {can(ctx, 'certificates.void') && c.status === 'issued' && (
        <details className="card mx-auto max-w-3xl print:hidden">
          <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">✏️ Editar este certificado</summary>
          <div className="border-t border-slate-100 p-5">
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Para que siga siendo verificable, al guardar se emite una <b>versión corregida</b> con nuevo N° y nuevo código QR, y esta queda revocada como «reemplazada». Requiere sesión con MFA.</p>
            <ActionForm action={amendCertificate} submitLabel="Guardar cambios y emitir versión corregida" resetOnSuccess={false} confirm="Se emitirá un certificado corregido y este quedará revocado. ¿Continuar?">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Título" name="title" required defaultValue={c.title} />
              <Field label="Subtítulo" name="subtitle" defaultValue={P.subtitle} />
              <Field label="Nombre de la persona" name="recipient" required defaultValue={c.recipient_name} />
              <TextArea label="Texto principal" name="body" rows={5} defaultValue={body} />
              <TextArea label="Texto adicional" name="extra" rows={3} defaultValue={P.extra} />
              <Grid>
                <Field label="Firma 1: nombre" name="signer1_name" defaultValue={signers[0]?.name} />
                <Field label="Firma 1: cargo" name="signer1_title" defaultValue={signers[0]?.title} />
                <Field label="Firma 2: nombre" name="signer2_name" defaultValue={signers[1]?.name} />
                <Field label="Firma 2: cargo" name="signer2_title" defaultValue={signers[1]?.title} />
                <Field label="Ciudad" name="city" defaultValue={P.city} />
                <Field label="Pie de página" name="footer" defaultValue={P.footer} />
              </Grid>
              <Field label="Motivo del cambio (queda registrado)" name="reason" required placeholder="Ej.: Se agrega texto de horas y firmas" />
            </ActionForm>
          </div>
        </details>
      )}
      {can(ctx, 'certificates.void') && c.status === 'issued' && (
        <Card title="Revocar certificado (requiere MFA)" className="mx-auto max-w-3xl print:hidden">
          <ActionForm action={revokeCertificate} submitLabel="Revocar" submitClass="btn-danger" confirm="La revocación es definitiva y quedará visible en la verificación pública. ¿Continuar?">
            <input type="hidden" name="id" value={c.id} />
            <TextArea label="Motivo" name="reason" required />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
