'use client';
/**
 * 📊 Hoja de cálculo de SEMATEC Oficina: modelo, fórmulas (más de 280 funciones de Excel, también con
 * nombres en español: SUMA, PROMEDIO, SI…), formato de números e importación/exportación XLSX, CSV, ODS, PDF y HTML.
 */
import type { Fmt } from '@/lib/convert/media';

export type Borders = { t?: boolean; b?: boolean; l?: boolean; r?: boolean };
export type CellStyle = { b?: boolean; i?: boolean; u?: boolean; color?: string; bg?: string; align?: 'left' | 'center' | 'right'; fmt?: 'general' | 'number' | 'currency' | 'percent' | 'date' | 'text'; dec?: number; size?: number; bd?: Borders };
/** Formato condicional: si el valor de la celda cumple la condición, se pinta con estos colores. */
export type CondRule = { range: string; op: '>' | '<' | '>=' | '<=' | '=' | '<>' | 'contains' | 'empty'; v: string; bg?: string; color?: string; b?: boolean };
/** Filtro: fila de encabezados y texto buscado por columna (las filas que no coinciden se ocultan). */
export type SheetFilter = { row: number; c1: number; c2: number; q: Record<number, string> };
export type Cell = { v: string; s?: CellStyle };
export type Sheet = { name: string; cells: Record<string, Cell>; widths?: Record<number, number>; rows: number; cols: number; hidden?: boolean; filter?: SheetFilter; cond?: CondRule[] };
export type Workbook = { sheets: Sheet[] };
export type Value = number | string | boolean | null | { error: string };

