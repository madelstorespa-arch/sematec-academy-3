import Link from 'next/link';
import type { ReactNode } from 'react';
import { label } from '@/lib/format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">{title}</h2>
          {actions}
        </div>
      )}
      <div className="card-pad">{children}</div>
    </section>
  );
}

const tone: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-100',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
};
const statusTone: Record<string, keyof typeof tone> = {
  active: 'green', approved: 'green', paid: 'green', confirmed: 'green', issued: 'green', present: 'green', live: 'red', open: 'green', enrolled: 'blue',
  failed: 'red', voided: 'red', revoked: 'red', cancelled: 'red', absent: 'red', rejected: 'red', locked: 'red',
  pending: 'amber', partially_paid: 'amber', late: 'amber', suspended: 'amber', submitted: 'amber', scheduled: 'blue', in_progress: 'blue',
};
export function Badge({ children, color }: { children: ReactNode; color?: keyof typeof tone }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone[color ?? 'gray']}`}>{children}</span>;
}
export function StatusBadge({ status }: { status?: string | null }) {
  return <Badge color={statusTone[status ?? ''] ?? 'gray'}>{label(status)}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Stat({ label: l, value, href, hint }: { label: string; value: ReactNode; href?: string; hint?: string }) {
  const body = (
    <div className="card card-pad h-full transition hover:border-brand-500">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l}</p>
      <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((t) => (
        <Link key={t.key} href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${t.key === current ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
