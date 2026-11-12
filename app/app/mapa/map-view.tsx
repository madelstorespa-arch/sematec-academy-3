'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

type Group = { key: string; title: string; icon: string; color: string; items: { href: string; label: string; icon: string; desc: string }[] };

export function MapView({ groups }: { groups: Group[] }) {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const shown = useMemo(() => groups.map((g) => ({ ...g, items: g.items.filter((i) => !q || norm(`${i.label} ${i.desc} ${g.title}`).includes(norm(q))) })).filter((g) => g.items.length), [groups, q]);
  return (
    <div>
      <input className="input mb-6 max-w-xl text-base" placeholder="🔎 Buscar un sistema: notas, pagos, aula, correo…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="buscar-mapa" autoFocus />
      <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        {shown.map((g) => (
          <section key={g.key} className="card overflow-hidden" data-testid={`area-${g.key}`}>
            <header className={`flex items-center gap-3 bg-gradient-to-br ${g.color} px-5 py-4 text-white`}>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/20 text-2xl" aria-hidden>{g.icon}</span>
              <span><span className="block text-lg font-bold">{g.title}</span><span className="text-xs text-white/80">{g.items.length} sistema(s)</span></span>
            </header>
            <ul className="divide-y divide-slate-100">
              {g.items.map((i) => (
                <li key={i.href}><Link href={i.href} className="group flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50" data-testid="sistema-mapa">
                  <span className="text-xl" aria-hidden>{i.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold group-hover:text-brand-700">{i.label}</span><span className="block truncate text-xs text-slate-500">{i.desc}</span></span>
                  <span className="text-slate-300 group-hover:text-brand-600" aria-hidden>→</span></Link></li>))}
            </ul>
          </section>))}
      </div>
      {!shown.length && <p className="text-slate-500">No se encontró ningún sistema con «{q}».</p>}
    </div>
  );
}