export const SHEET_FORMATS: Fmt[] = [
  { id: 'xlsx', label: 'Excel (.xlsx)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { id: 'csv', label: 'CSV (valores separados)', ext: 'csv', mime: 'text/csv' },
  { id: 'ods', label: 'OpenDocument (.ods)', ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', hint: 'LibreOffice, Google Sheets' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { id: 'html', label: 'Página web (.html)', ext: 'html', mime: 'text/html' },
  { id: 'tsv', label: 'Texto separado por tabulaciones (.tsv)', ext: 'tsv', mime: 'text/tab-separated-values' },
];
export const SHEET_EXT = ['xlsx', 'csv', 'tsv', 'ods'];

export const newSheet = (name = 'Hoja1', rows = 60, cols = 16): Sheet => ({ name, cells: {}, rows, cols });
export const newWorkbook = (): Workbook => ({ sheets: [newSheet()] });

// ---------------------------------------------------------------- direcciones
export const colName = (c: number) => { let s = ''; let n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`;
export const parseAddr = (a: string): [number, number] | null => {
  const m = a.toUpperCase().match(/^([A-Z]{1,3})(\d{1,6})$/); if (!m) return null;
  let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, c - 1];
};

// ---------------------------------------------------------------- fórmulas
const ES: Record<string, string> = {
  'SUMAR.SI.CONJUNTO': 'SUMIFS', 'CONTAR.SI.CONJUNTO': 'COUNTIFS', 'PROMEDIO.SI.CONJUNTO': 'AVERAGEIFS', 'PROMEDIO.SI': 'AVERAGEIF', 'SUMAR.SI': 'SUMIF',
  'CONTAR.SI': 'COUNTIF', 'CONTAR.BLANCO': 'COUNTBLANK', 'SI.ERROR': 'IFERROR', 'SI.CONJUNTO': 'IFS', 'DESVEST': 'STDEV', SUMA: 'SUM', PROMEDIO: 'AVERAGE', SI: 'IF', CONTARA: 'COUNTA',
  CONTAR: 'COUNT', REDONDEAR: 'ROUND', 'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN', HOY: 'TODAY', AHORA: 'NOW', BUSCARV: 'VLOOKUP', BUSCARH: 'HLOOKUP',
  CONCATENAR: 'CONCATENATE', Y: 'AND', O: 'OR', NO: 'NOT', MEDIANA: 'MEDIAN', ENTERO: 'INT', POTENCIA: 'POWER', RAIZ: 'SQRT', MAYUSC: 'UPPER', MINUSC: 'LOWER',
  LARGO: 'LEN', IZQUIERDA: 'LEFT', DERECHA: 'RIGHT', EXTRAE: 'MID', TEXTO: 'TEXT', FECHA: 'DATE', 'AÑO': 'YEAR', MES: 'MONTH', DIA: 'DAY', COINCIDIR: 'MATCH',
  INDICE: 'INDEX', ESBLANCO: 'ISBLANK', ESNUMERO: 'ISNUMBER', RESIDUO: 'MOD', 'K.ESIMO.MAYOR': 'LARGE', 'K.ESIMO.MENOR': 'SMALL', ESPACIOS: 'TRIM', 'NOMPROPIO': 'PROPER',
  SUSTITUIR: 'SUBSTITUTE', ALEATORIO: 'RAND', 'ALEATORIO.ENTRE': 'RANDBETWEEN', PRODUCTO: 'PRODUCT', ABS: 'ABS', MAX: 'MAX', MIN: 'MIN', BUSCARX: 'XLOOKUP', 'SI.ND': 'IFNA', 'COINCIDIRX': 'XMATCH',
};
/** Acepta nombres de funciones en español y el separador «;» de Excel en español. */
export function normalizeFormula(f: string) {
  let out = ''; let inStr = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (!inStr && ch === ';') { out += ','; continue; }
    out += ch;
  }
  return out.replace(/(^|[^A-Z0-9_.])([A-ZÑÁÉÍÓÚ][A-ZÑÁÉÍÓÚ0-9.]*)\s*\(/gi, (m, pre, name) => `${pre}${ES[name.toUpperCase()] ?? name.toUpperCase()}(`);
}

export function parseLiteral(raw: string): Value {
  const t = raw.trim();
  if (t === '') return null;
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) return Number(t);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  if (/^-?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  if (/^(verdadero|true)$/i.test(t)) return true;
  if (/^(falso|false)$/i.test(t)) return false;
  return raw;
}

type Parser = { parse: (f: string, pos: { sheet: string; row: number; col: number }) => unknown };
let ParserCtor: (new (cfg: object) => Parser) | null = null;
let FErr: { new (...a: unknown[]): unknown } | null = null;
export async function loadEngine() {
  if (!ParserCtor) {
    const m = await import('fast-formula-parser');
    ParserCtor = (m.default ?? m) as unknown as new (cfg: object) => Parser;
    FErr = ((m as unknown as { FormulaError: typeof FErr }).FormulaError ?? (m.default as unknown as { FormulaError: typeof FErr })?.FormulaError) ?? null;
  }
}

/** Calcula todos los valores del libro (con detección de referencias circulares). */
export function computeWorkbook(wb: Workbook): Record<string, Record<string, Value>> {
  const out: Record<string, Record<string, Value>> = {};
  if (!ParserCtor) {
    for (const s of wb.sheets) { out[s.name] = {}; for (const [k, c] of Object.entries(s.cells)) out[s.name][k] = c.v.startsWith('=') ? { error: '…' } : parseLiteral(c.v); }
    return out;
  }
  const byName = new Map(wb.sheets.map((s) => [s.name.toUpperCase(), s]));
  const visiting = new Set<string>();
  let parser: Parser;
  const toRaw = (v: Value): unknown => (v && typeof v === 'object' ? v.error : v === null ? undefined : v);
  const valueAt = (sheetName: string, r: number, c: number): Value => {
    const s = byName.get(sheetName.toUpperCase()); if (!s) return { error: '#REF!' };
    const key = addr(r, c); const memo = out[s.name] ?? (out[s.name] = {});
    if (key in memo) return memo[key];
    const cell = s.cells[key];
    if (!cell || cell.v === '') return null;
    if (!cell.v.startsWith('=') || cell.s?.fmt === 'text') { memo[key] = cell.s?.fmt === 'text' ? cell.v : parseLiteral(cell.v); return memo[key]; }
    const id = `${s.name}!${key}`;
    if (visiting.has(id)) return { error: '#CIRC!' };
    visiting.add(id);
    let v: Value;
    try {
      const r0 = parser.parse(normalizeFormula(cell.v.slice(1)), { sheet: s.name, row: r + 1, col: c + 1 }) as unknown;
      v = fromEngine(r0);
    } catch (e) { v = { error: errText(e) }; }
    visiting.delete(id);
    memo[key] = v;
    return v;
  };
  parser = new ParserCtor({
    onCell: ({ sheet, row, col }: { sheet: string; row: number; col: number }) => toRaw(valueAt(sheet, row - 1, col - 1)),
    onRange: (ref: { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }) => {
      const s = byName.get(ref.sheet.toUpperCase()); const rows: unknown[][] = [];
      const r2 = Math.min(ref.to.row, s?.rows ?? 0), c2 = Math.min(ref.to.col, s?.cols ?? 0);
      for (let r = ref.from.row; r <= r2; r++) { const row: unknown[] = []; for (let c = ref.from.col; c <= c2; c++) row.push(toRaw(valueAt(ref.sheet, r - 1, c - 1))); rows.push(row); }
      return rows;
    },
    functions: {
      COUNTA: (...args: { value: unknown }[]) => args.reduce((n, a) => n + (Array.isArray(a.value) ? (a.value as unknown[][]).flat().filter((x) => x !== undefined && x !== null && x !== '').length : a.value !== undefined && a.value !== null && a.value !== '' ? 1 : 0), 0),
      COUNTBLANK: (a: { value: unknown }) => (Array.isArray(a.value) ? (a.value as unknown[][]).flat().filter((x) => x === undefined || x === null || x === '').length : 0),
      UPPER: (a: { value: unknown }) => String(a.value ?? '').toUpperCase(),
      // BUSCARX / XLOOKUP(valor; matriz_buscada; matriz_devuelta; [si_no_se_encuentra]; [modo: 0 exacta, -1 menor, 1 mayor, 2 comodín])
      XLOOKUP: (look: { value: unknown }, where: { value: unknown }, ret: { value: unknown }, notFound?: { value: unknown }, mode?: { value: unknown }) => {
        const flat = (x: unknown) => (Array.isArray(x) ? x as unknown[][] : [[x]]);
        const W = flat(where.value); const R = flat(ret.value);
        const vertical = W.length >= (W[0]?.length ?? 0);
        const list = vertical ? W.map((r) => r[0]) : W[0];
        const key = look.value; const m = Number(mode?.value ?? 0);
        const eq = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es') : a === b);
        let idx = -1;
        if (m === 2 && typeof key === 'string') { const re = new RegExp(`^${key.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'); idx = list.findIndex((x) => re.test(String(x ?? ''))); }
        else idx = list.findIndex((x) => eq(x, key));
        if (idx < 0 && (m === -1 || m === 1) && typeof key === 'number') {
          let best = -1;
          list.forEach((x, i) => { if (typeof x !== 'number') return; if (m === -1 ? x <= key && (best < 0 || x > (list[best] as number)) : x >= key && (best < 0 || x < (list[best] as number))) best = i; });
          idx = best;
        }
        if (idx < 0) { if (notFound && notFound.value !== undefined && notFound.value !== null) return notFound.value; if (FErr) throw (FErr as unknown as { NA: unknown }).NA; return '#N/A'; }
        return vertical ? (R[idx]?.[0] ?? null) : (R[0]?.[idx] ?? null);
      },
      STDEV: (...args: { value: unknown }[]) => {
        const xs = args.flatMap((a) => (Array.isArray(a.value) ? (a.value as unknown[][]).flat() : [a.value])).filter((x): x is number => typeof x === 'number');
        if (xs.length < 2) return 0; const m = xs.reduce((s, x) => s + x, 0) / xs.length;
        return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
      },
    },
  });
  for (const s of wb.sheets) { out[s.name] = out[s.name] ?? {}; for (const k of Object.keys(s.cells)) { const p = parseAddr(k); if (p) valueAt(s.name, p[0], p[1]); } }
  return out;
}

