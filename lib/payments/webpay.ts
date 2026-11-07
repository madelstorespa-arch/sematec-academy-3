import 'server-only';
import type { PaymentProvider, Verification } from './types';

// Credenciales públicas del ambiente de integración publicadas por Transbank.
const INTEGRATION = { code: '597055555532', key: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C' };
const env = () => (process.env.WEBPAY_ENV ?? 'integration') as 'integration' | 'production';
const base = () => process.env.WEBPAY_API_URL ?? (env() === 'production' ? 'https://webpay3g.transbank.cl' : 'https://webpay3gint.transbank.cl');
const creds = () => ({
  code: process.env.WEBPAY_COMMERCE_CODE ?? (env() === 'integration' ? INTEGRATION.code : ''),
  key: process.env.WEBPAY_API_KEY ?? (env() === 'integration' ? INTEGRATION.key : ''),
});
const headers = () => ({ 'Tbk-Api-Key-Id': creds().code, 'Tbk-Api-Key-Secret': creds().key, 'Content-Type': 'application/json' });
const PATH = '/rswebpaytransaction/api/webpay/v1.2/transactions';

export const webpay: PaymentProvider = {
  id: 'webpay', label: 'Tarjeta de crédito o débito', description: 'Webpay Plus (Transbank): Visa, Mastercard, Redcompra, American Express y prepago', currencies: ['CLP'],
  enabled: () => process.env.WEBPAY_ENABLED === '1' && !!creds().code && !!creds().key,
  async start(order, urls) {
    const r = await fetch(base() + PATH, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ buy_order: `SA${order.number}`, session_id: order.id, amount: Math.round(order.amount), return_url: urls.returnUrl }),
    });
    const j = await r.json();
    if (!r.ok || !j.token) throw new Error(`Webpay: ${j.error_message ?? r.status}`);
    return { reference: j.token, redirect: { method: 'POST', url: j.url, fields: { token_ws: j.token } } };
  },
};

/** Confirma (commit) la transacción al volver del formulario de Webpay. */
export async function webpayCommit(token: string): Promise<Verification & { sessionId: string }> {
  const r = await fetch(`${base()}${PATH}/${encodeURIComponent(token)}`, { method: 'PUT', headers: headers() });
  const j = await r.json();
  if (!r.ok) {
    return { orderId: '', sessionId: '', reference: token, paid: false, amount: 0, currency: 'CLP', status: j.error_message ?? `http_${r.status}`, payload: j };
  }
  return {
    orderId: j.session_id, sessionId: j.session_id, reference: token,
    paid: j.status === 'AUTHORIZED' && j.response_code === 0, amount: Number(j.amount), currency: 'CLP',
    status: j.status, payload: j,
  };
}
