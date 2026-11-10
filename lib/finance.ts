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

export type Group = 'day' | 'week' | 'month' | 'semester' | 'year';
export const GROUPS: [Group, string, string][] = [
  ['day', 'Día', 'Día a día'], ['week', 'Semana', 'Semana a semana'], ['month', 'Mes', 'Mes a mes'], ['semester', 'Semestre', 'Por semestre'], ['year', 'Año', 'Año a año'],
];
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
/** Rango de fechas (acepta AAAA-MM o AAAA-MM-DD) y forma de agrupar. */
export function periodRange(desde?: string | null, hasta?: string | null, por?: string | null) {
  const today = isoDay(new Date());
  const norm = (s: string | null | undefined, end: boolean) => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)) { if (!end) return `${s}-01`; const [y, m] = s.split('-').map(Number); return `${s}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; }
    return null;
  };
  let start = norm(desde, false) ?? `${today.slice(0, 7)}-01`;
  let end = norm(hasta ?? desde, true) ?? today;
  if (end < start) [start, end] = [end, start];
  const group = (['day', 'week', 'month', 'semester', 'year'].includes(por ?? '') ? por : 'month') as Group;
  return { start, end, group };
}
export function bucketLabel(iso: string, g: Group, short = false) {
  const [y, m, d] = iso.split('-').map(Number);
  if (g === 'day') return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}${short ? '' : `-${y}`}`;
  if (g === 'week') return `${short ? 'Sem.' : 'Semana del'} ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}${short ? '' : `-${y}`}`;
  if (g === 'semester') return `${m <= 6 ? '1er' : '2do'} sem. ${y}`;
  if (g === 'year') return String(y);
  return monthName(iso, short);
}
/** Atajos: hoy, esta semana, este mes, este semestre, este año, últimos años. */
export function quickRanges() {
  const now = new Date(); const t = isoDay(now);
  const dow = (now.getDay() + 6) % 7; const monday = isoDay(new Date(now.getTime() - dow * 86400000));
  const y = now.getFullYear(), sem = now.getMonth() < 6 ? `${y}-01-01` : `${y}-07-01`;
  return [
    ['Hoy', t, t, 'day'], ['Esta semana', monday, t, 'day'], ['Este mes', `${t.slice(0, 7)}-01`, t, 'week'],
    ['Este semestre', sem, t, 'month'], ['Este año', `${y}-01-01`, t, 'month'], ['Por semestre', `${y - 2}-01-01`, t, 'semester'], ['Últimos 5 años', `${y - 4}-01-01`, t, 'year'],
  ] as [string, string, string, Group][];
}