function errText(e: unknown) {
  const m = (e as { _error?: string; error?: string; message?: string })?._error ?? (e as { error?: string })?.error;
  if (typeof m === 'string' && m.startsWith('#')) return m;
  return '#ERROR!';
}
function fromEngine(v: unknown): Value {
  if (v === undefined || v === null) return 0;
  if (FErr && v instanceof FErr) return { error: errText(v) };
  if (typeof v === 'object' && v && '_error' in (v as object)) return { error: errText(v) };
  if (Array.isArray(v)) return fromEngine((v as unknown[][])[0]?.[0]);
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  return String(v);
}

// ---------------------------------------------------------------- formato condicional y filtros
export function parseRange(a: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [x, y] = a.toUpperCase().split(':'); const p = parseAddr(x); const q = parseAddr(y ?? x);
  return p && q ? { r1: Math.min(p[0], q[0]), c1: Math.min(p[1], q[1]), r2: Math.max(p[0], q[0]), c2: Math.max(p[1], q[1]) } : null;
}
export function condMatch(rule: CondRule, v: Value): boolean {
  if (rule.op === 'empty') return v === null || v === '';
  if (v === null || typeof v === 'object') return false;
  const target = parseLiteral(rule.v);
  if (rule.op === 'contains') return String(v).toLocaleLowerCase('es').includes(rule.v.toLocaleLowerCase('es'));
  const a = typeof v === 'boolean' ? Number(v) : v; const b = typeof target === 'boolean' ? Number(target) : target;
  if (typeof a === 'number' && typeof b === 'number') return { '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '=': a === b, '<>': a !== b }[rule.op];
  const sa = String(a).toLocaleLowerCase('es'), sb = String(b ?? '').toLocaleLowerCase('es');
  return rule.op === '=' ? sa === sb : rule.op === '<>' ? sa !== sb : false;
}
/** Estilo extra que aporta el formato condicional a una celda (o undefined). */
export function condStyle(sheet: Sheet, r: number, c: number, v: Value): Partial<CellStyle> | undefined {
  for (const rule of sheet.cond ?? []) {
    const g = parseRange(rule.range); if (!g || r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue;
    if (condMatch(rule, v)) return { bg: rule.bg, color: rule.color, b: rule.b || undefined };
  }
  return undefined;
}
/** Filas visibles según el filtro de la hoja. */
export function visibleRows(sheet: Sheet, vals: Record<string, Value>, total: number): number[] {
  const f = sheet.filter; const out: number[] = [];
  const qs = f ? Object.entries(f.q).filter(([, t]) => t.trim()) : [];
  for (let r = 0; r < total; r++) {
    if (!f || r <= f.row || !qs.length) { out.push(r); continue; }
    const ok = qs.every(([c, t]) => display(vals[addr(r, Number(c))] ?? null).toLocaleLowerCase('es').includes(t.trim().toLocaleLowerCase('es')));
    if (ok) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- formato
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export const serialToDate = (n: number) => new Date(EXCEL_EPOCH + Math.round(n * 86400000));
export function display(v: Value, s?: CellStyle): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return v.error;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'string') return v;
  const dec = s?.dec;
  switch (s?.fmt) {
    case 'currency': return `$${v.toLocaleString('es-CL', { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 0 })}`;
    case 'percent': return `${(v * 100).toLocaleString('es-CL', { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 2 })}%`;
    case 'number': return v.toLocaleString('es-CL', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 });
    case 'date': return serialToDate(v).toLocaleDateString('es-CL', { timeZone: 'UTC' });
    default: return Number.isInteger(v) ? v.toLocaleString('es-CL', { useGrouping: Math.abs(v) >= 10000 }) : v.toLocaleString('es-CL', { maximumFractionDigits: 10 });
  }
}

const usedRange = (s: Sheet) => {
  let mr = -1, mc = -1;
  for (const k of Object.keys(s.cells)) { if (s.cells[k].v === '' && !s.cells[k].s) continue; const p = parseAddr(k); if (p) { mr = Math.max(mr, p[0]); mc = Math.max(mc, p[1]); } }
  return { rows: mr + 1, cols: mc + 1 };
};

// ---------------------------------------------------------------- importar
export async function readWorkbook(src: Blob, name: string): Promise<Workbook> {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return { sheets: [csvToSheet(await src.text(), baseSheetName(name), ext === 'tsv' ? '\t' : undefined)] };
  if (ext === 'ods') return readOds(src);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await src.arrayBuffer());
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const s = newSheet(ws.name.slice(0, 31), Math.max(60, ws.rowCount + 20), Math.max(16, ws.columnCount + 4));
    ws.columns?.forEach((c, i) => { if (c.width) (s.widths ??= {})[i] = Math.round(c.width * 7.5); });
    ws.eachRow({ includeEmpty: false }, (row, rn) => row.eachCell({ includeEmpty: false }, (cell, cn) => {
      const key = addr(rn - 1, cn - 1); const v = cell.value as unknown;
      let raw = '';
      if (cell.formula) raw = `=${cell.formula}`;
      else if (v instanceof Date) raw = v.toISOString().slice(0, 10);
      else if (v && typeof v === 'object' && 'richText' in (v as object)) raw = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
      else if (v && typeof v === 'object' && 'text' in (v as object)) raw = String((v as { text: unknown }).text);
      else if (v && typeof v === 'object' && 'error' in (v as object)) raw = String((v as { error: unknown }).error);
      else if (v !== null && v !== undefined) raw = String(v);
      const st: CellStyle = {};
      if (cell.font?.bold) st.b = true; if (cell.font?.italic) st.i = true; if (cell.font?.underline) st.u = true;
      const fc = cell.font?.color?.argb; if (fc && fc.length === 8 && fc !== 'FF000000') st.color = `#${fc.slice(2)}`;
      const fill = (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb; if (fill && fill.length === 8 && fill !== 'FFFFFFFF') st.bg = `#${fill.slice(2)}`;
      const h = cell.alignment?.horizontal; if (h === 'center' || h === 'right' || h === 'left') st.align = h;
      const nf = cell.numFmt ?? '';
      if (/%/.test(nf)) st.fmt = 'percent'; else if (/\$|€|CLP/.test(nf)) st.fmt = 'currency'; else if (/[dmy]{2}/i.test(nf)) st.fmt = 'date'; else if (/0\.0/.test(nf)) st.fmt = 'number';
      s.cells[key] = Object.keys(st).length ? { v: raw, s: st } : { v: raw };
    }));
    sheets.push(s);
  });
  return { sheets: sheets.length ? sheets : [newSheet()] };
}
const baseSheetName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Hoja1';

