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
