import { NextResponse, type NextRequest } from 'next/server';
import { processVerification } from '@/lib/payments';
import { mercadopagoSignatureOk, mercadopagoVerify } from '@/lib/payments/mercadopago';
import { flowVerify } from '@/lib/payments/flow';
import { stripeSignatureOk, stripeVerify } from '@/lib/payments/stripe';
import { fintocVerify, fintocPending } from '@/lib/payments/fintoc';

/** Notificaciones servidor-a-servidor de los proveedores (confirman aunque el comprador cierre el navegador). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const provider = (await params).provider;
  const raw = await request.text();
  try {
    if (provider === 'mercadopago') {
      const url = new URL(request.url);
      let body: any = {};
      try { body = JSON.parse(raw); } catch { /* notificación por query */ }
      const type = body.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic');
      const id = String(body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '');
      if (type !== 'payment' || !id) return NextResponse.json({ ignored: true });
      if (!mercadopagoSignatureOk(request.headers.get('x-signature'), request.headers.get('x-request-id'), id))
        return NextResponse.json({ error: 'firma inválida' }, { status: 401 });
      await processVerification('mercadopago', await mercadopagoVerify(id));
      return NextResponse.json({ ok: true });
    }
    if (provider === 'flow') {
      const token = new URLSearchParams(raw).get('token');
      if (!token) return NextResponse.json({ error: 'sin token' }, { status: 400 });
      await processVerification('flow', await flowVerify(token));
      return NextResponse.json({ ok: true });
    }
    if (provider === 'fintoc') {
      // No se confía en el contenido del aviso: solo se toma el id de la sesión y se consulta a Fintoc.
      let event: any = {};
      try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'json inválido' }, { status: 400 }); }
      const obj = event?.data?.object && typeof event.data.object === 'object' ? event.data.object : event?.data;
      const sid = obj?.object === 'checkout_session' ? obj.id : obj?.checkout_session ?? obj?.checkout_session_id ?? null;
      if (typeof sid !== 'string') return NextResponse.json({ ignored: true });
      const v = await fintocVerify(sid);
      if (fintocPending(v.status)) return NextResponse.json({ pending: true });
      await processVerification('fintoc', v);
      return NextResponse.json({ ok: true });
    }
    if (provider === 'stripe') {
      if (!stripeSignatureOk(raw, request.headers.get('stripe-signature'))) return NextResponse.json({ error: 'firma inválida' }, { status: 401 });
      const event = JSON.parse(raw);
      if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type))
        return NextResponse.json({ ignored: true });
      await processVerification('stripe', await stripeVerify(event.data.object.id));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'proveedor desconocido' }, { status: 404 });
  } catch (e) {
    console.error('webhook de pago', provider, e);
    return NextResponse.json({ error: 'error al procesar' }, { status: 500 }); // el proveedor reintentará
  }
}
