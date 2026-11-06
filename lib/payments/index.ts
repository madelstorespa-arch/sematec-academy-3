import 'server-only';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { webpay } from './webpay';
import { mercadopago } from './mercadopago';
import { flow } from './flow';
import { stripe } from './stripe';
import type { PaymentProvider, ProviderId, StartResult, Verification } from './types';

export const PROVIDERS: Record<ProviderId, PaymentProvider> = { webpay, mercadopago, flow, stripe };

/** Proveedores habilitados (con credenciales cargadas) que aceptan la moneda. */
export function availableProviders(currency: string) {
  return Object.values(PROVIDERS).filter((p) => p.enabled() && p.currencies.includes(currency))
    .map((p) => ({ id: p.id, label: p.label, description: p.description }));
}

const secret = () => process.env.PAYMENT_LINK_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'dev';
/** Firma del enlace de resultado: solo quien inició el pago puede ver su resultado. */
export const resultToken = (orderId: string) => crypto.createHmac('sha256', secret()).update(`order:${orderId}`).digest('base64url').slice(0, 32);
export const resultUrl = (orderId: string) => `/pago/resultado/${orderId}?t=${resultToken(orderId)}`;

export async function startPayment(provider: ProviderId, order: { id: string; number: number; amount: number; currency: string; title: string; email: string; name: string }): Promise<StartResult> {
  const p = PROVIDERS[provider];
  if (!p?.enabled()) throw new Error('Medio de pago no disponible');
  const site = env.siteUrl();
  const res = await p.start(order, {
    returnUrl: `${site}/api/pago/retorno/${provider}`,
    notifyUrl: `${site}/api/pago/webhook/${provider}`,
    cancelUrl: `${site}${resultUrl(order.id)}&cancelado=1`,
  });
  const { error } = await createAdminClient().rpc('set_order_reference', { p_order: order.id, p_reference: res.reference });
  if (error) throw new Error(error.message);
  return res;
}

/**
 * Registra el resultado verificado con el proveedor y, si está pagado,
 * crea la cuenta, la ficha, la matrícula y el registro contable. Idempotente.
 */
export async function processVerification(provider: ProviderId, v: Verification): Promise<{ orderId: string; outcome: string }> {
  const admin = createAdminClient();
  let orderId = v.orderId;
  if (!orderId) {
    const { data } = await admin.from('checkout_orders').select('id').eq('provider', provider).eq('provider_reference', v.reference).maybeSingle();
    orderId = data?.id ?? '';
  }
  if (!orderId) throw new Error('Pedido no identificado');
  const { data: outcome, error } = await admin.rpc('mark_order_result', {
    p_order: orderId, p_provider: provider, p_reference: v.reference, p_paid: v.paid, p_amount: v.amount,
    p_currency: v.currency, p_status: v.status, p_payload: v.payload as object,
  });
  if (error) throw new Error(error.message);
  if (outcome === 'paid' || outcome === 'already_paid') await fulfill(orderId);
  return { orderId, outcome: String(outcome) };
}

async function fulfill(orderId: string) {
  const admin = createAdminClient();
  const { data: o } = await admin.from('checkout_orders').select('id, buyer_email, buyer_name, fulfilled_at, user_id').eq('id', orderId).single();
  if (!o || o.fulfilled_at) return;
  let userId: string | null = null;
  const { data: prof } = await admin.from('profiles').select('id').eq('email', o.buyer_email).maybeSingle();
  if (prof) userId = prof.id;
  else {
    const { data, error } = await admin.auth.admin.createUser({
      email: o.buyer_email, email_confirm: true, password: crypto.randomBytes(24).toString('base64url') + 'aA1!',
      user_metadata: { full_name: o.buyer_name, created_from_order: orderId },
    });
    if (error || !data.user) throw new Error(error?.message ?? 'No se pudo crear la cuenta');
    userId = data.user.id;
  }
  const { error } = await admin.rpc('fulfill_checkout_order', { p_order: orderId, p_user: userId });
  if (error) throw new Error(error.message);
}
