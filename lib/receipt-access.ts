import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadReceipt, receiptFilename, receiptPdf, type Receipt } from '@/lib/receipt';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { fmtMoney } from '@/lib/format';

/** Estudiantes cuyas boletas puede ver el usuario: él mismo (si es estudiante) y sus pupilos (si es apoderado). */
export async function myStudents(sb: SupabaseClient, userId: string): Promise<{ id: string; name: string; email: string | null; mine: boolean }[]> {
  const admin = createAdminClient();
  const [{ data: own }, { data: links }] = await Promise.all([
    admin.from('students').select('id, first_names, last_names, email').eq('user_id', userId),
    sb.from('guardian_links').select('student_id').eq('guardian_id', userId).eq('status', 'activo'),
  ]);
  const ids = (links ?? []).map((l) => l.student_id);
  const { data: kids } = ids.length ? await admin.from('students').select('id, first_names, last_names, email').in('id', ids) : { data: [] as any[] };
  const fmt = (s: any, mine: boolean) => ({ id: s.id, name: `${s.first_names} ${s.last_names}`, email: s.email, mine });
  return [...(own ?? []).map((s) => fmt(s, true)), ...(kids ?? []).map((s: any) => fmt(s, false))];
}

/** Boleta con permisos: finanzas y el estudiante por RLS; el apoderado, si el pago es de su pupilo. */
export async function loadReceiptFor(sb: SupabaseClient, userId: string | null, id: string): Promise<Receipt | null> {
  const r = await loadReceipt(sb, id);
  if (r || !userId || !/^[0-9a-f-]{36}$/i.test(id)) return r;
  const admin = createAdminClient();
  const { data: p } = await admin.from('payments').select('student_id').eq('id', id).maybeSingle();
  if (!p) return null;
  const allowed = (await myStudents(sb, userId)).some((s) => s.id === p.student_id);
  return allowed ? loadReceipt(admin, id) : null;
}

/** ✉ Envía la boleta en PDF por correo. Devuelve el texto del resultado (nunca lanza error). */
export async function emailReceipt(paymentId: string, to?: string | null): Promise<{ ok: boolean; text: string }> {
  try {
    if (!mailEnabled()) return { ok: false, text: 'el correo no está configurado' };
    const r = await loadReceipt(createAdminClient(), paymentId);
    if (!r) return { ok: false, text: 'boleta no encontrada' };
    const dest = (to ?? r.student.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) return { ok: false, text: 'el estudiante no tiene correo registrado' };
    const url = `${env.siteUrl()}/app/finanzas/boleta/${r.id}`;
    const pdf = await receiptPdf(r, url);
    const title = `Boleta de ${r.kind === 'refund' ? 'reembolso' : 'pago'} N° ${r.number}`;
    await sendMail(dest, `${r.org.name}: ${title}`, mailLayout(r.org.name, title,
      `<p>Hola ${r.student.name}:</p><p>Adjuntamos su ${title.toLowerCase()} por <b>${fmtMoney(r.amount, r.currency)}</b>.</p><p>También puede verla y descargarla cuando quiera en «Mis boletas».</p>`,
      { href: url, label: 'Ver boleta' }), `${title} por ${fmtMoney(r.amount, r.currency)}. Véala en ${url}`,
      [{ filename: receiptFilename(r), content: pdf, contentType: 'application/pdf' }]);
    await createAdminClient().from('system_events').insert({ organization_id: r.org.id, event_type: 'receipt_sent', severity: 'info', details: { payment: r.id, to: dest } }).then(() => {}, () => {});
    return { ok: true, text: `enviada a ${dest}` };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}
