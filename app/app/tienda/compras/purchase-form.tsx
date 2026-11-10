'use client';
import { useState } from 'react';
import { ActionForm } from '@/components/forms';
import { registerPurchase } from '../actions';

type P = { id: string; sku: string; name: string; cost: number; unit: string; track_expiry: boolean };
type Row = { key: number; product: string; qty: string; cost: string };

/** Compra con varias líneas: producto, cantidad, costo, lote y vencimiento (si corresponde). */
export function PurchaseForm({ products }: { products: P[] }) {
  const [rows, setRows] = useState<Row[]>([{ key: 1, product: '', qty: '', cost: '' }]);
  const set = (k: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const total = rows.reduce((t, r) => t + (Number(r.qty) || 0) * (Number(r.cost) || 0), 0);
  return (
    <ActionForm action={registerPurchase} submitLabel="Registrar compra" onDone={(r) => { if (r.ok) setRows([{ key: Date.now(), product: '', qty: '', cost: '' }]); }}>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block md:col-span-2"><span className="label">Proveedor</span><input name="supplier" className="input" placeholder="Ej.: Distribuidora Central" /></label>
        <label className="block"><span className="label">N° factura / boleta</span><input name="document_number" className="input" /></label>
        <label className="block"><span className="label">Fecha</span><input name="purchased_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></label>
      </div>
      <div className="mt-4 space-y-2" data-testid="lineas-compra">
        {rows.map((r) => {
          const p = products.find((x) => x.id === r.product);
          return (
            <div key={r.key} className="grid items-end gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
              <label className="block"><span className="label">Producto</span>
                <select name="product" required value={r.product} className="input" onChange={(e) => { const np = products.find((x) => x.id === e.target.value); set(r.key, { product: e.target.value, cost: r.cost || String(np?.cost ?? '') }); }}>
                  <option value="">Seleccione…</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.sku})</option>)}</select></label>
              <label className="block"><span className="label">Cantidad{p && p.unit !== 'unidad' ? ` (${p.unit})` : ''}</span><input name="qty" type="number" min={0.001} step="any" required value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} className="input" /></label>
              <label className="block"><span className="label">Costo unitario</span><input name="cost" type="number" min={0} step="0.01" required value={r.cost} onChange={(e) => set(r.key, { cost: e.target.value })} className="input" /></label>
              <label className="block"><span className="label">Vence el{p?.track_expiry ? ' *' : ''}</span><input name="expires" type="date" required={!!p?.track_expiry} className="input" /></label>
              <label className="block"><span className="label">Lote</span><input name="lot" className="input" /></label>
              <button type="button" className="mb-1 text-slate-400 hover:text-red-600" aria-label="Quitar línea" onClick={() => setRows((x) => (x.length > 1 ? x.filter((y) => y.key !== r.key) : x))}>✕</button>
            </div>);
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((r) => [...r, { key: Date.now(), product: '', qty: '', cost: '' }])}>➕ Agregar producto</button>
        <p className="text-lg font-bold">Total: {new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(total)}</p>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="expense" defaultChecked /> Registrar como gasto de «Mercadería» en Finanzas</label>
      <label className="mt-2 block"><span className="label">Nota</span><input name="notes" className="input" /></label>
    </ActionForm>
  );
}
