'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = { href: string; label: string; icon: string };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {items.map((i) => {
        const active = i.href === '/app' ? path === '/app' : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-white/10 text-white' : 'text-sky-100/75 hover:bg-white/5 hover:text-white'}`}>
            <span aria-hidden className="w-5 text-center">{i.icon}</span>{i.label}
          </Link>
        );
      })}
    </nav>
  );
}
