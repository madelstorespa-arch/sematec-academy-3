'use client';
import { useState } from 'react';
import { KINDS, KIND_HINTS, UNITS } from '@/lib/store';

/** Etiqueta + campo. */
const L = ({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) => (
  <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>);

/** Campos del producto: muestra lo que corresponde al tipo (vencimiento para comestibles, garantía y serie para electrónica). */
export function ProductFields({ d = {}, isNew = false, categories = [] }: { d?: Record<string, any>; isNew?: boolean; categories?: string[] }) {
  const [kind, setKind] = useState<string>(d.kind ?? 'aseo');
  const [expiry, setExpiry] = useState<boolean>(d.track_expiry ?? (kind === 'comestible' || kind === 'bebestible'));
  const perishable = kind === 'comestible' || kind === 'bebestible';
  const elec = kind === 'electronica';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de producto">
        {KINDS.map(([k, l, i]) => (
          <label key={k} className={`cursor-pointer rounded-xl border-2 px-3 py-2 text-sm ${kind === k ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} className="sr-only"
              onChange={() => { setKind(k); if (isNew) setExpiry(k === 'comestible' || k === 'bebestible'); }} />{i} {l}</label>))}
      </div>
      {KIND_HINTS[kind] && <p className="text-xs text-slate-500">{KIND_HINTS[kind]}</p>}
      <div className="grid gap-3 md:grid-cols-4">
        <L label="Nombre *" className="md:col-span-2"><input name="name" required defaultValue={d.name} className="input" placeholder={perishable ? 'Ej.: Leche entera 1 L' : elec ? 'Ej.: Audífonos Bluetooth X1' : 'Ej.: Detergente líquido 3 L'} /></L>
        <L label="Código (automático si lo deja vacío)"><input name="sku" defaultValue={d.sku} className="input uppercase" placeholder={`${({ aseo: 'ASEO', comestible: 'COME', bebestible: 'BEBE', electronica: 'ELEC' } as Record<string, string>)[kind] ?? 'OTRO'}000001`} /></L>
        <L label="Código de barras"><input name="barcode" defaultValue={d.barcode ?? ''} className="input" placeholder="Escanee o escriba" inputMode="numeric" /></L>
        <L label="Precio de venta (IVA incluido) *"><input name="price" type="number" min={0} step="1" required defaultValue={d.price} className="input" /></L>
        <L label="Costo unitario"><input name="cost" type="number" min={0} step="0.01" defaultValue={d.cost ?? 0} className="input" /></L>
        <L label="Unidad"><select name="unit" defaultValue={d.unit ?? 'unidad'} className="input">{UNITS.map((u) => <option key={u}>{u}</option>)}</select></L>
        <L label="Stock mínimo (alerta)"><input name="min_stock" type="number" min={0} step="any" defaultValue={d.min_stock ?? 0} className="input" /></L>
        <L label="Categoría"><input name="category" list="categorias" defaultValue={d.category ?? ''} className="input" placeholder={perishable ? 'Lácteos, snacks, jugos…' : elec ? 'Audio, cargadores…' : 'Limpieza, papelería…'} />
          <datalist id="categorias">{categories.map((c) => <option key={c} value={c} />)}</datalist></L>
        <L label="Marca"><input name="brand" defaultValue={d.brand ?? ''} className="input" /></L>
        <L label="Foto (para la tienda web)"><input name="image" type="file" accept="image/png,image/jpeg,image/webp" className="input py-1.5 text-xs" /></L>
        {elec && <L label="Garantía (meses)"><input name="warranty_months" type="number" min={0} max={120} defaultValue={d.warranty_months ?? 6} className="input" /></L>}
        <L label="Descripción" className="md:col-span-4"><textarea name="description" rows={2} defaultValue={d.description ?? ''} className="input" /></L>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="online" defaultChecked={d.online ?? true} /> 🌐 Publicar en la tienda web</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="track_expiry" checked={expiry} onChange={(e) => setExpiry(e.target.checked)} /> 📅 Controlar vencimiento por lote</label>
        {elec && <label className="flex items-center gap-2"><input type="checkbox" name="requires_serial" defaultChecked={d.requires_serial ?? false} /> Pedir N° de serie al vender</label>}
        <label className="flex items-center gap-2"><input type="checkbox" name="exento" defaultChecked={d.tax_rate === 0} /> Exento de IVA</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="track_stock" value="off" defaultChecked={d.track_stock === false} /> No controlar stock (servicios)</label>
        {!isNew && <label className="flex items-center gap-2"><input type="checkbox" name="active" value="off" defaultChecked={d.active === false} /> Producto desactivado</label>}
      </div>
      {isNew && (
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-bold uppercase text-slate-500">Stock inicial (opcional)</legend>
          <div className="grid gap-3 md:grid-cols-3">
            <L label="Cantidad"><input name="initial_stock" type="number" min={0} step="any" className="input" /></L>
            {expiry && <><L label="Vence el"><input name="expires" type="date" className="input" /></L><L label="Lote"><input name="lot" className="input" /></L></>}
          </div>
        </fieldset>)}
    </div>
  );
}
