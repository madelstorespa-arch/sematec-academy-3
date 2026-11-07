import 'server-only';
import type { PaymentProvider, Verification } from './types';

/**
 * «Paga con tu banco» (transferencia inmediata) mediante Fintoc Checkout Sessions v2.
 * El comprador elige su banco en SEMATEC y es llevado directamente al flujo de ese banco.
 * El resultado SIEMPRE se consulta servidor-a-servidor (GET /v2/checkout_sessions/{id}).
 */
const base = () => (process.env.FINTOC_API_URL ?? 'https://api.fintoc.com').replace(/\/$/, '');
const headers = () => ({ Authorization: process.env.FINTOC_SECRET_KEY ?? '', 'Content-Type': 'application/json', Accept: 'application/json' });

/** Bancos chilenos habilitados para iniciación de pagos en Fintoc (id → nombre visible). */
export const CL_BANKS: { id: string; name: string }[] = [
  { id: 'cl_banco_estado', name: 'BancoEstado' },
  { id: 'cl_banco_de_chile', name: 'Banco de Chile / Edwards / Citi' },
  { id: 'cl_banco_santander', name: 'Santander' },
  { id: 'cl_banco_bci', name: 'Bci' },
  { id: 'cl_banco_itau', name: 'Itaú' },
  { id: 'cl_banco_scotiabank', name: 'Scotiabank' },
  { id: 'cl_banco_falabella', name: 'Banco Falabella' },
  { id: 'cl_banco_bice', name: 'BICE' },
  { id: 'cl_banco_security', name: 'Security' },
  { id: 'cl_banco_ripley', name: 'Banco Ripley' },
  { id: 'cl_banco_consorcio', name: 'Consorcio' },
  { id: 'cl_banco_internacional', name: 'Banco Internacional' },
  { id: 'cl_banco_coopeuch', name: 'Coopeuch / Dale' },
  { id: 'cl_banco_bbva', name: 'BBVA' },
  { id: 'cl_banco_hsbc', name: 'HSBC' },
  { id: 'cl_mach', name: 'MACH' },
  { id: 'cl_tenpo', name: 'Tenpo' },
  { id: 'cl_mercado_pago', name: 'Mercado Pago' },
  { id: 'cl_copec_pay', name: 'Copec Pay' },
  { id: 'cl_tapp_caja_los_andes', name: 'Tapp Caja Los Andes' },
  { id: 'cl_prepago_los_heroes', name: 'Prepago Los Héroes' },
];
const BANK_IDS = new Set(CL_BANKS.map((b) => b.id));

async function createSession(body: Record<string, unknown>) {
  const r = await fetch(`${base()}/v2/checkout_sessions`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

export const fintoc: PaymentProvider = {
  id: 'fintoc', label: 'Paga con tu banco', description: 'Transferencia inmediata desde tu banco, sin tarjeta (Fintoc)', currencies: ['CLP'],
  enabled: () => !!process.env.FINTOC_SECRET_KEY,
  banks: CL_BANKS,
  async start(order, urls) {
    const body: Record<string, any> = {
      flow: 'payment', amount: Math.round(order.amount), currency: 'CLP',
      success_url: `${urls.returnUrl}?order=${order.id}`, cancel_url: urls.cancelUrl,
      customer_email: order.email, metadata: { order_id: order.id, order_number: String(order.number) },
      payment_method_types: ['bank_transfer'],
    };
    const bank = order.bank && BANK_IDS.has(order.bank) ? order.bank : null;
    let res = await createSession(bank
      ? { ...body, payment_method_options: { bank_transfer: { sender_account: { institution_id: { value: bank } } } } }
      : body);
    // Si el banco preseleccionado no está disponible, se muestra la lista de bancos de Fintoc
    if (bank && res.r.status === 400) res = await createSession(body);
    if (!res.r.ok || !res.j.redirect_url) throw new Error(`Fintoc: ${res.j?.error?.message ?? res.j?.message ?? res.r.status}`);
    return { reference: res.j.id, redirect: { method: 'GET', url: res.j.redirect_url } };
  },
};

export async function fintocVerify(sessionId: string): Promise<Verification> {
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(sessionId)) throw new Error('Fintoc: sesión inválida');
  const r = await fetch(`${base()}/v2/checkout_sessions/${sessionId}`, { headers: headers() });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Fintoc: ${s?.error?.message ?? r.status}`);
  const pi = s.payment_resource?.payment_intent ?? null;
  const piStatus: string = pi?.status ?? '';
  const status = piStatus || (s.status === 'expired' ? 'cancelled' : String(s.status ?? 'unknown'));
  return {
    orderId: s.metadata?.order_id ?? '', reference: s.id ?? sessionId,
    paid: piStatus === 'succeeded',
    amount: Number(pi?.amount ?? s.amount), currency: String(pi?.currency ?? s.currency ?? 'CLP').toUpperCase(), status, payload: s,
  };
}

/** Estados intermedios: no se marcan como fallidos (el pago aún puede completarse). */
export const fintocPending = (status: string) => ['created', 'in_progress', 'pending'].includes(status);
