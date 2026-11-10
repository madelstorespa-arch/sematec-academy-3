'use server';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { loadReceipt, receiptFilename, receiptPdf } from '@/lib/receipt';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { fmtMoney } from '@/lib/format';

async function receiptFor(fd: FormData) {
  const ctx = await getContext();
  if (!can(ctx, 'finance.view')) throw new Error('Solo el personal de finanzas puede enviar o guardar comprobantes.');
  const r = await loadReceipt(ctx.supabase, reqStr(fd, 'id', 'id'));
  if (!r) throw new Error('Comprobante no encontrado.');
  const url = `${env.siteUrl()}/app/finanzas/boleta/${r.id}`;
  return { ctx, r, url, pdf: await receiptPdf(r, url) };
}

/** ✉ Envía el comprobante en PDF por correo (al estudiante o a otra dirección). */
export async function sendReceipt(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    try {
      if (!mailEnabled()) return fail('El envío de correos no está configurado (variables SMTP_* en Vercel). Descargue el PDF y envíelo usted.');
      const { ctx, r, url, pdf } = await receiptFor(fd);
      const to = (str(fd, 'email') ?? r.student.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail('Ingrese un correo válido.');
      const title = `Comprobante de ${r.kind === 'refund' ? 'reembolso' : 'pago'} N° ${r.number}`;
      const body = `<p>Hola ${r.student.name}:</p><p>Adjuntamos su ${title.toLowerCase()} por <b>${fmtMoney(r.amount, r.currency)}</b>.</p>
        <p>También puede verlo y descargarlo cuando quiera desde su portal.</p>`;
      await sendMail(to, `${r.org.name}: ${title}`, mailLayout(r.org.name, title, body, { href: url, label: 'Ver comprobante' }),
        `${title} por ${fmtMoney(r.amount, r.currency)}. Véalo en ${url}`, [{ filename: receiptFilename(r), content: pdf, contentType: 'application/pdf' }]);
      await ctx.supabase.from('system_events').insert({ organization_id: r.org.id, event_type: 'receipt_sent', severity: 'info', details: { payment: r.id, to } }).then(() => {}, () => {});
      return ok(`Comprobante enviado a ${to}.`);
    } catch (e) { return fail((e as Error).message); }
  });
}

/** 💾 Guarda una copia del PDF en «Archivos» (visible para usted; opcionalmente para el personal). */
export async function saveReceipt(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    try {
      const { ctx, r, pdf } = await receiptFor(fd);
      const path = `${r.org.id}/${ctx.user.id}/${crypto.randomUUID()}-${receiptFilename(r)}`;
      const bucket = createAdminClient().storage.from('user-files');
      const { data: signed, error: signErr } = await bucket.createSignedUploadUrl(path);
      if (signErr || !signed) return fail(`No se pudo guardar el archivo: ${signErr?.message ?? 'sin permiso de almacenamiento'}`);
      const { error: upErr } = await bucket.uploadToSignedUrl(path, signed.token, new Blob([Buffer.from(pdf)], { type: 'application/pdf' }), { contentType: 'application/pdf' });
      if (upErr) return fail(`No se pudo guardar el archivo: ${upErr.message}`);
      const { data: fileId, error } = await ctx.supabase.rpc('register_user_file', {
        p_org: r.org.id, p_name: receiptFilename(r), p_mime: 'application/pdf', p_size: pdf.byteLength, p_path: path,
        p_visibility: fd.get('staff') === 'on' ? 'staff' : 'private', p_section: null, p_description: `Comprobante N° ${r.number} · ${r.student.name}`,
      });
      if (error) return fail(error);
      return ok('Copia guardada en «Archivos».', { href: `/app/archivos/ver/${fileId}` });
    } catch (e) { return fail((e as Error).message); }
  });
}