export function csvToSheet(text: string, name = 'Hoja1', sep?: string): Sheet {
  const first = text.split(/\r?\n/)[0] ?? '';
  const d = sep ?? ([';', ',', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === d) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const s = newSheet(name, Math.max(60, rows.length + 20), Math.max(16, Math.max(0, ...rows.map((r) => r.length)) + 4));
  rows.forEach((r, ri) => r.forEach((v, ci) => { if (v !== '') s.cells[addr(ri, ci)] = { v }; }));
  return s;
}

async function readOds(src: Blob): Promise<Workbook> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await src.arrayBuffer());
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('El archivo ODS no tiene contenido.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const sheets: Sheet[] = [];
  for (const tb of [...doc.getElementsByTagName('table:table')]) {
    const s = newSheet((tb.getAttribute('table:name') ?? `Hoja${sheets.length + 1}`).slice(0, 31));
    let r = 0;
    for (const tr of [...tb.getElementsByTagName('table:table-row')]) {
      const rep = Math.min(Number(tr.getAttribute('table:number-rows-repeated') ?? 1), 1000);
      for (let k = 0; k < rep; k++) {
        let c = 0;
        for (const tc of [...tr.children].filter((x) => x.tagName === 'table:table-cell' || x.tagName === 'table:covered-table-cell')) {
          const crep = Math.min(Number(tc.getAttribute('table:number-columns-repeated') ?? 1), 200);
          const f = tc.getAttribute('table:formula'); const val = tc.getAttribute('office:value');
          const text = [...tc.getElementsByTagName('text:p')].map((p) => p.textContent).join('\n');
          const raw = f ? `=${f.replace(/^of:=/, '').replace(/\[\.([A-Z]+\d+)(?::\.([A-Z]+\d+))?\]/g, (_, a, b) => (b ? `${a}:${b}` : a))}` : val ?? text;
          for (let j = 0; j < crep; j++) { if (raw) s.cells[addr(r, c)] = { v: raw }; c++; }
        }
        r++;
      }
    }
    const u = usedRange(s); s.rows = Math.max(60, u.rows + 20); s.cols = Math.max(16, u.cols + 4);
    sheets.push(s);
  }
  return { sheets: sheets.length ? sheets : [newSheet()] };
}

