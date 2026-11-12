'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';

type Sys = { slug: string; name: string; icon: string; area: string | null; description: string | null; manage: boolean };
type Area = { key: string; title: string; icon: string; color: string };

/** Centro de sistemas: todos los sistemas activos que la persona puede usar, por área y con buscador. */
export function SystemsView({ systems, areas }: { systems: Sys[]; areas: Area[] }) {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = useMemo(() => systems.filter((s) => !q || norm(`${s.name} ${s.description ?? ''}`).includes(norm(q))), [systems, q]);
  return (
    <div>
      <input className="input mb-6 max-w-xl text-base" placeholder="🔎 Buscar un sistema: becas, mantención, contratos…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="buscar-sistemas" />
      {areas.map((a) => {
        const items = list.filter((s) => (s.area ?? 'otros') === a.key);
        if (!items.length) return null;
        return (
          <section key={a.key} className="mb-8" data-testid={`sistemas-${a.key}`}>
            <h2 className={`mb-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r ${a.color} px-4 py-2 text-lg font-bold text-white`}>{a.icon} {a.title} <span className="text-sm font-normal text-white/80">· {items.length}</span></h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {items.map((s) => (
                <Link key={s.slug} href={`/app/m/${s.slug}`} className="card group flex items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lg" data-testid="sistema">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-2xl group-hover:bg-brand-50" aria-hidden>{s.icon}</span>
                  <span className="min-w-0"><span className="block font-semibold group-hover:text-brand-700">{s.name}</span>
                    <span className="line-clamp-2 text-xs text-slate-500">{s.description}</span>
                    {!s.manage && <span className="mt-1 inline-block rounded bg-sky-50 px-1.5 text-[11px] text-sky-700">Enviar solicitud</span>}</span>
                </Link>))}
            </div>
          </section>);
      })}
      {!list.length && <p className="text-slate-500">No se encontró ningún sistema.</p>}
    </div>
  );
}
