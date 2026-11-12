import { fmtDate, fmtMoney } from '@/lib/format';
import { offeringBreakdown, offeringPricing } from '@/lib/pricing';
import { makeT, type TFn } from '@/lib/site-i18n-dict';

const ES = makeT('es');

/** Precio con descuento: precio normal tachado, precio final, % y total ahorrado; + matrícula si corresponde. */
export function PriceTag({ c, size = 'md', t = ES }: { c: any; size?: 'md' | 'lg'; t?: TFn }) {
  const p = offeringPricing(c);
  const b = offeringBreakdown(c);
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
          {t('price.save', { amount: fmtMoney(p.saving, c.currency) })}{p.endsOn ? ` · ${t('price.until', { date: fmtDate(p.endsOn) })}` : ''}
        </p>)}
      {b.fee > 0 && (
        <p className="mt-1 text-xs text-slate-600" data-testid="precio-matricula">
          {t('price.plusFee', { amount: fmtMoney(b.fee, c.currency) })}{b.installments > 1 ? ` · ${t('price.inInstallments', { n: b.installments, amount: fmtMoney(b.each, c.currency) })}` : ''}
        </p>)}
    </div>
  );
}
