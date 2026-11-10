/** Tienda: tipos de producto, unidades, medios de pago y estados (textos en español). */
export const KINDS: [string, string, string][] = [
  ['aseo', 'Aseo y limpieza', '🧴'], ['comestible', 'Comestibles', '🥫'], ['bebestible', 'Bebestibles', '🥤'],
  ['electronica', 'Electrónica', '🔌'], ['otro', 'Otros', '📦'],
];
export const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
export const kindIcon = (k: string) => KINDS.find(([v]) => v === k)?.[2] ?? '📦';
export const UNITS = ['unidad', 'kg', 'g', 'litro', 'ml', 'pack', 'caja', 'metro'];
export const KIND_HINTS: Record<string, string> = {
  aseo: 'Ej.: detergente, cloro, papel higiénico, jabón.',
  comestible: 'Se controla la fecha de vencimiento por lote (se vende primero lo que vence antes).',
  bebestible: 'Se controla la fecha de vencimiento por lote (se vende primero lo que vence antes).',
  electronica: 'Puede pedir el N° de serie al vender y la garantía aparece en el comprobante.',
  otro: '',
};
export const SALE_METHODS: [string, string][] = [['cash', '💵 Efectivo'], ['card', '💳 Tarjeta (débito/crédito)'], ['bank_transfer', '🏦 Transferencia'], ['other', 'Otro']];
export const methodLabel = (m?: string | null) =>
  ({ cash: 'Efectivo', card: 'Tarjeta', bank_transfer: 'Transferencia', payment_gateway: 'Pago en línea', other: 'Otro' } as Record<string, string>)[m ?? ''] ?? '—';
export const SALE_STATUS: Record<string, [string, string]> = {
  pendiente_pago: ['Pendiente de pago', 'amber'], pagada: ['Pagado · por preparar', 'blue'], lista: ['Listo para retiro/despacho', 'blue'],
  entregada: ['Entregado', 'green'], anulada: ['Anulado', 'red'],
};
export const MOVE_LABEL: Record<string, string> = {
  inicial: 'Stock inicial', compra: 'Compra', venta: 'Venta en caja', ajuste: 'Ajuste de inventario', merma: 'Merma / vencido / dañado',
  devolucion: 'Devolución', anulacion: 'Anulación de venta', pedido_web: 'Pedido web', cancelacion: 'Pedido cancelado',
};
export const qtyFmt = (n: number | string, unit = 'unidad') => {
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toLocaleString('es-CL', { maximumFractionDigits: 3 })} ${unit === 'unidad' ? (Math.abs(v) === 1 ? 'unidad' : 'unidades') : unit}`;
};

/** Nombre por defecto de la tienda. */
export const STORE_NAME = 'SEMATEC VENTA';

export type Promo = { id: string; name: string; kind: 'percent' | 'amount' | 'price' | 'nxm'; value: number; buy_qty: number | null; pay_qty: number | null;
  scope: 'all' | 'kind' | 'category' | 'products'; scope_kind: string | null; scope_category: string | null; product_ids: string[]; channel: string;
  starts_at: string | null; ends_at: string | null; active: boolean; badge: string | null };
export const PROMO_KINDS: [string, string][] = [['percent', '% de descuento'], ['amount', '$ de descuento por unidad'], ['price', 'Precio oferta'], ['nxm', 'Lleva N y paga M (ej.: 3x2)']];
const round = (x: number, cur: string) => (['CLP', 'PYG', 'JPY', 'KRW', 'COP'].includes(cur) ? Math.round(x) : Math.round(x * 100) / 100);
export function promoLabel(p: Promo) {
  if (p.badge?.trim()) return p.badge.trim();
  if (p.kind === 'percent') return `-${Number(p.value)}%`;
  if (p.kind === 'amount') return `-$${Number(p.value).toLocaleString('es-CL')}`;
  if (p.kind === 'price') return 'Oferta';
  return `Lleva ${p.buy_qty} paga ${p.pay_qty}`;
}
export function promoDiscount(p: Promo, price: number, qty: number, cur: string) {
  const v = Number(p.value);
  const d = p.kind === 'percent' ? price * qty * v / 100 : p.kind === 'amount' ? Math.min(v, price) * qty
    : p.kind === 'price' ? Math.max(price - v, 0) * qty : Math.floor(qty / (p.buy_qty || 1)) * ((p.buy_qty ?? 0) - (p.pay_qty ?? 0)) * price;
  return Math.max(0, Math.min(price * qty, round(d, cur)));
}
/** Mejor promoción vigente (misma regla que la base de datos). */
export function bestPromo(promos: Promo[], prod: { id: string; kind: string; category: string | null; price: number; currency?: string }, qty: number, channel: 'caja' | 'web', now = Date.now()) {
  let best: { promo: Promo; discount: number; label: string } | null = null;
  for (const p of promos) {
    if (!p.active || (p.starts_at && Date.parse(p.starts_at) > now) || (p.ends_at && Date.parse(p.ends_at) <= now) || !['ambos', channel].includes(p.channel)) continue;
    const ok = p.scope === 'all' || (p.scope === 'kind' && p.scope_kind === prod.kind) || (p.scope === 'category' && (p.scope_category ?? '').toLowerCase() === (prod.category ?? '').toLowerCase())
      || (p.scope === 'products' && p.product_ids.includes(prod.id));
    if (!ok) continue;
    const d = promoDiscount(p, Number(prod.price), qty, prod.currency ?? 'CLP');
    if (!best || d > best.discount) best = { promo: p, discount: d, label: promoLabel(p) };
  }
  return best;
}
