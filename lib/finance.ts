/** Categorías de gastos de la institución (deben coincidir con la base de datos). */
export const EXPENSE_CATEGORIES: [string, string][] = [
  ['remuneraciones', 'Remuneraciones / sueldos'], ['honorarios', 'Honorarios docentes'], ['arriendo', 'Arriendo'],
  ['servicios_basicos', 'Luz, agua, gas'], ['internet_tecnologia', 'Internet y tecnología'], ['materiales', 'Materiales y útiles'],
  ['marketing', 'Publicidad y marketing'], ['mantencion', 'Mantención y aseo'], ['impuestos', 'Impuestos y patentes'],
  ['comisiones', 'Comisiones bancarias / pasarela'], ['capacitacion', 'Capacitación'], ['mercaderia', 'Mercadería (compras tienda)'], ['otros', 'Otros'],
];
export const expenseLabel = (k: string) => EXPENSE_CATEGORIES.find(([v]) => v === k)?.[1] ?? k;

/** «2026-11» → primer y último día del mes. */
export function monthRange(from?: string | null, to?: string | null) {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ok = (s?: string | null) => (s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null);
  let a = ok(from) ?? cur, b = ok(to) ?? a;
  if (b < a) [a, b] = [b, a];
  const [y, m] = b.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: a, to: b, start: `${a}-01`, end: `${b}-${String(last).padStart(2, '0')}` };
}
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const monthName = (iso: string, short = false) => {
  const [y, m] = iso.split('-').map(Number);
  const n = MONTHS[m - 1] ?? '';
  return short ? `${n.slice(0, 3)} ${String(y).slice(2)}` : `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
};
