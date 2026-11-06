import 'server-only';
import crypto from 'node:crypto';
import type { PaymentProvider, Verification } from './types';

const base = () => process.env.STRIPE_API_URL ?? 'https://api.stripe.com';
const auth = () => ({ Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` });
// Monedas sin decimales en Stripe (el monto se envía en unidades enteras)
const ZERO_DECIMAL = new Set(['CLP', 'PYG', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);
export const toStripeAmount = (amount: number, cur: string) => (ZERO_DECIMAL.has(cur) ? Math.round(amount) : Math.round(amount * 100));
const fromStripeAmount = (amount: number, cur: string) => (ZERO_DECIMAL.has(cur) ? amount : amount / 100);

export const stripe: PaymentProvider = {
  id: 'stripe', label: 'Stripe', description: 'Tarjetas internacionales Visa, Mastercard, American Express',
  currencies: ['CLP', 'USD', 'EUR', 'MXN', 'PEN', 'COP', 'ARS', 'BRL', 'UYU'],
  enabled: () => !!process.env.STRIPE_SECRET_KEY,
  async start(order, urls) {
    const body = new URLSearchParams({
      mode: 'payment', customer_email: order.email, client_reference_id: order.id,
      'metadata[order_id]': order.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': order.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(toStripeAmount(order.amount, order.currency)),
      'line_items[0][price_data][product_data][name]': order.title,
      success_url: `${urls.returnUrl}?session_id={CHECKOUT_SESSION_ID}`, cancel_url: urls.cancelUrl,
    });
    const r = await fetch(`${base()}/v1/checkout/sessions`, {
      method: 'POST', body, headers: { ...auth(), 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': order.id },
    });
    const j = await r.json();
    if (!r.ok || !j.url) throw new Error(`Stripe: ${j.error?.message ?? r.status}`);
    return { reference: j.id, redirect: { method: 'GET', url: j.url } };
  },
};

export async function stripeVerify(sessionId: string): Promise<Verification> {
  const r = await fetch(`${base()}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: auth() });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${j.error?.message ?? r.status}`);
  const cur = String(j.currency).toUpperCase();
  return {
    orderId: j.client_reference_id ?? j.metadata?.order_id, reference: j.id, paid: j.payment_status === 'paid',
    amount: fromStripeAmount(Number(j.amount_total), cur), currency: cur, status: j.payment_status, payload: j,
  };
}

/** Verifica la cabecera Stripe-Signature (t=…,v1=…) con tolerancia de 5 minutos. */
export function stripeSignatureOk(body: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const mac = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return sigs.some((s) => s.length === mac.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(mac)));
}
