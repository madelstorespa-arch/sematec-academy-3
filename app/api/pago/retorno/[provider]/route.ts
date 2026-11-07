import { NextResponse, type NextRequest } from 'next/server';
import { processVerification, resultUrl } from '@/lib/payments';
import { webpayCommit } from '@/lib/payments/webpay';
import { mercadopagoVerify } from '@/lib/payments/mercadopago';
import { flowVerify } from '@/lib/payments/flow';
import { stripeVerify } from '@/lib/payments/stripe';
import { fintocVerify, fintocPending } from '@/lib/payments/fintoc';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ProviderId } from '@/lib/payments/types';

/**
 * El comprador vuelve desde la página del proveedor. NUNCA se confía en los
 * parámetros recibidos: el estado se consulta directamente al proveedor.
 */
async function handle(request: NextRequest, provider: ProviderId) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  if (request.method === 'POST') {
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('form')) (await request.formData()).forEach((v, k) => params.set(k, String(v)));
  }
  const go = (orderId: string, extra = '') => NextResponse.redirect(new URL(resultUrl(orderId) + extra, url.origin), { status: 303 });
  try {
    switch (provider) {
      case 'webpay': {
        const token = params.get('token_ws');
        if (token) {
          const v = await webpayCommit(token);
          const r = await processVerification('webpay', v);
          return go(r.orderId);
        }
        // Pago anulado por el usuario o tiempo agotado en el formulario de Webpay
        const order = params.get('TBK_ID_SESION');
        if (order) {
          await processVerification('webpay', { orderId: order, reference: params.get('TBK_TOKEN') ?? '', paid: false, amount: 0, currency: 'CLP', status: 'aborted', payload: Object.fromEntries(params) });
          return go(order, '&cancelado=1');
        }
        break;
      }
      case 'mercadopago': {
        const pid = params.get('payment_id') ?? params.get('collection_id');
        if (pid && pid !== 'null') return go((await processVerification('mercadopago', await mercadopagoVerify(pid))).orderId);
        const ext = params.get('external_reference');
        if (ext) return go(ext, '&cancelado=1');
        break;
      }
      case 'flow': {
        const token = params.get('token');
        if (token) return go((await processVerification('flow', await flowVerify(token))).orderId);
        break;
      }
      case 'fintoc': {
        const orderId = params.get('order');
        if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) break;
        const { data: o } = await createAdminClient().from('checkout_orders').select('id, provider, provider_reference').eq('id', orderId).maybeSingle();
        if (!o || o.provider !== 'fintoc' || !o.provider_reference) break;
        const v = await fintocVerify(o.provider_reference);
        if (fintocPending(v.status)) return go(o.id); // la confirmación llegará por el webhook
        return go((await processVerification('fintoc', { ...v, orderId: o.id })).orderId);
      }
      case 'stripe': {
        const sid = params.get('session_id');
        if (sid) return go((await processVerification('stripe', await stripeVerify(sid))).orderId);
        break;
      }
    }
  } catch (e) {
    console.error('retorno de pago', provider, e);
    const ref = params.get('token_ws') ?? params.get('token') ?? params.get('session_id');
    if (ref) {
      const { data } = await createAdminClient().from('checkout_orders').select('id').eq('provider', provider).eq('provider_reference', ref).maybeSingle();
      if (data) return go(data.id, '&error=1');
    }
  }
  return NextResponse.redirect(new URL('/estado?error=pago', url.origin), { status: 303 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return handle(request, (await params).provider as ProviderId);
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return handle(request, (await params).provider as ProviderId);
}