// ---------------------------------------------------------------- exportar
const NUMFMT: Record<string, string> = { currency: '"$"#,##0', percent: '0.00%', number: '#,##0.00', date: 'dd-mm-yyyy' };

export async function exportWorkbook(wb: Workbook, title: string, fmt: string, sheetIndex = 0): Promise<Blob> {
  await loadEngine();
  const values = computeWorkbook(wb);
  const one = wb.sheets[sheetIndex] ?? wb.sheets[0];
  if (fmt === 'csv' || fmt === 'tsv') {
    const d = fmt === 'tsv' ? '\t' : ';';
    const u = usedRange(one); const lines: string[] = [];
    for (let r = 0; r < u.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < u.cols; c++) {
        const v = values[one.name]?.[addr(r, c)];
        let t = v === null || v === undefined ? '' : typeof v === 'object' ? v.error : typeof v === 'number' ? String(v).replace('.', fmt === 'csv' ? ',' : '.') : String(v);
        if (/^[=+\-@]/.test(t) && typeof v !== 'number') t = `'${t}`; // evita fórmulas inyectadas al abrir en Excel
        row.push(/[";\t\n,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      lines.push(row.join(d));
    }
    return new Blob(['﻿' + lines.join('\r\n')], { type: fmt === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8' });
  }
  if (fmt === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const x = new ExcelJS.Workbook(); x.creator = 'SEMATEC Oficina'; x.title = title;
    for (const s of wb.sheets) {
      const ws = x.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Hoja', { state: s.hidden ? 'hidden' : 'visible' });
      Object.entries(s.widths ?? {}).forEach(([c, w]) => { ws.getColumn(Number(c) + 1).width = Math.max(4, Math.round(Number(w) / 7.5)); });
      for (const [k, cell] of Object.entries(s.cells)) {
        const p = parseAddr(k); if (!p || (cell.v === '' && !cell.s)) continue;
        const xc = ws.getCell(p[0] + 1, p[1] + 1);
        const v = values[s.name]?.[k];
        if (cell.v.startsWith('=') && cell.s?.fmt !== 'text') xc.value = { formula: normalizeFormula(cell.v.slice(1)), result: v && typeof v === 'object' ? undefined : (v as number | string | boolean) } as never;
        else { const lit = cell.s?.fmt === 'text' ? cell.v : parseLiteral(cell.v); xc.value = (lit && typeof lit === 'object' ? null : lit) as never; }
        const st = cell.s; if (!st) continue;
        xc.font = { bold: st.b, italic: st.i, underline: st.u, color: st.color ? { argb: `FF${st.color.slice(1).toUpperCase()}` } : undefined, size: st.size };
        if (st.bg) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${st.bg.slice(1).toUpperCase()}` } };
        if (st.align) xc.alignment = { horizontal: st.align };
        if (st.fmt && NUMFMT[st.fmt]) xc.numFmt = NUMFMT[st.fmt];
        if (st.bd) { const L = { style: 'thin' as const, color: { argb: 'FF000000' } }; xc.border = { top: st.bd.t ? L : undefined, bottom: st.bd.b ? L : undefined, left: st.bd.l ? L : undefined, right: st.bd.r ? L : undefined }; }
      }
      if (s.filter) ws.autoFilter = { from: { row: s.filter.row + 1, column: s.filter.c1 + 1 }, to: { row: s.filter.row + 1, column: s.filter.c2 + 1 } };
      for (const rule of s.cond ?? []) {
        const g = parseRange(rule.range); if (!g || rule.op === 'contains' || rule.op === 'empty') continue;
        const OP: Record<string, string> = { '>': 'greaterThan', '<': 'lessThan', '>=': 'greaterThanOrEqual', '<=': 'lessThanOrEqual', '=': 'equal', '<>': 'notEqual' };
        const lit = parseLiteral(rule.v);
        ws.addConditionalFormatting({ ref: `${addr(g.r1, g.c1)}:${addr(g.r2, g.c2)}`, rules: [{ type: 'cellIs', operator: OP[rule.op], priority: 1, formulae: [typeof lit === 'number' ? String(lit) : `"${String(rule.v).replace(/"/g, '""')}"`],
          style: { fill: rule.bg ? { type: 'pattern', pattern: 'solid', bgColor: { argb: `FF${rule.bg.slice(1).toUpperCase()}` } } : undefined, font: { color: rule.color ? { argb: `FF${rule.color.slice(1).toUpperCase()}` } : undefined, bold: rule.b } } }] as never });
      }
    }
    const buf = await x.xlsx.writeBuffer();
    return new Blob([buf], { type: SHEET_FORMATS[0].mime });
  }
  if (fmt === 'ods') return writeOds(wb, values);
  if (fmt === 'html') return new Blob([`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;margin-bottom:24px}td{border:1px solid #ccc;padding:3px 6px;font-size:13px}</style></head><body>${wb.sheets.map((s) => `<h2>${escapeXml(s.name)}</h2>${sheetTable(s, values[s.name] ?? {})}`).join('')}</body></html>`], { type: 'text/html;charset=utf-8' });
  if (fmt === 'pdf') return sheetToPdf(wb, values, title);
  throw new Error('Formato no disponible');
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function sheetTable(s: Sheet, vals: Record<string, Value>) {
  const u = usedRange(s); const rows: string[] = [];
  for (let r = 0; r < u.rows; r++) {
    rows.push(`<tr>${Array.from({ length: u.cols }, (_, c) => {
      const k = addr(r, c); const st = s.cells[k]?.s;
      const css = [st?.b && 'font-weight:bold', st?.i && 'font-style:italic', st?.color && `color:${st.color}`, st?.bg && `background:${st.bg}`, `text-align:${st?.align ?? (typeof vals[k] === 'number' ? 'right' : 'left')}`].filter(Boolean).join(';');
      return `<td style="${css}">${escapeXml(display(vals[k] ?? null, st))}</td>`;
    }).join('')}</tr>`);
  }
  return `<table>${rows.join('')}</table>`;
}

