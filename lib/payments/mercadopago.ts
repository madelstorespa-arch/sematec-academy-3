import 'server-only';
import crypto from 'node:crypto';
import type { PaymentProvider, Verification } from './types';

const base = () => process.env.MERCADOPAGO_API_URL ?? 'https://api.mercadopago.com';
const auth = () => ({ Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' });

export const mercadopago: PaymentProvider = {
  id: 'mercadopago', label: 'Mercado Pago', description: 'Tarjetas y medios de pago de Mercado Pago',
  currencies: ['CLP', 'ARS', 'MXN', 'COP', 'PEN', 'UYU', 'BRL'],
  enabled: () => !!process.env.MERCADOPAGO_ACCESS_TOKEN,
  async start(order, urls) {
    const r = await fetch(`${base()}/checkout/preferences`, {
      method: 'POST', headers: { ...auth(), 'X-Idempotency-Key': order.id },
      body: JSON.stringify({
        items: [{ id: order.id, title: order.title, quantity: 1, unit_price: order.amount, currency_id: order.currency }],
        payer: { email: order.email, name: order.name },
        external_reference: order.id,
        back_urls: { success: urls.returnUrl, failure: urls.returnUrl, pending: urls.returnUrl },
        auto_return: 'approved', notification_url: urls.notifyUrl, statement_descriptor: 'SEMATEC ACADEMY',
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.init_point) throw new Error(`Mercado Pago: ${j.message ?? r.status}`);
    return { reference: j.id, redirect: { method: 'GET', url: j.init_point } };
  },
};

/** Consulta el pago directamente a la API de Mercado Pago. */
export async function mercadopagoVerify(paymentId: string): Promise<Verification> {
  const r = await fetch(`${base()}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: auth() });
  const j = await r.json();
  if (!r.ok) throw new Error(`Mercado Pago: ${j.message ?? r.status}`);
  return {
    orderId: j.external_reference, reference: String(j.id), paid: j.status === 'approved',
    amount: Number(j.transaction_amount), currency: j.currency_id, status: j.status, payload: j,
  };
}

/** Valida la firma x-signature de las notificaciones (si se configuró la clave secreta). */
export function mercadopagoSignatureOk(xSignature: string | null, xRequestId: string | null, dataId: string): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return true; // sin clave: la verificación se apoya en la consulta directa a la API
  if (!xSignature) return false;
  const parts = Object.fromEntries(xSignature.split(',').map((p) => p.trim().split('=') as [string, string]));
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId ?? ''};ts:${parts.ts};`;
  const mac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return !!parts.v1 && parts.v1.length === mac.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(parts.v1));
}
