import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { getContext, can } from '@/lib/context';
import { Card, StatusBadge } from '@/components/ui';
import { ActionForm, TextArea } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { env } from '@/lib/env';
import { fmtDate } from '@/lib/format';
import { revokeCertificate } from '../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const { data: c } = await ctx.supabase.from('certificates').select('*, certificate_templates(body_template)').eq('id', id).maybeSingle();
  if (!c) notFound();
  const { data: org } = await ctx.supabase.from('organizations').select('legal_name, display_name').eq('id', c.organization_id).maybeSingle();
  const url = `${env.siteUrl()}/verificar/${c.verification_code}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  const body = (c.certificate_templates?.body_template || '').replace('{{name}}', c.recipient_name);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link className="btn-secondary" href={can(ctx, 'certificates.view') ? '/app/certificados' : '/app/mi'}>Volver</Link>
        <div className="flex items-center gap-3"><StatusBadge status={c.status} /><PrintButton /></div>
      </div>
      <article className="mx-auto max-w-3xl border-8 border-double border-brand-700 bg-white p-12 text-center shadow-sm print:border-4 print:shadow-none">
        <p className="text-xs font-bold tracking-[0.4em] text-brand-600">SEMATEC ACADEMY</p>
        <p className="mt-1 text-sm text-slate-600">{org?.legal_name ?? c.payload?.organization}</p>
        <h1 className="mt-10 text-3xl font-bold">{c.title}</h1>
        <p className="mt-8 text-slate-600">Se certifica que</p>
        <p className="mt-2 text-2xl font-semibold">{c.recipient_name}</p>
        {c.payload?.document && <p className="text-sm text-slate-500">Documento {String(c.payload.document).split(':').slice(1).join(' ')}</p>}
        {body && <p className="mx-auto mt-6 max-w-xl text-slate-700">{body}</p>}
        {c.payload?.program && <p className="mt-4">Programa: <b>{c.payload.program}</b></p>}
        {c.payload?.course && <p className="mt-2">Asignatura: <b>{c.payload.course}</b>{c.payload.final_grade ? ` · Nota final ${c.payload.final_grade}` : ''}</p>}
        <p className="mt-8 text-sm text-slate-600">Emitido el {fmtDate(c.issued_at)} · Certificado N° {c.serial_number}</p>
        <div className="mt-10 flex items-end justify-between text-left">
          <div className="text-xs text-slate-500">
            <p>Verifique la autenticidad en:</p><p className="font-mono">{url}</p>
            <p className="mt-1">Código: <b className="font-mono text-slate-700">{c.verification_code}</b></p>
            <p className="mt-1 break-all">Huella SHA-256: {c.content_hash.slice(0, 32)}…</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR de verificación" className="h-32 w-32" />
        </div>
        {c.status === 'revoked' && <p className="mt-6 rounded bg-red-50 p-2 font-bold text-red-700">CERTIFICADO REVOCADO el {fmtDate(c.revoked_at)}</p>}
      </article>
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
