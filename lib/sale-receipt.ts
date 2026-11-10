import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { docLabel } from '@/lib/identity';
import { methodLabel, SALE_STATUS } from '@/lib/store';

export type Sale = {
  id: string; number: number; code: string; seller: { name: string; doc: string | null; code: string | null } | null; coupon: { code: string; discount: number } | null; channel: string; status: string; currency: string; createdAt: string; paidAt: string | null;
  subtotal: number; discount: number; total: number; tax: number; cash: number | null; change: number | null; method: string | null;
  delivery: string; address: string | null; tracking: string | null; cancelReason: string | null; notes: string | null;
  customer: { name: string | null; doc: string | null; email: string | null; phone: string | null };
  items: { name: string; qty: number; unitPrice: number; discount: number; total: number; taxRate: number; serial: string | null; warranty: string | null; unit: string; promo: string | null; promoDiscount: number }[];
  org: { id: string; name: string; legal: string | null; taxId: string | null; address: string | null; phone: string | null };
};

async function build(s: any, admin = createAdminClient()): Promise<Sale> {
  const [{ data: org }, { data: site }, { data: items }, { data: seller }] = await Promise.all([
    admin.from('organizations').select('id, display_name, legal_name, tax_id').eq('id', s.organization_id).maybeSingle(),
    admin.from('site_settings').select('address, contact_phone').eq('organization_id', s.organization_id).maybeSingle(),
    admin.from('sale_items').select('name, qty, unit_price, discount, total, tax_rate, serial, warranty_until, promo_label, promo_discount, products(unit)').eq('sale_id', s.id).order('id'),
    s.seller_id ? admin.from('profiles').select('full_name, id_document_number, user_code').eq('id', s.seller_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    id: s.id, number: s.number, code: s.code ?? `VENT${String(s.number).padStart(6, '0')}`, channel: s.channel,
    seller: seller ? { name: (seller as any).full_name ?? '', doc: (seller as any).id_document_number ?? null, code: (seller as any).user_code ?? null } : null,
    coupon: s.coupon_code ? { code: s.coupon_code, discount: Number(s.coupon_discount) } : null, status: s.status, currency: s.currency, createdAt: s.created_at, paidAt: s.paid_at,
    subtotal: Number(s.subtotal), discount: Number(s.discount), total: Number(s.total), tax: Number(s.tax),
    cash: s.cash_received === null ? null : Number(s.cash_received), change: s.change_given === null ? null : Number(s.change_given),
    method: s.payment_method, delivery: s.delivery, address: s.address, tracking: s.tracking_code, cancelReason: s.cancel_reason, notes: s.notes,
    customer: { name: s.customer_name, doc: s.customer_doc_number ? `${docLabel(s.customer_doc_type).split(' ')[0]} ${s.customer_doc_number}` : null, email: s.customer_email, phone: s.customer_phone },
    items: (items ?? []).map((i: any) => ({ name: i.name, qty: Number(i.qty), unitPrice: Number(i.unit_price), discount: Number(i.discount), total: Number(i.total),
      taxRate: Number(i.tax_rate), serial: i.serial, warranty: i.warranty_until, unit: i.products?.unit ?? 'unidad', promo: i.promo_label ?? null, promoDiscount: Number(i.promo_discount ?? 0) })),
    org: { id: s.organization_id, name: org?.display_name ?? '', legal: org?.legal_name ?? null, taxId: org?.tax_id ?? null, address: site?.address ?? null, phone: site?.contact_phone ?? null },
  };
}

/** Venta visible para el personal de la tienda (RLS). */
export async function loadSale(sb: SupabaseClient, id: string): Promise<Sale | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: s } = await sb.from('sales').select('*').eq('id', id).maybeSingle();
  return s ? build(s) : null;
}

/** Pedido web por su código de seguimiento (para el cliente, sin cuenta). */
export async function loadSaleByTracking(code: string): Promise<Sale | null> {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,16}$/.test(c)) return null;
  const admin = createAdminClient();
  const { data: s } = await admin.from('sales').select('*').eq('tracking_code', c).maybeSingle();
  return s ? build(s, admin) : null;
}

const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');

