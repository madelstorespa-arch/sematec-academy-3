'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Menú del sitio para celulares y tablets. */
export function MobileNav({ links, label }: { links: [string, string][]; label: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="xl:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={label} data-testid="menu-movil"
        className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-ink hover:bg-slate-50">
        <span aria-hidden className="text-lg leading-none">{open ? '✕' : '☰'}</span>
      </button>
      {open && (
        <nav className="absolute inset-x-0 top-full border-b border-slate-200 bg-white px-4 pb-5 pt-2 shadow-xl">
          <ul className="mx-auto grid max-w-7xl gap-1 sm:grid-cols-2">
            {links.map(([h, l]) => (
              <li key={h + l}><Link href={h} className={`block rounded-xl px-4 py-3 font-semibold ${path === h ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</Link></li>))}
          </ul>
        </nav>
      )}
    </div>
  );
}
