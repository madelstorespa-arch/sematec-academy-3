/**
 * 🎨 Colores de las tarjetas del panel (cifras como «Estudiantes activos», «Saldo pendiente»…).
 * El propietario define el estilo de toda la institución y cada persona puede elegir el suyo.
 */
export const CARD_STYLES = [
  ['clasico', 'Clásico (blanco)', 'Tarjetas blancas con borde suave'],
  ['suave', 'Color suave', 'Fondo de color claro y cifra en color'],
  ['color', 'Color sólido', 'Fondo del color elegido y texto blanco'],
  ['degradado', 'Degradado', 'Degradado moderno del color elegido'],
  ['multicolor', 'Multicolor', 'Cada tarjeta de un color distinto'],
  ['borde', 'Franja de color', 'Tarjeta blanca con franja lateral de color'],
] as const;
export type CardStyle = (typeof CARD_STYLES)[number][0];
export type CardTheme = { style: CardStyle; color: string; panels: boolean };

export const CARD_COLORS: [string, string][] = [
  ['#1f45c8', 'Azul'], ['#0ea5e9', 'Celeste'], ['#10b5a3', 'Turquesa'], ['#16a34a', 'Verde'], ['#7c3aed', 'Violeta'],
  ['#db2777', 'Rosado'], ['#e11d48', 'Rojo'], ['#ea580c', 'Naranjo'], ['#ca8a04', 'Dorado'], ['#0f172a', 'Grafito'],
];

export const DEFAULT_CARD_THEME: CardTheme = { style: 'clasico', color: '#1f45c8', panels: false };
const HEX = /^#[0-9a-f]{6}$/i;

export function parseCardTheme(v: unknown): CardTheme | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const style = CARD_STYLES.find(([k]) => k === o.style)?.[0];
  if (!style) return null;
  return { style, color: typeof o.color === 'string' && HEX.test(o.color) ? o.color.toLowerCase() : DEFAULT_CARD_THEME.color, panels: o.panels === true };
}

/** Preferencia personal → configuración de la institución → clásico. */
export function resolveCardTheme(personal: unknown, institutional: unknown): CardTheme & { source: 'personal' | 'institucion' | 'defecto' } {
  const p = parseCardTheme(personal);
  if (p) return { ...p, source: 'personal' };
  const i = parseCardTheme(institutional);
  if (i) return { ...i, source: 'institucion' };
  return { ...DEFAULT_CARD_THEME, source: 'defecto' };
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Atributos para el contenedor de la aplicación (las reglas están en globals.css). */
export function cardThemeAttrs(t: CardTheme): { 'data-cards': string; 'data-card-panels'?: string; style: Record<string, string> } {
  return {
    'data-cards': t.style,
    ...(t.panels ? { 'data-card-panels': '1' } : {}),
    style: { '--card-c': t.color, '--card-c2': shade(t.color, -0.35), '--card-c3': shade(t.color, 0.25) },
  };
}

export function readCardForm(fd: FormData): CardTheme {
  const t = parseCardTheme({ style: String(fd.get('card_style') ?? ''), color: String(fd.get('card_color') ?? ''), panels: fd.getAll('card_panels').includes('on') });
  if (!t) throw new Error('Estilo de tarjetas inválido');
  return t;
}