async function writeOds(wb: Workbook, values: Record<string, Record<string, Value>>) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  const tables = wb.sheets.map((s) => {
    const u = usedRange(s); const rows: string[] = [];
    for (let r = 0; r < Math.max(1, u.rows); r++) {
      const cells: string[] = [];
      for (let c = 0; c < Math.max(1, u.cols); c++) {
        const k = addr(r, c); const v = values[s.name]?.[k]; const raw = s.cells[k]?.v ?? '';
        const formula = raw.startsWith('=') ? ` table:formula="of:=${escapeXml(normalizeFormula(raw.slice(1)).replace(/\$?([A-Z]{1,3})\$?(\d+)/g, '[.$1$2]'))}"` : '';
        if (typeof v === 'number') cells.push(`<table:table-cell office:value-type="float" office:value="${v}"${formula}><text:p>${escapeXml(display(v, s.cells[k]?.s))}</text:p></table:table-cell>`);
        else if (v === null || v === undefined) cells.push('<table:table-cell/>');
        else cells.push(`<table:table-cell office:value-type="string"${formula}><text:p>${escapeXml(typeof v === 'object' ? v.error : typeof v === 'boolean' ? (v ? 'VERDADERO' : 'FALSO') : v)}</text:p></table:table-cell>`);
      }
      rows.push(`<table:table-row>${cells.join('')}</table:table-row>`);
    }
    return `<table:table table:name="${escapeXml(s.name)}"><table:table-column table:number-columns-repeated="${Math.max(1, u.cols)}"/>${rows.join('')}</table:table>`;
  }).join('');
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.2"><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' });
}

