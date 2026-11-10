import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime, fmtMoney, PAY_METHODS } from '@/lib/format';
import { docLabel } from '@/lib/identity';

export const CONCEPT_LABEL: Record<string, string> = { tuition: 'Arancel', enrollment_fee: 'Matrícula', exam_fee: 'Derecho de examen', certificate_fee: 'Certificado', other: 'Otro' };

export type Receipt = {
  id: string; number: string; kind: 'payment' | 'refund'; status: string; amount: number; currency: string; paidAt: string;
  method: string; provider: string | null; reference: string | null; notes: string | null; voidReason: string | null;
  org: { name: string; legal: string | null; taxId: string | null; logo: Uint8Array | null; logoMime: string | null; id: string };
  student: { id: string; name: string; code: string | null; doc: string | null; email: string | null };
  lines: { label: string; amount: number }[];
};

/** Lee el comprobante respetando los permisos (RLS): finanzas o el propio estudiante. */
export async function loadReceipt(sb: SupabaseClient, id: string): Promise<Receipt | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: p } = await sb.from('payments')
    .select('*, students(id, first_names, last_names, student_code, id_document_type, id_document_number, email)').eq('id', id).maybeSingle();
  if (!p) return null;
  const admin = createAdminClient();
  const [{ data: org }, { data: site }, { data: alloc }] = await Promise.all([
    admin.from('organizations').select('id, display_name, legal_name, tax_id').eq('id', p.organization_id).maybeSingle(),
    admin.from('site_settings').select('logo_asset_id').eq('organization_id', p.organization_id).maybeSingle(),
    admin.from('payment_allocations').select('amount, installments(number, due_on, charges(concept, description))').eq('payment_id', p.refund_of ?? p.id),
  ]);
  let logo: Uint8Array | null = null, logoMime: string | null = null;
  if (site?.logo_asset_id) {
    const { data: m } = await admin.from('media_assets').select('bytes, mime_type').eq('id', site.logo_asset_id).maybeSingle();
    if (m) { logo = Buffer.from(String(m.bytes).replace(/^\\x/, ''), 'hex'); logoMime = m.mime_type; }
  }
  const s = p.students as any;
  const lines = p.kind === 'refund'
    ? [{ label: `Reembolso del comprobante de pago${p.notes ? ` · ${p.notes}` : ''}`, amount: Number(p.amount) }]
    : (alloc ?? []).filter((a: any) => Number(a.amount) > 0).map((a: any) => ({
      label: `${CONCEPT_LABEL[a.installments?.charges?.concept] ?? a.installments?.charges?.concept ?? 'Cuota'}${a.installments?.charges?.description ? ` · ${a.installments.charges.description}` : ''} · cuota ${a.installments?.number ?? ''}`,
      amount: Number(a.amount),
    }));
  const assigned = lines.reduce((t, l) => t + l.amount, 0);
  if (p.kind === 'payment' && Number(p.amount) - assigned > 0.004) lines.push({ label: 'Abono a cuenta', amount: Number(p.amount) - assigned });
  return {
    id: p.id, number: `${p.kind === 'refund' ? 'R-' : ''}${p.receipt_number}`, kind: p.kind, status: p.status, amount: Number(p.amount), currency: p.currency,
    paidAt: p.paid_at, method: PAY_METHODS.find((m) => m.value === p.method)?.label ?? p.method, provider: p.provider, reference: p.external_reference,
    notes: p.notes, voidReason: p.void_reason,
    org: { id: p.organization_id, name: org?.display_name ?? '', legal: org?.legal_name ?? null, taxId: org?.tax_id ?? null, logo, logoMime },
    student: { id: s?.id, name: `${s?.first_names ?? ''} ${s?.last_names ?? ''}`.trim(), code: s?.student_code ?? null,
      doc: s?.id_document_number ? `${docLabel(s.id_document_type).split(' ')[0]} ${s.id_document_number}` : null, email: s?.email ?? null },
    lines,
  };
}

const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');

