import { fmtMoney } from '@/lib/format';
import { offeringBreakdown } from '@/lib/pricing';
import { getT } from '@/lib/site-i18n';

/** Desglose matrícula + arancel (solo si el curso tiene matrícula). */
export async function PriceBreakdown({ c }: { c: any }) {
  const b = offeringBreakdown(c);
  if (b.fee <= 0) return null;
  const t = await getT();
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm" data-testid="desglose">
      <div className="flex justify-between"><span className="text-slate-500">{t('price.fee')}</span><b>{fmtMoney(b.fee, c.currency)}</b></div>
      <div className="mt-1 flex justify-between"><span className="text-slate-500">{t('price.course')}</span><b>{fmtMoney(b.course, c.currency)}</b></div>
      {b.installments > 1 && <p className="mt-1 text-right text-xs text-slate-500">{t('price.orInstallments', { n: b.installments, amount: fmtMoney(b.each, c.currency) })}</p>}
      <div className="mt-2 flex justify-between border-t border-slate-200 pt-2"><span className="font-semibold">{t('price.total')}</span><b className="text-brand-700">{fmtMoney(b.total, c.currency)}</b></div>
    </div>
  );
}
