import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPublicSite } from '@/lib/site';
import { checkDocument } from '@/lib/identity';
import { availableProviders, startPayment } from '@/lib/payments';
import type { ProviderId } from '@/lib/payments/types';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { fmtMoney } from '@/lib/format';
import { env } from '@/lib/env';

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '');

/** 🛍 Crea un pedido de la tienda web (precios y stock validados en la base de datos) y, si corresponde, inicia el pago en línea. */
export async function POST(req: NextRequest) {
  const site = await getPublicSite();
  if (!site) return NextResponse.json({ error: 'La tienda no está disponible.' }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const items = Array.isArray(b.items) ? b.items.slice(0, 100).map((i: any) => ({ product: txt(i?.product, 40), qty: Number(i?.qty) || 0 }))
    .filter((i: any) => /^[0-9a-f-]{36}$/.test(i.product) && i.qty > 0) : [];
  if (!items.length) return NextResponse.json({ error: 'El carro está vacío.' }, { status: 400 });
  const name = txt(b.name, 160), email = txt(b.email, 200).toLowerCase(), phone = txt(b.phone, 40);
  if (name.length < 3) return NextResponse.json({ error: 'Escriba su nombre completo.' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Ingrese un correo válido.' }, { status: 400 });
  const doc = checkDocument(txt(b.doc_type, 20) || 'RUN', txt(b.doc_number, 30) || null, false);
  if (!doc.ok) return NextResponse.json({ error: doc.error }, { status: 400 });
  const pay = txt(b.payment, 30);
  const provider = pay.startsWith('online:') ? pay.slice(7) as ProviderId : null;

  const admin = createAdminClient();
  const h = req.headers;
  const ip = (h.get('x-real-ip') ?? (h.get('x-forwarded-for') ?? '').split(',').pop() ?? '').trim() || 'sin-ip';
  const { data: limited } = await admin.rpc('guest_rate_limited', { p_key: `tienda:${ip}`, p_max: 15 });
  if (limited) return NextResponse.json({ error: 'Demasiados pedidos seguidos desde esta conexión. Espere unos minutos.' }, { status: 429 });

  const { data: o, error } = await admin.rpc('store_web_order', {
    p_org: site.organization_id, p_items: items,
    p_customer: { name, email, phone, doc_type: doc.type ?? '', doc_number: doc.number ?? '' },
    p_delivery: txt(b.delivery, 20), p_address: txt(b.address, 300), p_payment: provider ? 'payment_gateway' : pay, p_notes: txt(b.notes, 1000),
    p_coupon: txt(b.coupon, 20) || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const order = o as { id: string; number: number; code: string; total: number; currency: string; tracking: string };
  const url = `${env.siteUrl()}/tienda/pedido/${order.tracking}`;

  if (mailEnabled()) {
    sendMail(email, `${(site as any).store_name ?? site.site_name}: pedido ${order.code} recibido`,
      mailLayout((site as any).store_name ?? site.site_name, `Pedido ${order.code}`, `<p>Hola ${name}, recibimos su pedido por <b>${fmtMoney(order.total, order.currency)}</b>.</p><p>Código de seguimiento: <b>${order.tracking}</b></p>`, { href: url, label: 'Ver mi pedido' }),
      `Recibimos su pedido N° ${order.number} por ${fmtMoney(order.total, order.currency)}. Seguimiento: ${url}`).catch((e) => console.error('[tienda] correo', e.message));
  }

  if (provider) {
    if (!availableProviders(order.currency).some((p) => p.id === provider)) return NextResponse.json({ error: 'Medio de pago no disponible.', tracking: order.tracking }, { status: 400 });
    try {
      const { data: co, error: e2 } = await admin.rpc('store_create_payment_order', { p_sale: order.id, p_provider: provider });
      if (e2) throw new Error(e2.message);
      const start = await startPayment(provider, { id: co.order_id, number: co.order_number, amount: Number(co.amount), currency: co.currency, title: co.title, email, name, bank: txt(b.bank, 40) || undefined });
      return NextResponse.json({ tracking: order.tracking, redirect: start.redirect });
    } catch (e) {
      console.error('[tienda] pago', e);
      return NextResponse.json({ tracking: order.tracking, error: 'No fue posible conectar con el medio de pago. Su pedido quedó registrado: puede pagar por transferencia.' }, { status: 502 });
    }
  }
  return NextResponse.json({ tracking: order.tracking, number: order.number, total: order.total });
}