/** Comprobante en formato ticket (80 mm), apto para impresora térmica o para enviar en PDF. */
export async function salePdf(s: Sale): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`Comprobante ${s.number} - ${s.org.name}`));
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 226.77, M = 12, lines: (() => void)[] = [];
  let h = 40;
  const ops: { t: string; size: number; f: typeof reg; align: 'l' | 'c' | 'r' | 'lr'; right?: string; color?: ReturnType<typeof rgb> }[] = [];
  const add = (t: string, size = 8, f = reg, align: 'l' | 'c' | 'r' | 'lr' = 'l', right?: string, color?: ReturnType<typeof rgb>) => {
    // corta líneas largas
    let txt = clean(t);
    const max = W - 2 * M - (right ? f.widthOfTextAtSize(clean(right), size) + 6 : 0);
    while (txt.length && f.widthOfTextAtSize(txt, size) > max) {
      let cut = txt.length; while (cut > 1 && f.widthOfTextAtSize(txt.slice(0, cut), size) > max) cut--;
      const sp = txt.lastIndexOf(' ', cut); const at = sp > 10 ? sp : cut;
      ops.push({ t: txt.slice(0, at), size, f, align: align === 'lr' ? 'l' : align }); h += size + 3; txt = txt.slice(at).trimStart();
    }
    ops.push({ t: txt, size, f, align, right: right ? clean(right) : undefined, color }); h += size + 3;
  };
  const sep = () => { ops.push({ t: '-'.repeat(60), size: 7, f: reg, align: 'c' }); h += 10; };
  add(s.org.name, 11, bold, 'c');
  if (s.org.legal && s.org.legal !== s.org.name) add(s.org.legal, 7, reg, 'c');
  if (s.org.taxId) add(`RUT ${s.org.taxId}`, 7, reg, 'c');
  if (s.org.address) add(s.org.address, 7, reg, 'c');
  sep();
  add(`BOLETA ${s.code}`, 10, bold, 'c');
  add(fmtDateTime(s.paidAt ?? s.createdAt), 7, reg, 'c');
  add(s.channel === 'web' ? `Pedido web · ${s.delivery === 'despacho' ? 'Despacho' : 'Retiro en tienda'}` : 'Venta en caja', 7, reg, 'c');
  if (s.seller) add(`Atendido por: ${s.seller.name}${s.seller.doc ? ` · RUT ${s.seller.doc}` : ''}`, 7);
  if (s.customer.name) add(`Cliente: ${s.customer.name}`, 7);
  if (s.customer.doc) add(s.customer.doc, 7);
  sep();
  for (const i of s.items) {
    add(i.name, 8, bold);
    add(`  ${Number.isInteger(i.qty) ? i.qty : i.qty.toFixed(3)} ${i.unit === 'unidad' ? 'x' : `${i.unit} x`} ${fmtMoney(i.unitPrice, s.currency)}${i.taxRate === 0 ? ' (exento)' : ''}`, 7, reg, 'lr', fmtMoney(i.total, s.currency));
    if (i.promoDiscount > 0) add(`  Oferta ${i.promo ?? ''} -${fmtMoney(i.promoDiscount, s.currency)}`, 7);
    if (i.discount - i.promoDiscount > 0) add(`  Descuento -${fmtMoney(i.discount - i.promoDiscount, s.currency)}`, 7);
    if (i.serial) add(`  N° serie: ${i.serial}`, 7);
    if (i.warranty) add(`  Garantía hasta ${fmtDate(i.warranty)}`, 7);
  }
  sep();
  if (s.discount > 0) {
    add('Subtotal', 8, reg, 'lr', fmtMoney(s.subtotal, s.currency));
    if (s.discount - (s.coupon?.discount ?? 0) > 0) add('Descuento', 8, reg, 'lr', `-${fmtMoney(s.discount - (s.coupon?.discount ?? 0), s.currency)}`);
    if (s.coupon) add(`Cupón ${s.coupon.code}`, 8, reg, 'lr', `-${fmtMoney(s.coupon.discount, s.currency)}`);
  }
  const ahorro = s.items.reduce((t, i) => t + i.promoDiscount, 0) + (s.coupon?.discount ?? 0);
  const neto = s.total - s.tax;
  add('Neto', 8, reg, 'lr', fmtMoney(neto, s.currency)); add('IVA (19%)', 8, reg, 'lr', fmtMoney(s.tax, s.currency));
  add('TOTAL', 12, bold, 'lr', fmtMoney(s.total, s.currency));
  add(`Pago: ${methodLabel(s.method)}${s.paidAt ? '' : ' (pendiente)'}`, 8);
  if (s.cash !== null) { add('Efectivo recibido', 8, reg, 'lr', fmtMoney(s.cash, s.currency)); add('Vuelto', 8, bold, 'lr', fmtMoney(s.change ?? 0, s.currency)); }
  if (s.tracking) add(`Código de seguimiento: ${s.tracking}`, 7);
  sep();
  if (ahorro > 0) add(`¡Usted ahorró ${fmtMoney(ahorro, s.currency)}!`, 8, bold, 'c');
  add('¡Gracias por su compra!', 8, bold, 'c');
  add('Documento interno. No reemplaza la boleta electrónica del SII.', 6, reg, 'c');
  if (s.status === 'anulada') add(`ANULADO: ${s.cancelReason ?? ''}`, 9, bold, 'c', undefined, rgb(0.8, 0.1, 0.1));
  void lines;
  const page = pdf.addPage([W, Math.max(h + 20, 200)]);
  let y = page.getHeight() - 20;
  for (const o of ops) {
    y -= o.size;
    const w = o.f.widthOfTextAtSize(o.t, o.size);
    const x = o.align === 'c' ? (W - w) / 2 : o.align === 'r' ? W - M - w : M;
    page.drawText(o.t, { x, y, size: o.size, font: o.f, color: o.color ?? rgb(0, 0, 0) });
    if (o.right) page.drawText(o.right, { x: W - M - o.f.widthOfTextAtSize(o.right, o.size), y, size: o.size, font: o.f });
    y -= 3;
  }
  if (s.status === 'anulada') page.drawText('ANULADO', { x: 30, y: page.getHeight() / 2, size: 40, font: bold, color: rgb(0.86, 0.15, 0.15), opacity: 0.25, rotate: degrees(35) });
  return pdf.save();
}

export const saleFilename = (s: Sale) => `Boleta-${s.code}.pdf`;
export const saleStatusLabel = (st: string) => SALE_STATUS[st]?.[0] ?? st;
