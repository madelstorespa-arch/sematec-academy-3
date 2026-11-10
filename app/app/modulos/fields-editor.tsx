'use client';
import { useState } from 'react';
import { FIELD_TYPES, keyOf, type ModField } from '@/lib/modules';

type Row = ModField & { optText: string; uid: number };
let uid = 0;
const toRow = (f: ModField): Row => ({ ...f, optText: (f.options ?? []).join(', '), uid: ++uid });

/** Diseñador de campos: agregar, quitar, ordenar, tipo, obligatorio, opciones y si se muestra en la tabla. */
export function FieldsEditor({ initial }: { initial?: ModField[] }) {
  const [rows, setRows] = useState<Row[]>(() => (initial?.length ? initial : [{ key: 'nombre', label: 'Nombre', type: 'text', required: true, list: true } as ModField]).map(toRow));
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const json = JSON.stringify(rows.map(({ optText, uid: _u, ...f }) => ({ ...f, key: f.key || keyOf(f.label), options: f.type === 'select' ? optText.split(',') : undefined })));
  return (
    <div className="space-y-2" data-testid="disenador-campos">
      <input type="hidden" name="fields" value={json} />
      <p className="label">Campos del formulario</p>
      {rows.map((f, i) => (
        <div key={f.uid} className="rounded-xl border border-slate-200 bg-slate-50 p-2" data-testid="campo">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-[10rem] flex-1" value={f.label} maxLength={60} placeholder="Nombre del campo (ej.: Teléfono)" aria-label="Nombre del campo"
              onChange={(e) => set(i, { label: e.target.value, key: initial?.some((x) => x.key === f.key) ? f.key : keyOf(e.target.value) })} />
            <select className="input w-auto" value={f.type} onChange={(e) => set(i, { type: e.target.value as Row['type'] })} aria-label="Tipo de campo">
              {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })} /> Obligatorio</label>
            <label className="flex items-center gap-1 text-xs" title="Mostrar como columna en la tabla"><input type="checkbox" checked={f.list !== false} onChange={(e) => set(i, { list: e.target.checked })} /> En la tabla</label>
            <span className="flex gap-1">
              <button type="button" className="rounded px-1.5 hover:bg-slate-200" onClick={() => move(i, -1)} aria-label="Subir">↑</button>
              <button type="button" className="rounded px-1.5 hover:bg-slate-200" onClick={() => move(i, 1)} aria-label="Bajar">↓</button>
              <button type="button" className="rounded px-1.5 text-red-600 hover:bg-red-50" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Quitar campo">✕</button>
            </span>
          </div>
          {f.type === 'select' && <input className="input mt-2" value={f.optText} onChange={(e) => set(i, { optText: e.target.value })} placeholder="Opciones separadas por coma: Pendiente, En proceso, Listo" aria-label="Opciones" />}
        </div>))}
      <button type="button" className="btn-secondary text-sm" data-testid="agregar-campo" disabled={rows.length >= 40}
        onClick={() => setRows((r) => [...r, toRow({ key: '', label: '', type: 'text', list: true })])}>➕ Agregar campo</button>
    </div>
  );
}
