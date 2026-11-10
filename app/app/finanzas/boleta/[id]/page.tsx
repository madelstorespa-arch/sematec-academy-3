import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, can } from '@/lib/context';
import { Card, StatusBadge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { PrintButton } from '@/components/print-button';
import { loadReceiptFor } from '@/lib/receipt-access';
import { mailEnabled } from '@/lib/mailer';
import { env } from '@/lib/env';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { saveReceipt, sendReceipt } from '../actions';

export const metadata = { title: 'Comprobante de pago' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const r = await loadReceiptFor(ctx.supabase, ctx.user.id, id);
  if (!r) notFound();
  const staff = can(ctx, 'finance.view');
  const url = `${env.siteUrl()}/app/finanzas/boleta/${r.id}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${r.org.name}: comprobante de pago N° ${r.number} por ${fmtMoney(r.amount, r.currency)}. ${url}`)}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link className="btn-secondary" href={staff ? `/app/finanzas/cuenta/${r.student.id}` : '/app/boletas'}>← Volver</Link>
        <a className="btn-primary" href={`/app/finanzas/boleta/${r.id}/pdf`} data-testid="descargar-boleta">⬇ Descargar PDF</a>
        <a className="btn-secondary" href={`/app/finanzas/boleta/${r.id}/pdf?ver=1`} target="_blank" rel="noopener noreferrer">👁 Ver PDF</a>
        <PrintButton />
        {staff && <a className="btn-secondary" href={wa} target="_blank" rel="noopener noreferrer">📲 Enviar por WhatsApp</a>}
      </div>

      <article className="card mx-auto max-w-3xl p-6 sm:p-10 print:shadow-none" data-testid="boleta">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xl font-bold">{r.org.name}</p>
            {r.org.legal && r.org.legal !== r.org.name && <p className="text-sm text-slate-500">{r.org.legal}</p>}
            {r.org.taxId && <p className="text-sm text-slate-500">RUT {r.org.taxId}</p>}
          </div>
          <div className="rounded-xl border-2 border-brand-600 px-5 py-3 text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Comprobante de {r.kind === 'refund' ? 'reembolso' : 'pago'}</p>
            <p className="text-2xl font-bold">N° {r.number}</p>
            <p className="text-xs text-slate-500">{fmtDateTime(r.paidAt)}</p>
          </div>
        </header>
        {r.status === 'voided' && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">ANULADO · {r.voidReason}</p>}
        <dl className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">Recibido de</dt><dd className="font-semibold">{r.student.name}</dd>
          {r.student.doc && <><dt className="text-slate-500">Documento</dt><dd>{r.student.doc}</dd></>}
          {r.student.code && <><dt className="text-slate-500">Código</dt><dd>{r.student.code}</dd></>}
          <dt className="text-slate-500">Medio de pago</dt><dd>{r.method}{r.provider ? ` · ${r.provider}` : ''}</dd>
          {r.reference && <><dt className="text-slate-500">N° de operación</dt><dd>{r.reference}</dd></>}
          <dt className="text-slate-500">Estado</dt><dd><StatusBadge status={r.status} /></dd>
        </dl>
        <table className="table mt-6">
          <thead><tr><th>Detalle</th><th className="text-right">Monto</th></tr></thead>
          <tbody>{r.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="text-right">{fmtMoney(l.amount, r.currency)}</td></tr>)}</tbody>
          <tfoot><tr><td className="text-right font-bold">TOTAL {r.kind === 'refund' ? 'REEMBOLSADO' : 'PAGADO'}</td><td className="text-right text-xl font-bold text-brand-700">{fmtMoney(r.amount, r.currency)}</td></tr></tfoot>
        </table>
        {r.notes && r.kind === 'payment' && <p className="mt-3 text-xs text-slate-500">Observación: {r.notes}</p>}
        <p className="mt-6 text-[11px] text-slate-400">Documento interno de la institución. No reemplaza la boleta o factura electrónica del SII.</p>
      </article>

      {staff && (
        <div className="mx-auto mt-6 grid max-w-3xl gap-4 md:grid-cols-2 print:hidden">
          <Card title="✉ Enviar por correo">
            {mailEnabled() ? (
              <ActionForm action={sendReceipt} submitLabel="Enviar comprobante" resetOnSuccess={false}>
                <input type="hidden" name="id" value={r.id} />
                <label className="block text-sm"><span className="label">Correo</span>
                  <input name="email" type="email" required defaultValue={r.student.email ?? ''} className="input" placeholder="correo@ejemplo.com" /></label>
                <p className="text-xs text-slate-500">Se envía con el PDF adjunto.</p>
              </ActionForm>
            ) : <p className="text-sm text-amber-700">El correo de la plataforma no está configurado (SMTP_* en Vercel). Descargue el PDF y envíelo, o use WhatsApp.</p>}
          </Card>
          <Card title="💾 Guardar copia">
            <ActionForm action={saveReceipt} submitLabel="Guardar en Archivos" resetOnSuccess={false}>
              <input type="hidden" name="id" value={r.id} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="staff" /> Visible para todo el personal</label>
              <p className="text-xs text-slate-500">El comprobante siempre queda registrado en el sistema; esto guarda además el PDF en «📁 Archivos».</p>
            </ActionForm>
          </Card>
        </div>)}
      {!staff && (
        <div className="mx-auto mt-6 flex max-w-3xl flex-wrap gap-3 print:hidden" data-testid="acciones-boleta-estudiante">
          {mailEnabled() && ctx.user.email && <ActionForm action={sendReceipt} inline submitLabel={`✉ Enviármela a ${ctx.user.email}`} submitClass="btn-secondary" resetOnSuccess={false}>
            <input type="hidden" name="id" value={r.id} /></ActionForm>}
          <ActionForm action={saveReceipt} inline submitLabel="💾 Guardar en Mis archivos" submitClass="btn-secondary" resetOnSuccess={false}><input type="hidden" name="id" value={r.id} /></ActionForm>
        </div>)}
    </>
  );
}
