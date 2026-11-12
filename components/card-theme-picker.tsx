'use client';
import { useState } from 'react';
import { CARD_COLORS, CARD_STYLES, cardThemeAttrs, type CardTheme } from '@/lib/card-theme';

/** Selector de estilo y color de las tarjetas con vista previa en vivo. */
export function CardThemePicker({ value, allowInherit = false, inherited }: { value: CardTheme | null; allowInherit?: boolean; inherited?: CardTheme }) {
  const base = value ?? inherited ?? { style: 'clasico', color: '#1f45c8', panels: false };
  const [inherit, setInherit] = useState(allowInherit && !value);
  const [style, setStyle] = useState<string>(base.style);
  const [color, setColor] = useState(base.color);
  const [panels, setPanels] = useState(base.panels);
  const shown: CardTheme = inherit && inherited ? inherited : { style: style as CardTheme['style'], color, panels };
  const attrs = cardThemeAttrs(shown);
  return (
    <div className="space-y-5">
      {allowInherit && (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="card_inherit" value="on" checked={inherit} onChange={(e) => setInherit(e.target.checked)} data-testid="tarjetas-heredar" />
          Usar los colores definidos por la institución
        </label>
      )}
      <fieldset disabled={inherit} className={inherit ? 'pointer-events-none opacity-50' : ''}>
        <legend className="label">Estilo</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CARD_STYLES.map(([k, l, d]) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-300 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="radio" name="card_style" value={k} checked={style === k} onChange={() => setStyle(k)} className="mt-1" data-testid={`tarjetas-estilo-${k}`} />
              <span><b>{l}</b><span className="block text-xs text-slate-500">{d}</span></span>
            </label>))}
        </div>
        <p className="label mt-5">Color</p>
        <div className="flex flex-wrap items-center gap-2">
          {CARD_COLORS.map(([c, n]) => (
            <button key={c} type="button" onClick={() => setColor(c)} title={n} aria-label={n} aria-pressed={color === c}
              className={`h-9 w-9 rounded-full border-2 shadow-sm transition ${color === c ? 'scale-110 border-ink ring-2 ring-offset-2 ring-slate-400' : 'border-white'}`} style={{ background: c }} />))}
          <label className="ml-2 flex items-center gap-2 text-xs text-slate-600">Otro:
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" data-testid="tarjetas-color" />
          </label>
          <input type="hidden" name="card_color" value={color} />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" name="card_panels" value="on" checked={panels} onChange={(e) => setPanels(e.target.checked)} />
          Colorear también los títulos de los paneles</label>
      </fieldset>
      <div>
        <p className="label">Vista previa</p>
        <div {...attrs} style={attrs.style as React.CSSProperties} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3" data-testid="tarjetas-vista-previa">
          {[['Estudiantes activos', '128'], ['Matrículas', '342'], ['Saldo pendiente', '$ 1.250.000']].map(([l, v]) => (
            <div key={l} className="stat-card card card-pad">
              <p className="stat-label text-xs font-semibold uppercase tracking-wide text-slate-500">{l}</p>
              <p className="stat-value mt-2 text-2xl font-bold text-ink">{v}</p>
            </div>))}
          <section className="card sm:col-span-3"><div className="card-head border-b border-slate-100 px-5 py-2"><h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">Panel de ejemplo</h2></div><div className="card-pad text-xs text-slate-500">Contenido</div></section>
        </div>
      </div>
    </div>
  );
}
