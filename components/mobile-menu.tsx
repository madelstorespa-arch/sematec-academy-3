'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** En celular el menú se pliega bajo un botón; en pantallas grandes siempre está visible. */
export function MobileMenu({ header, top, children }: { header: ReactNode; top?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <div className="flex items-center justify-between">
        {header}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Abrir menú"
          className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white lg:hidden">{open ? '✕ Cerrar' : '☰ Menú'}</button>
      </div>
      {top && <div className="mt-3">{top}</div>}
      <div className={`${open ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex`}>{children}</div>
    </>
  );
}
