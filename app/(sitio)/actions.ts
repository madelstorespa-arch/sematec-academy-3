'use server';
import { checkDocument } from '@/lib/identity';
import { headers } from 'next/headers';
import { anonClient, getPublicSite } from '@/lib/site';
import { explain, type ActionResult } from '@/lib/actions';
import { startPayment } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ProviderId } from '@/lib/payments/types';

const v = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** Documento de identidad de postulaciones y compras (RUT validado). */
function publicDoc(fd: FormData, required = true): { country: string | null; type: string | null; number: string | null } | { error: string } {
  const r = checkDocument(v(fd, 'doc_type') || null, v(fd, 'doc_number') || null, required);
  if (!r.ok) return { error: r.error };
  return { country: 'CL', type: r.type, number: r.number };
}
const ip = async () => ((await headers()).get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
const human = (fd: FormData) => v(fd, 'website') === ''; // campo trampa anti-bots

export async function sendContact(fd: FormData): Promise<ActionResult> {
  if (!human(fd)) return { ok: true, message: 'Mensaje enviado.' };
  const site = await getPublicSite();
  if (!site) return { ok: false, error: 'Sitio no disponible.' };
  if (!fd.get('consent')) return { ok: false, error: 'Debe aceptar el tratamiento de sus datos para responderle.' };
  const { error } = await anonClient().rpc('submit_contact_message', {
    p_site: site.organization_id, p_name: v(fd, 'name'), p_email: v(fd, 'email'), p_phone: v(fd, 'phone'),
    p_subject: v(fd, 'subject'), p_message: v(fd, 'message'), p_offering: v(fd, 'offering_id') || null, p_ip: await ip(),
  });
  if (error) return { ok: false, error: error.code === '23514' ? 'Revise los datos: correo válido y mensaje de al menos 5 caracteres.' : explain(error) };
  return { ok: true, message: '¡Gracias! Recibimos su mensaje y le responderemos a la brevedad.' };
}

export async function applyToCourse(fd: FormData): Promise<ActionResult> {
  if (!human(fd)) return { ok: false, error: 'Solicitud inválida.' };
  if (!fd.get('consent')) return { ok: false, error: 'Debe aceptar los términos y la política de privacidad.' };
  const doc = publicDoc(fd);
  if ('error' in doc) return { ok: false, error: doc.error };
  const { data, error } = await anonClient().rpc('submit_public_application', {
    p_offering: v(fd, 'offering_id'), p_name: v(fd, 'name'), p_email: v(fd, 'email'), p_phone: v(fd, 'phone'),
    p_doc_country: doc.country, p_doc_type: doc.type, p_doc_number: doc.number,
    p_form: { motivation: v(fd, 'motivation'), education: v(fd, 'education') }, p_ip: await ip(),
  });
  if (error) return { ok: false, error: explain(error) };
  return { ok: true, message: `Postulación enviada. Su código de seguimiento es ${data}. Guárdelo: con él y su correo puede revisar el estado y, una vez aprobada, pagar.`, data };
}

export async function checkStatus(fd: FormData): Promise<ActionResult> {
  const { data, error } = await anonClient().rpc('request_status', { p_code: v(fd, 'code'), p_email: v(fd, 'email') });
  if (error) return { ok: false, error: explain(error) };
  if (!(data as any)?.found) return { ok: false, error: 'No encontramos una solicitud con ese código y correo.' };
  return { ok: true, message: 'Solicitud encontrada.', data };
}

/** Crea el pedido (monto desde el catálogo) y prepara la redirección segura al proveedor. */
export async function startCheckout(fd: FormData): Promise<ActionResult> {
  if (!human(fd)) return { ok: false, error: 'Solicitud inválida.' };
  if (!fd.get('consent')) return { ok: false, error: 'Debe aceptar los términos y la política de privacidad.' };
  const provider = v(fd, 'provider') as ProviderId;
  const doc = publicDoc(fd, !v(fd, 'tracking_code'));
  if ('error' in doc) return { ok: false, error: doc.error };
  const { data, error } = await anonClient().rpc('create_checkout_order', {
    p_offering: v(fd, 'offering_id'), p_provider: provider, p_name: v(fd, 'name'), p_email: v(fd, 'email'), p_phone: v(fd, 'phone'),
    p_doc_country: doc.country, p_doc_type: doc.type, p_doc_number: doc.number,
    p_tracking_code: v(fd, 'tracking_code') || null,
    // «solo matrícula» requiere la actualización de base de datos «Matricula web»; el pago total funciona igual sin ella
    ...(v(fd, 'plan') === 'matricula' ? { p_plan: 'matricula' } : {}),
  });
  if (error) return { ok: false, error: explain(error) };
  const o = data as { order_id: string; order_number: number; amount: number; currency: string; title: string };
  try {
    const start = await startPayment(provider, {
      id: o.order_id, number: o.order_number, amount: Number(o.amount), currency: o.currency, title: o.title, email: v(fd, 'email').toLowerCase(), name: v(fd, 'name'),
      bank: v(fd, 'bank') || undefined,
    });
    return { ok: true, message: 'Redirigiendo al pago seguro…', data: start.redirect };
  } catch (e) {
    console.error(e);
    await createAdminClient().rpc('mark_order_result', { p_order: o.order_id, p_provider: provider, p_reference: null, p_paid: false, p_amount: 0, p_currency: o.currency, p_status: 'start_error', p_payload: { error: String(e) } });
    return { ok: false, error: 'No fue posible conectar con el medio de pago. No se realizó ningún cobro; intente nuevamente o elija otro medio.' };
  }
}

const FORM_KEYS = ['birth_date', 'address', 'city', 'education', 'guardian_name', 'guardian_phone', 'how_found', 'notes'] as const;

/** 📝 Inscripción general desde el sitio: paga la inscripción (o la envía si no tiene costo) y queda registrado como estudiante. */
export async function startRegistration(fd: FormData): Promise<ActionResult> {
  if (!human(fd)) return { ok: false, error: 'Solicitud inválida.' };
  if (!fd.get('consent')) return { ok: false, error: 'Debe aceptar los términos y la política de privacidad.' };
  const site = await getPublicSite();
  if (!site) return { ok: false, error: 'Sitio no disponible.' };
  const doc = publicDoc(fd, true);
  if ('error' in doc) return { ok: false, error: doc.error };
  const email = v(fd, 'email').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Escriba un correo válido.' };
  if (v(fd, 'name').length < 3) return { ok: false, error: 'Escriba su nombre completo.' };
  const form = Object.fromEntries(FORM_KEYS.map((k) => [k, v(fd, k).slice(0, 500)]).filter(([, x]) => x));
  const { data: cfg } = await anonClient().rpc('registration_info', { p_org: site.organization_id });
  const c = cfg as { enabled: boolean; fee: number; currency: string; title: string } | null;
  if (!c?.enabled) return { ok: false, error: 'La inscripción en línea no está habilitada.' };
  if (Number(c.fee) <= 0) {
    try {
      const { ensureBuyerUser } = await import('@/lib/payments');
      const user = await ensureBuyerUser(email, v(fd, 'name'), `inscripcion:${Date.now()}`);
      const { error } = await createAdminClient().rpc('register_web_free', {
        p_org: site.organization_id, p_user: user, p_name: v(fd, 'name'), p_email: email, p_phone: v(fd, 'phone'),
        p_doc_country: doc.country, p_doc_type: doc.type, p_doc_number: doc.number, p_form: form,
      });
      if (error) return { ok: false, error: explain(error) };
      return { ok: true, message: '¡Inscripción recibida!', data: { method: 'GET', url: `/inscripcion/lista?correo=${encodeURIComponent(email)}` } };
    } catch (e) { console.error(e); return { ok: false, error: 'No se pudo registrar la inscripción. Intente nuevamente.' }; }
  }
  const provider = v(fd, 'provider') as ProviderId;
  const { data, error } = await anonClient().rpc('create_registration_order', {
    p_org: site.organization_id, p_provider: provider, p_name: v(fd, 'name'), p_email: email, p_phone: v(fd, 'phone'),
    p_doc_country: doc.country, p_doc_type: doc.type, p_doc_number: doc.number, p_form: form,
  });
  if (error) return { ok: false, error: explain(error) };
  const o = data as { order_id: string; order_number: number; amount: number; currency: string; title: string };
  try {
    const start = await startPayment(provider, { id: o.order_id, number: o.order_number, amount: Number(o.amount), currency: o.currency, title: o.title, email, name: v(fd, 'name'), bank: v(fd, 'bank') || undefined });
    return { ok: true, message: 'Redirigiendo al pago seguro…', data: start.redirect };
  } catch (e) {
    console.error(e);
    await createAdminClient().rpc('mark_order_result', { p_order: o.order_id, p_provider: provider, p_reference: null, p_paid: false, p_amount: 0, p_currency: o.currency, p_status: 'start_error', p_payload: { error: String(e) } });
    return { ok: false, error: 'No fue posible conectar con el medio de pago. No se realizó ningún cobro; intente nuevamente o elija otro medio.' };
  }
}
