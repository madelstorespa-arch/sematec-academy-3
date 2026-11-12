import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Texto plano → párrafos HTML seguros. */
export const textToMailHtml = (t: string) => t.split(/\n{2,}/).map((p) => `<p style="line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

export async function brandOf(org?: string | null) {
  try {
    const admin = createAdminClient();
    const q = admin.from('site_settings').select('site_name').limit(1);
    const { data } = org ? await q.eq('organization_id', org).maybeSingle() : await q.maybeSingle();
    if (data?.site_name) return data.site_name as string;
    if (org) { const { data: o } = await admin.from('organizations').select('display_name').eq('id', org).maybeSingle(); if (o?.display_name) return o.display_name as string; }
  } catch { /* sin marca */ }
  return 'SEMATEC ACADEMY';
}

export type Mail = { to: string; subject: string; title: string; text: string; link?: { path: string; label: string }; org?: string | null; kind?: string; by?: string | null };

/** Envía un aviso por correo (nunca lanza error): devuelve si llegó al servidor de correo. */
export async function sendNotice(m: Mail): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) return { ok: false, error: 'El correo de la plataforma no está configurado.' };
  try {
    const brand = await brandOf(m.org);
    const href = m.link ? `${env.siteUrl()}${m.link.path}` : undefined;
    await sendMail(m.to, `${brand}: ${m.subject}`, mailLayout(brand, m.title, textToMailHtml(m.text), href ? { href, label: m.link!.label } : undefined),
      `${m.title}\n\n${m.text}${href ? `\n\n${m.link!.label}: ${href}` : ''}`, undefined, { org: m.org, kind: m.kind, by: m.by });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Envía el mismo aviso a varias personas de la plataforma (por id de perfil). */
export async function noticeToUsers(userIds: string[], m: Omit<Mail, 'to'>): Promise<{ sent: number; failed: number; error?: string }> {
  const ids = [...new Set(userIds.filter(Boolean))].slice(0, 500);
  if (!ids.length) return { sent: 0, failed: 0 };
  if (!mailEnabled()) return { sent: 0, failed: ids.length, error: 'El correo de la plataforma no está configurado.' };
  const { data } = await createAdminClient().from('profiles').select('email').in('id', ids);
  let sent = 0, failed = 0, error: string | undefined;
  for (const p of data ?? []) {
    if (!p.email) { failed++; continue; }
    const r = await sendNotice({ ...m, to: p.email });
    if (r.ok) sent++; else { failed++; error = r.error; }
  }
  return { sent, failed, error };
}

/** Texto para el mensaje de resultado de una acción con «enviar también por correo». */
export function mailSummary(r: { sent: number; failed: number; error?: string }) {
  if (!r.sent && !r.failed) return '';
  if (!r.sent) return ` ⚠ No se pudo enviar por correo: ${r.error ?? 'error del servidor de correo'}`;
  return ` ✉ Enviado por correo a ${r.sent} persona(s)${r.failed ? ` (${r.failed} sin enviar)` : ''}.`;
}

/** Personas activas de la institución con un permiso (p. ej., quienes atienden solicitudes). */
export async function usersWithPermission(org: string, perm: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: roles } = await admin.from('role_permissions').select('role_id').eq('permission_code', perm);
  const ids = (roles ?? []).map((r) => r.role_id);
  if (!ids.length) return [];
  const { data } = await admin.from('memberships').select('user_id').eq('organization_id', org).eq('status', 'active').in('role_id', ids).limit(200);
  return [...new Set((data ?? []).map((m) => m.user_id as string))];
}

/** Personas con alguno de estos roles (por código). */
export async function usersWithRoles(org: string, codes: string[]): Promise<string[]> {
  if (!codes.length) return [];
  const admin = createAdminClient();
  const { data: roles } = await admin.from('roles').select('id').in('code', codes).or(`organization_id.is.null,organization_id.eq.${org}`);
  const ids = (roles ?? []).map((r) => r.id);
  if (!ids.length) return [];
  const { data } = await admin.from('memberships').select('user_id').eq('organization_id', org).eq('status', 'active').in('role_id', ids).limit(200);
  return [...new Set((data ?? []).map((m) => m.user_id as string))];
}

/** Destinatarios de un anuncio según su público. */
export async function audienceUsers(org: string, audience: string, sectionId?: string | null): Promise<string[]> {
  const admin = createAdminClient();
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
  if (audience === 'students') return uniq(((await admin.from('students').select('user_id').eq('organization_id', org).not('user_id', 'is', null).limit(1000)).data ?? []).map((s) => s.user_id));
  if (audience === 'teachers') return uniq(((await admin.from('teachers').select('user_id').eq('organization_id', org).not('user_id', 'is', null).limit(1000)).data ?? []).map((s) => s.user_id));
  if (audience === 'section' && sectionId) {
    const [{ data: sec }, { data: enr }] = await Promise.all([
      admin.from('sections').select('teachers(user_id)').eq('id', sectionId).maybeSingle(),
      admin.from('section_enrollments').select('students(user_id)').eq('section_id', sectionId).eq('status', 'enrolled').limit(1000),
    ]);
    return uniq([(sec?.teachers as { user_id?: string } | null)?.user_id, ...(enr ?? []).map((e) => (e.students as { user_id?: string } | null)?.user_id)]);
  }
  const { data: mem } = await admin.from('memberships').select('user_id, roles(code)').eq('organization_id', org).eq('status', 'active').limit(2000);
  const rows = (mem ?? []) as unknown as { user_id: string; roles: { code: string } | null }[];
  if (audience === 'staff') return uniq(rows.filter((m) => !['estudiante', 'postulante', 'egresado', 'profesor'].includes(m.roles?.code ?? '')).map((m) => m.user_id));
  return uniq(rows.map((m) => m.user_id));
}

/** Nombre visible de una persona. */
export async function nameOf(userId: string) {
  const { data } = await createAdminClient().from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
  return data?.full_name || data?.email || 'Una persona de la institución';
}
