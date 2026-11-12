'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = { href: string; label: string; icon: string };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-1">
      {items.map((i) => {
        const active = i.href === '/app' ? path === '/app' : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? 'bg-white/12 text-white shadow-inner' : 'text-sky-100/75 hover:bg-white/6 hover:text-white'}`}>
            {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-accent" aria-hidden />}
            <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base transition ${active ? 'bg-white/15' : 'bg-white/5 group-hover:bg-white/10'}`}>{i.icon}</span>
            <span className="truncate">{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