async function sheetToPdf(wb: Workbook, values: Record<string, Record<string, Value>>, title: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.setTitle(title);
  const f = await pdf.embedFont(StandardFonts.Helvetica); const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89, H = 595.28, M = 32; // horizontal
  const clean = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');
  const col = (h?: string) => (h ? rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255) : undefined);
  for (const s of wb.sheets) {
    const u = usedRange(s); if (!u.rows) continue;
    const widths = Array.from({ length: u.cols }, (_, c) => (s.widths?.[c] ?? 96) * 0.75);
    const scale = Math.min(1, (W - 2 * M) / widths.reduce((a, b) => a + b, 0));
    const rh = 16 * Math.max(scale, 0.7); const size = 9 * Math.max(scale, 0.7);
    let page = pdf.addPage([W, H]); let y = H - M;
    page.drawText(clean(s.name), { x: M, y: y - 12, size: 12, font: fb }); y -= 22;
    for (let r = 0; r < u.rows; r++) {
      if (y - rh < M) { page = pdf.addPage([W, H]); y = H - M; }
      let x = M;
      for (let c = 0; c < u.cols; c++) {
        const k = addr(r, c); const st = s.cells[k]?.s; const w = widths[c] * scale;
        if (st?.bg) page.drawRectangle({ x, y: y - rh, width: w, height: rh, color: col(st.bg) });
        page.drawRectangle({ x, y: y - rh, width: w, height: rh, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.4 });
        let t = clean(display(values[s.name]?.[k] ?? null, st)); const font = st?.b ? fb : f;
        while (t && font.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -1);
        const tw = font.widthOfTextAtSize(t, size);
        const align = st?.align ?? (typeof values[s.name]?.[k] === 'number' ? 'right' : 'left');
        page.drawText(t, { x: align === 'right' ? x + w - tw - 2 : align === 'center' ? x + (w - tw) / 2 : x + 2, y: y - rh + (rh - size) / 2 + 1, size, font, color: col(st?.color) ?? rgb(0.1, 0.1, 0.1) });
        x += w;
      }
      y -= rh;
    }
  }
  if (!pdf.getPageCount()) pdf.addPage([W, H]);
  return new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' });
}
