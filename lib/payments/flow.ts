import 'server-only';
import crypto from 'node:crypto';
import type { PaymentProvider, Verification } from './types';

const base = () => process.env.FLOW_API_URL ?? (process.env.FLOW_ENV === 'production' ? 'https://www.flow.cl/api' : 'https://sandbox.flow.cl/api');

/** Firma HMAC-SHA256 de Flow: parámetros ordenados, concatenados nombre+valor. */
export function flowSign(params: Record<string, string>): string {
  const str = Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha256', process.env.FLOW_SECRET_KEY ?? '').update(str).digest('hex');
}
const signed = (params: Record<string, string>) => {
  const p = { ...params, apiKey: process.env.FLOW_API_KEY ?? '' };
  return new URLSearchParams({ ...p, s: flowSign(p) });
};

export const flow: PaymentProvider = {
  id: 'flow', label: 'Flow', description: 'Webpay, Servipag, transferencias y otros medios vía Flow', currencies: ['CLP'],
  enabled: () => !!process.env.FLOW_API_KEY && !!process.env.FLOW_SECRET_KEY,
  async start(order, urls) {
    const body = signed({
      commerceOrder: `SA${order.number}`, subject: order.title.slice(0, 250), currency: order.currency,
      amount: String(Math.round(order.amount)), email: order.email, urlConfirmation: urls.notifyUrl, urlReturn: urls.returnUrl,
      optional: JSON.stringify({ order_id: order.id }),
    });
    const r = await fetch(`${base()}/payment/create`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await r.json();
    if (!r.ok || !j.token) throw new Error(`Flow: ${j.message ?? r.status}`);
    return { reference: j.token, redirect: { method: 'GET', url: `${j.url}?token=${j.token}` } };
  },
};

export async function flowVerify(token: string): Promise<Verification> {
  const r = await fetch(`${base()}/payment/getStatus?${signed({ token })}`);
  const j = await r.json();
  if (!r.ok) throw new Error(`Flow: ${j.message ?? r.status}`);
  let opt: any = j.optional;
  if (typeof opt === 'string') { try { opt = JSON.parse(opt); } catch { opt = {}; } }
  return {
    orderId: opt?.order_id ?? '', reference: token, paid: Number(j.status) === 2,
    amount: Number(j.amount), currency: j.currency ?? 'CLP', status: String(j.status), payload: j,
  };
}
