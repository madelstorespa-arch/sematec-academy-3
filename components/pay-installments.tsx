'use client';
import { useMemo, useState, useTransition } from 'react';
import { fmtDate, fmtMoney } from '@/lib/format';

type Inst = { installment_id: string; number: number; concept?: string; due_on: string; outstanding: number | string; currency: string; days_overdue: number };
type Provider = { id: string; label: string; description: string; banks?: { id: string; name: string }[] };
type Result = { ok: boolean; message?: string; error?: string; data?: any };

/** Pagar cuotas en línea con tarjeta de crédito/débito o desde el banco. */
export function PayInstallments({ studentId, items, providers, action }: {
  studentId: string; items: Inst[]; providers: Provider[]; action: (fd: FormData) => Promise<Result>;
}) {
  const [sel, setSel] = useState<string[]>(() => items.filter((i) => i.days_overdue > 0).map((i) => i.installment_id).slice(0, 12)
    .concat(items.some((i) => i.days_overdue > 0) ? [] : items.slice(0, 1).map((i) => i.installment_id)));
  const [provider, setProvider] = useState(providers[0]?.id ?? '');
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const total = useMemo(() => items.filter((i) => sel.includes(i.installment_id)).reduce((a, i) => a + Number(i.outstanding), 0), [sel, items]);
  const currency = items[0]?.currency ?? 'CLP';
  const banks = providers.find((p) => p.id === provider)?.banks;
  if (!items.length) return null;
  if (!providers.length) return <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">El pago en línea aún no está habilitado por la institución. Pague en caja o por transferencia.</p>;

  return (
    <form className="mt-4 space-y-4 border-t border-slate-100 pt-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setRes(null);
      start(async () => {
        try {
          const r = await action(fd); setRes(r);
          if (r.ok && r.data) {
            const red = r.data as { method: 'GET' | 'POST'; url: string; fields?: Record<string, string> };
            if (red.method === 'GET') { window.location.href = red.url; return; }
            const f = document.createElement('form'); f.method = 'POST'; f.action = red.url;
            Object.entries(red.fields ?? {}).forEach(([k, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); });
            document.body.appendChild(f); f.submit();
          }
        } catch { setRes({ ok: false, error: 'Sin conexión: no se realizó ningún cobro. Reintente con internet.' }); }
      });
    }}>
      <input type="hidden" name="student_id" value={studentId} />
      <p className="text-sm font-bold">💳 Pagar en línea</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.installment_id}>
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <span className="flex items-center gap-2">
                <input type="checkbox" name="inst" value={i.installment_id} checked={sel.includes(i.installment_id)}
                  onChange={(e) => setSel((s) => e.target.checked ? [...s, i.installment_id] : s.filter((x) => x !== i.installment_id))} />
                Cuota {i.number}{i.concept ? ` · ${i.concept}` : ''} · vence {fmtDate(i.due_on)}
                {i.days_overdue > 0 && <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-700">vencida</span>}
              </span>
              <b>{fmtMoney(i.outstanding, i.currency)}</b>
            </label>
          </li>))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-300 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
            <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} className="mt-1" />
            <span><b>{p.banks ? '🏦 ' : '💳 '}{p.label}</b><br /><span className="text-xs text-slate-600">{p.description}</span></span>
          </label>))}
      </div>
      {banks && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {banks.map((b) => (
            <label key={b.id} className="flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-2 py-2 text-center text-xs font-semibold has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="radio" name="bank" value={b.id} required className="sr-only" />{b.name}
            </label>))}
        </div>)}
      <button className="btn-primary w-full" disabled={pending || !sel.length || res?.ok}>
        {pending || res?.ok ? 'Conectando con el pago seguro…' : `Pagar ${fmtMoney(total, currency)}`}
      </button>
      <p className="text-center text-xs text-slate-500">🔒 Los datos de su tarjeta o la clave de su banco se ingresan solo en la página del banco o del medio de pago.</p>
      {res && !res.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">✕ {res.error}</p>}
    </form>
  );
}
