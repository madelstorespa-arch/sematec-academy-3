'use client';
import { useRef } from 'react';

/** 🏢 Selector de sucursal: al elegir, todo el sistema muestra y registra los datos de esa sucursal. */
export function BranchSelect({ action, campuses, current, fixed }: {
  action: (fd: FormData) => Promise<void>; campuses: { id: string; name: string; city: string | null }[]; current: string | null; fixed: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  if (!campuses.length) return null;
  return (
    <form ref={form} action={action} className="mt-3 px-1" data-testid="selector-sucursal">
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-sky-200/70">🏢 Sucursal</label>
      {fixed ? <p className="rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white">{campuses[0].name}</p> : (
        <select name="branch" defaultValue={current ?? ''} onChange={() => form.current?.requestSubmit()} aria-label="Sucursal"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white">
          <option value="" className="text-ink">Todas las sucursales</option>
          {campuses.map((c) => <option key={c.id} value={c.id} className="text-ink">{c.name}{c.city ? ` · ${c.city}` : ''}</option>)}
        </select>)}
    </form>
  );
}