/** Comprobante de pago en PDF (A4), con QR para verificarlo en la plataforma. */
export async function receiptPdf(r: Receipt, url: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`Comprobante ${r.number} - ${r.student.name}`)); pdf.setAuthor(clean(r.org.name));
  const page = pdf.addPage([595.28, 841.89]);
  const W = page.getWidth(), H = page.getHeight();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const BRAND = rgb(0.12, 0.27, 0.78), INK = rgb(0.06, 0.09, 0.16), MUTED = rgb(0.39, 0.45, 0.55), LINE = rgb(0.86, 0.89, 0.93);
  const text = (t: string, x: number, y: number, size = 10, f = reg, color = INK) => page.drawText(clean(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, y: number, size = 10, f = reg, color = INK) => text(t, xr - f.widthOfTextAtSize(clean(t), size), y, size, f, color);
  const M = 50;
  let y = H - 60;
  let lx = M;
  if (r.org.logo && r.org.logoMime && /png|jpe?g/.test(r.org.logoMime)) {
    try {
      const img = r.org.logoMime.includes('png') ? await pdf.embedPng(r.org.logo) : await pdf.embedJpg(r.org.logo);
      const s = img.scaleToFit(90, 50);
      page.drawImage(img, { x: M, y: y - s.height + 14, width: s.width, height: s.height }); lx = M + s.width + 12;
    } catch { /* logo no compatible */ }
  }
  text(r.org.name, lx, y, 15, bold);
  if (r.org.legal && r.org.legal !== r.org.name) text(r.org.legal, lx, y - 16, 9, reg, MUTED);
  if (r.org.taxId) text(`RUT ${r.org.taxId}`, lx, y - 28, 9, reg, MUTED);
  // Recuadro del número
  page.drawRectangle({ x: W - M - 190, y: y - 44, width: 190, height: 62, borderColor: BRAND, borderWidth: 1.5 });
  const title = r.kind === 'refund' ? 'COMPROBANTE DE REEMBOLSO' : 'COMPROBANTE DE PAGO';
  right(title, W - M - 12, y - 2, 9.5, bold, BRAND);
  right(`N° ${r.number}`, W - M - 12, y - 22, 16, bold, INK);
  right(fmtDateTime(r.paidAt), W - M - 12, y - 37, 8.5, reg, MUTED);
  y -= 85;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE }); y -= 22;
  const row = (k: string, v: string | null) => { if (!v) return; text(k, M, y, 9, reg, MUTED); text(v, M + 130, y, 10.5, bold); y -= 18; };
  row('Recibido de', r.student.name); row('Documento', r.student.doc); row('Código de estudiante', r.student.code);
  row('Medio de pago', `${r.method}${r.provider ? ` · ${r.provider}` : ''}`); row('N° de operación', r.reference);
  y -= 10;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: rgb(0.94, 0.96, 1) });
  text('Detalle', M + 8, y, 9.5, bold); right('Monto', W - M - 8, y, 9.5, bold); y -= 26;
  for (const l of r.lines) {
    let label = clean(l.label);
    while (reg.widthOfTextAtSize(label, 10) > W - 2 * M - 140 && label.length > 10) label = label.slice(0, -2);
    text(label === clean(l.label) ? label : `${label}...`, M + 8, y, 10); right(fmtMoney(l.amount, r.currency), W - M - 8, y, 10);
    y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE }); y -= 14;
  }
  y -= 6;
  right(`TOTAL ${r.kind === 'refund' ? 'REEMBOLSADO' : 'PAGADO'}`, W - M - 150, y, 11, bold, MUTED);
  right(fmtMoney(r.amount, r.currency), W - M - 8, y, 15, bold, BRAND);
  y -= 30;
  if (r.notes && r.kind === 'payment') { text(`Observación: ${r.notes}`.slice(0, 110), M, y, 9, reg, MUTED); y -= 16; }
  // QR de verificación
  const qr = await QRCode.toBuffer(url, { margin: 1, width: 220 });
  const qimg = await pdf.embedPng(qr);
  page.drawImage(qimg, { x: M, y: y - 95, width: 90, height: 90 });
  text('Verifique este comprobante en la plataforma', M + 100, y - 30, 9, bold);
  text(url.length > 80 ? `${url.slice(0, 80)}...` : url, M + 100, y - 44, 8, reg, MUTED);
  text('Documento interno de la institución. No reemplaza la boleta o factura electrónica del SII.', M + 100, y - 60, 7.5, reg, MUTED);
  if (r.status === 'voided') {
    page.drawText('ANULADO', { x: 120, y: 330, size: 110, font: bold, color: rgb(0.86, 0.15, 0.15), opacity: 0.25, rotate: degrees(35) });
    text(`Anulado: ${r.voidReason ?? ''}`.slice(0, 100), M, 60, 10, bold, rgb(0.8, 0.1, 0.1));
  }
  text(`${r.org.name} · Comprobante N° ${r.number}`, M, 30, 7.5, reg, MUTED);
  return pdf.save();
}

export const receiptFilename = (r: Receipt) =>
  `Comprobante-${r.number}-${r.student.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 80) + '.pdf';
