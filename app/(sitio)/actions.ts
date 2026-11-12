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

const FORM_KEYS = ['birth_date', 'address', 'city', 'education', 'guardian_name', 'guardian_phone', 'how_found', 'notes', 'shift', 'modality'] as const;
const RECEIPT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

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
  const form: Record<string, string> = Object.fromEntries(FORM_KEYS.map((k) => [k, v(fd, k).slice(0, 500)]).filter(([, x]) => x));
  const { data: cfg } = await anonClient().rpc('registration_info', { p_org: site.organization_id });
  const c = cfg as { enabled: boolean; fee: number; currency: string; title: string; ask_program?: boolean; shifts: string[]; modalities: string[]; programs: { id: string; name: string }[]; notify_email?: string; bank_info?: string; office_info?: string } | null;
  if (!c?.enabled) return { ok: false, error: 'La inscripción en línea no está habilitada.' };
  // Curso o carrera, jornada y modalidad (solo opciones ofrecidas)
  const pid = v(fd, 'program_id');
  if (pid && pid !== 'otro') {
    const p = c.programs?.find((x) => x.id === pid);
    if (!p) return { ok: false, error: 'Elija un curso o carrera de la lista.' };
    form.program_id = p.id; form.program = p.name;
  } else if (pid === 'otro') form.program = 'Aún no lo decide';
  else if (c.ask_program !== false && c.programs?.length) return { ok: false, error: 'Elija el curso o carrera que le interesa.' };
  if (form.shift && !c.shifts?.includes(form.shift)) return { ok: false, error: 'Elija una jornada de la lista.' };
  if (form.modality && !c.modalities?.includes(form.modality)) return { ok: false, error: 'Elija una modalidad de la lista.' };
  const method = v(fd, 'provider');
  if (Number(c.fee) > 0 && (method === 'transfer' || method === 'office')) return registerOffline(fd, site.organization_id, method, email, doc, form, c);
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


/** Inscripción con comprobante de transferencia o con pago presencial: queda pendiente hasta que la institución la verifica. */
async function registerOffline(fd: FormData, org: string, method: 'transfer' | 'office', email: string, doc: { country: string | null; type: string | null; number: string | null },
  form: Record<string, string>, c: { fee: number; currency: string; title: string; notify_email?: string; office_info?: string }): Promise<ActionResult> {
  const file = fd.get('receipt');
  let receipt: File | null = null;
  if (method === 'transfer') {
    if (!(file instanceof File) || !file.size) return { ok: false, error: 'Adjunte el comprobante de pago (foto o PDF).' };
    if (file.size > 4 * 1024 * 1024) return { ok: false, error: 'El comprobante pesa más de 4 MB. Envíe una foto más liviana o un PDF.' };
    if (!RECEIPT_TYPES[file.type]) return { ok: false, error: 'El comprobante debe ser una imagen (JPG, PNG, WEBP, HEIC) o un PDF.' };
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    const isJpg = head[0] === 0xff && head[1] === 0xd8; const isPng = head[0] === 0x89 && head[1] === 0x50;
    const isWebp = head[8] === 0x57 && head[9] === 0x45; const isHeic = head[4] === 0x66 && head[5] === 0x74;
    if (!(isPdf || isJpg || isPng || isWebp || isHeic)) return { ok: false, error: 'El archivo no parece un comprobante válido (imagen o PDF).' };
    receipt = file;
  }
  const { data, error } = await anonClient().rpc('create_registration_request', {
    p_org: org, p_method: method, p_name: v(fd, 'name'), p_email: email, p_phone: v(fd, 'phone'),
    p_doc_country: doc.country, p_doc_type: doc.type, p_doc_number: doc.number, p_form: form, p_reference: v(fd, 'reference').slice(0, 120) || null,
  });
  if (error) return { ok: false, error: explain(error) };
  const r = data as { id: string; tracking_code: string; amount: number; currency: string };
  const admin = createAdminClient();
  if (receipt) {
    const path = `inscripciones/${org}/${r.id}/${crypto.randomUUID()}.${RECEIPT_TYPES[receipt.type]}`;
    const up = await admin.storage.from('user-files').upload(path, Buffer.from(await receipt.arrayBuffer()), { contentType: receipt.type, upsert: false });
    if (up.error) { console.error('[inscripcion] comprobante', up.error.message); await admin.from('registration_requests').delete().eq('id', r.id); return { ok: false, error: 'No se pudo guardar el comprobante. Intente nuevamente.' }; }
    await admin.from('registration_requests').update({ receipt_path: path, receipt_name: receipt.name.slice(0, 200) }).eq('id', r.id);
  }
  // Correos: a la persona (con su código e instrucciones) y a la institución
  const { sendNotice } = await import('@/lib/notify');
  const amount = Number(r.amount).toLocaleString('es-CL') + ' ' + r.currency;
  const name = v(fd, 'name').split(' ')[0];
  const detail = [form.program && `Curso o carrera: ${form.program}`, form.shift && `Jornada: ${form.shift}`, form.modality && `Modalidad: ${form.modality}`].filter(Boolean).join('\n');
  await sendNotice({ to: email, org, kind: 'inscripcion', subject: `inscripción recibida (${r.tracking_code})`, title: 'Recibimos su inscripción',
    text: `Hola ${name}:\n\n${method === 'transfer' ? `Recibimos su comprobante por ${amount}. Lo verificaremos y le avisaremos por este medio cuando quede inscrito.` : `Su inscripción quedó reservada. Acérquese a la oficina a pagar ${amount}; al pagar quedará inscrito.${c.office_info ? `\n\n${c.office_info}` : ''}`}\n\n${detail}\n\nCódigo de seguimiento: ${r.tracking_code}`,
    link: { path: `/inscripcion/lista?codigo=${r.tracking_code}&correo=${encodeURIComponent(email)}`, label: 'Ver el estado de mi inscripción' } });
  const staff = (c.notify_email ?? '').split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 5);
  for (const to of staff) await sendNotice({ to, org, kind: 'inscripcion', subject: `nueva inscripción por ${method === 'transfer' ? 'verificar (comprobante)' : 'pagar en la oficina'}`,
    title: 'Nueva inscripción por revisar', text: `${v(fd, 'name')} (${email}) se inscribió.\n${detail}\nForma de pago: ${method === 'transfer' ? 'comprobante de transferencia' : 'pagará en la oficina'} · ${amount}\nCódigo: ${r.tracking_code}`,
    link: { path: '/app/inscripciones#por-verificar', label: 'Revisar en la plataforma' } });
  return { ok: true, message: '¡Inscripción recibida!', data: { method: 'GET', url: `/inscripcion/lista?codigo=${r.tracking_code}&correo=${encodeURIComponent(email)}` } };
}
