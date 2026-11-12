import type { ModField } from '@/lib/modules';

const COLORS: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-800', amber: 'bg-amber-100 text-amber-900', green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800', slate: 'bg-slate-200 text-slate-700', violet: 'bg-violet-100 text-violet-800',
};

/** Etiqueta de color del estado de un registro. */
export function StatusBadge({ wf, k }: { wf: { key: string; label: string; color: string; final?: boolean }[]; k?: string | null }) {
  const w = wf.find((x) => x.key === k);
  if (!w) return <span className="text-xs text-slate-400">—</span>;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${COLORS[w.color] ?? COLORS.slate}`} data-testid="estado-registro">{w.final ? '✓ ' : ''}{w.label}</span>;
}

/** Campo del formulario según su tipo. */
export function FieldInput({ f, v }: { f: ModField; v?: unknown }) {
  const name = `f_${f.key}`;
  const val = v === null || v === undefined ? '' : String(v);
  const label = <span className="label">{f.label}{f.required && ' *'}</span>;
  if (f.type === 'checkbox') return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={v === true} /> {f.label}</label>;
  if (f.type === 'textarea') return <label className="block sm:col-span-2">{label}<textarea name={name} required={f.required} defaultValue={val} rows={3} maxLength={5000} className="input" /></label>;
  if (f.type === 'select') return (
    <label className="block">{label}<select name={name} required={f.required} defaultValue={val} className="input">
      <option value="">— Elegir —</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select></label>);
  const type = { number: 'number', money: 'number', date: 'date', email: 'email', phone: 'tel' }[f.type as string] ?? 'text';
  return <label className="block">{label}<input name={name} type={type} step={f.type === 'money' || f.type === 'number' ? 'any' : undefined} required={f.required} defaultValue={val} maxLength={500} className="input" /></label>;
}
