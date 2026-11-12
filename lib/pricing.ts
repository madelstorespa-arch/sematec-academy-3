/** Precio vigente de una oferta del catálogo (misma regla que private.offering_price en la base). */
export function offeringPricing(c: { price: number | string; regular_price?: number | string | null; discount_ends_on?: string | null }) {
  const price = Number(c.price);
  const regular = c.regular_price != null ? Number(c.regular_price) : price;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const expired = !!c.discount_ends_on && c.discount_ends_on < today;
  const discounted = regular > price && !expired;
  const current = discounted ? price : Math.max(regular, price);
  return {
    current, regular, discounted,
    saving: discounted ? regular - price : 0,
    pct: discounted ? Math.round((100 * (regular - price)) / regular) : 0,
    endsOn: discounted ? c.discount_ends_on ?? null : null,
  };
}

export const KIND_LABEL: Record<string, string> = { curso: 'Curso', carrera: 'Carrera', diplomado: 'Diplomado', taller: 'Taller' };

/** Matrícula + arancel de un curso (misma regla que public.offering_breakdown). */
export function offeringBreakdown(c: { price: number | string; regular_price?: number | string | null; discount_ends_on?: string | null; enrollment_fee?: number | string | null; installments_count?: number | null }) {
  const course = offeringPricing(c).current;
  const fee = Math.max(0, Number(c.enrollment_fee ?? 0) || 0);
  const n = Math.max(1, Number(c.installments_count ?? 1) || 1);
  const each = Math.trunc(course / n);
  return { fee, course, total: fee + course, installments: n, each: each > 0 ? each : course, last: each > 0 ? course - each * (n - 1) : course, canSplit: fee > 0 };
}
