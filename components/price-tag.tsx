import { fmtDate, fmtMoney } from '@/lib/format';
import { offeringPricing } from '@/lib/pricing';

/** Precio con descuento: precio normal tachado, precio final, % y total ahorrado. */
export function PriceTag({ c, size = 'md' }: { c: any; size?: 'md' | 'lg' }) {
  const p = offeringPricing(c);
  const big = size === 'lg' ? 'text-3xl' : 'text-2xl';
  return (
    <div>
      {p.discounted && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500 line-through">{fmtMoney(p.regular, c.currency)}</span>
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">-{p.pct}%</span>
        </p>)}
      <p className={`${big} font-black`}>{fmtMoney(p.current, c.currency)}</p>
      {p.discounted && (
        <p className="text-xs font-semibold text-emerald-700">
          Ahorras {fmtMoney(p.saving, c.currency)}{p.endsOn ? ` · oferta hasta el ${fmtDate(p.endsOn)}` : ''}
        </p>)}
    </div>
  );
}
