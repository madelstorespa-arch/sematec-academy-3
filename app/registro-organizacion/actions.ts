'use server';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { mailEnabled, sendMail, mailLayout } from '@/lib/mailer';

const KINDS = ['institucion', 'instituto', 'colegio', 'universidad', 'asociacion', 'organizacion', 'empresa', 'fundacion', 'iglesia', 'otro'];

async function clientIp() {
  const h = await headers();
  const ip = (h.get('x-real-ip') ?? h.get('x-vercel-forwarded-for') ?? (h.get('x-forwarded-for') ?? '').split(',').pop() ?? '').trim();
  return /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : null;
}

/** Solicitud pública para tener una plataforma propia en el aula virtual (el dueño la aprueba). */
export async function requestOrganization(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    if (str(fd, 'website')) return ok('Solicitud recibida.'); // trampa para robots
    const org = reqStr(fd, 'org_name', 'Nombre de la organización').slice(0, 200);
    const name = reqStr(fd, 'contact_name', 'Su nombre').slice(0, 120);
    const email = reqStr(fd, 'contact_email', 'Correo').toLowerCase().slice(0, 254);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError('Correo inválido.');
    const kind = String(fd.get('org_kind') ?? 'organizacion');
    const wants = String(fd.get('wants') ?? 'aula');
    if (!KINDS.includes(kind) || !['aula', 'completo', 'independiente'].includes(wants)) throw new ValidationError('Opción inválida.');
    const country = String(fd.get('country') ?? 'CL').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new ValidationError('País inválido.');
    const membersRaw = Number(fd.get('members_estimate') || 0);
    const members = Number.isFinite(membersRaw) && membersRaw >= 1 ? Math.min(Math.floor(membersRaw), 1000000) : null;
    const ip = await clientIp();
    const admin = createAdminClient();
    const { data: limited } = await admin.rpc('org_signup_limited', { p_ip: ip, p_email: email });
    if (limited) return fail('Ya recibimos varias solicitudes recientes. Intente de nuevo en una hora.');
    const { error } = await admin.from('org_signup_requests').insert({
      org_name: org, org_kind: kind, wants, contact_name: name, contact_email: email,
      phone: str(fd, 'phone')?.slice(0, 40) ?? null, country_code: country, members_estimate: members,
      message: str(fd, 'message')?.slice(0, 2000) ?? null, ip,
    });
    if (error) return fail(error);
    if (mailEnabled()) {
      try {
        await sendMail(email, 'Recibimos su solicitud de plataforma',
          mailLayout('SEMATEC ACADEMY', 'Solicitud recibida', `<p>Hola ${escapeHtml(name)}:</p><p>Recibimos la solicitud de <b>${escapeHtml(org)}</b>. Le avisaremos por correo cuando sea aprobada, con sus datos de acceso.</p>`),
          `Hola ${name}: recibimos la solicitud de ${org}. Le avisaremos por correo cuando sea aprobada.`);
      } catch { /* el correo es un aviso; la solicitud ya quedó guardada */ }
    }
    return ok('Solicitud recibida. Le avisaremos por correo cuando sea aprobada.');
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
