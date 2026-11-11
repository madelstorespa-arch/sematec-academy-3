'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { ensureAuthUser } from '@/lib/users';
import { env } from '@/lib/env';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';

const MODES = ['aula', 'completo'];
const KINDS = ['institucion', 'instituto', 'colegio', 'universidad', 'asociacion', 'organizacion', 'empresa', 'fundacion', 'iglesia', 'otro'];

async function adminCtx() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin || ctx.aal !== 'aal2') throw new ValidationError('Solo el superadministrador con MFA puede administrar las plataformas.');
  return ctx;
}

/** Enlace válido a partir de un nombre: «Asociación Haitiana de Chile» → «asociacion-haitiana-de-chile». */
function slugify(v: string) {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}
function cleanSlug(raw: string) {
  const s = slugify(raw);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(s)) throw new ValidationError('El enlace debe tener al menos 2 letras o números (ej.: mi-instituto).');
  return s;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function welcomeMail(email: string, name: string, org: string, slug: string) {
  if (!mailEnabled()) return '';
  const link = `${env.siteUrl()}/o/${slug}`;
  try {
    await sendMail(email, `Su plataforma ${org} está lista`,
      mailLayout('SEMATEC ACADEMY', `Bienvenido a ${esc(org)}`,
        `<p>Hola ${esc(name)}:</p><p>La plataforma de <b>${esc(org)}</b> ya está activa. Usted es su propietario: puede crear usuarios, salas y clases, y cambiar la marca.</p>
         <p>Para crear su contraseña, abra el enlace y use «¿Olvidó su contraseña?» con este correo. Al primer ingreso se configura la verificación en dos pasos.</p>`,
        { href: link, label: `Abrir ${org}` }),
      `Hola ${name}: la plataforma de ${org} ya está activa. Ingrese en ${link} (use «¿Olvidó su contraseña?» para crear su contraseña).`);
    return ' Se envió el correo de bienvenida.';
  } catch { return ' (No se pudo enviar el correo de bienvenida; comparta el enlace manualmente.)'; }
}

async function create(ctx: Awaited<ReturnType<typeof adminCtx>>, p: {
  slug: string; legal: string; display: string; country: string; currency?: string | null; timezone?: string | null; tax?: string | null;
  ownerName: string; ownerEmail: string; invite: boolean; mode: string; kind: string;
}) {
  if (!MODES.includes(p.mode) || !KINDS.includes(p.kind)) throw new ValidationError('Tipo de plataforma u organización inválido.');
  const { data: c } = await ctx.supabase.from('countries').select('default_currency, default_timezone').eq('code', p.country).maybeSingle();
  if (!c) throw new ValidationError('País no disponible.');
  const { data: taken } = await ctx.supabase.from('organizations').select('id').eq('slug', p.slug).maybeSingle();
  if (taken) throw new ValidationError(`El enlace «${p.slug}» ya está en uso. Elija otro.`);
  const owner = await ensureAuthUser(p.ownerEmail, p.ownerName, p.invite ? 'invite' : 'password');
  const { data: id, error } = await ctx.supabase.rpc('create_organization', {
    p_slug: p.slug, p_legal_name: p.legal, p_display_name: p.display, p_country: p.country,
    p_currency: (p.currency || c.default_currency).toUpperCase(), p_timezone: p.timezone || c.default_timezone,
    p_owner: owner.id, p_tax_id: p.tax ?? null, p_mode: p.mode, p_kind: p.kind,
  });
  if (error) throw new ValidationError(error.message);
  const pass = 'password' in owner && owner.password ? ` Contraseña temporal del propietario (se muestra solo esta vez): ${owner.password}` : owner.created ? '' : ' (El propietario ya tenía cuenta: usa su misma contraseña.)';
  return { id: id as string, pass };
}

export async function createOrganization(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await adminCtx();
    const display = reqStr(fd, 'display_name', 'Nombre visible');
    const slug = cleanSlug(str(fd, 'slug') || display);
    const email = reqStr(fd, 'owner_email', 'Correo del propietario').toLowerCase();
    const name = reqStr(fd, 'owner_name', 'Nombre del propietario');
    const r = await create(ctx, {
      slug, legal: str(fd, 'legal_name') || display, display, country: reqStr(fd, 'country', 'País'),
      currency: str(fd, 'currency'), timezone: str(fd, 'timezone'), tax: str(fd, 'tax_id'),
      ownerName: name, ownerEmail: email, invite: !!fd.get('invite'),
      mode: String(fd.get('platform_mode') ?? 'aula'), kind: String(fd.get('org_kind') ?? 'institucion'),
    });
    const mail = fd.get('invite') ? '' : await welcomeMail(email, name, display, slug);
    revalidatePath('/app', 'layout');
    return ok(`Organización creada: enlace /o/${slug} · propietario ${email}.${r.pass}${mail}`);
  });
}

export async function setPlatform(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await adminCtx();
    const org = reqStr(fd, 'org', 'Organización');
    const mode = str(fd, 'platform_mode'); const status = str(fd, 'status');
    if (mode && !MODES.includes(mode)) return fail('Tipo inválido.');
    if (status && !['active', 'inactive'].includes(status)) return fail('Estado inválido.');
    if (status === 'inactive' && org === ctx.orgId) return fail('No puede suspender la organización con la que está trabajando ahora.');
    const { error } = await ctx.supabase.rpc('set_organization_platform', { p_org: org, p_mode: mode, p_status: status });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok(status === 'inactive' ? 'Organización suspendida: sus miembros ya no pueden entrar.' : status === 'active' ? 'Organización reactivada.' : 'Tipo de plataforma actualizado.');
  });
}

/** ✅ Aprueba una solicitud: crea la organización y la cuenta del propietario (o la registra como independiente). */
export async function approveRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await adminCtx();
    const id = reqStr(fd, 'request', 'Solicitud');
    const { data: q } = await ctx.supabase.from('org_signup_requests').select('*').eq('id', id).maybeSingle();
    if (!q) return fail('Solicitud no encontrada.');
    if (q.status !== 'pendiente') return fail('La solicitud ya fue resuelta.');
    const note = str(fd, 'note');
    if (q.wants === 'independiente') {
      const { error } = await ctx.supabase.from('external_platforms').insert({
        name: q.org_name, url: 'https://pendiente.invalid/', contact_name: q.contact_name, contact_email: q.contact_email,
        notes: 'Instalación pendiente: siga la guía «Plataforma independiente».', status: 'en_instalacion', request_id: q.id,
      });
      if (error) return fail(error);
      const { error: e2 } = await ctx.supabase.rpc('decide_org_request', { p_request: id, p_approve: true, p_org: null, p_note: note });
      if (e2) return fail(e2);
      revalidatePath('/app/instituciones');
      return ok('Solicitud aprobada como plataforma independiente. Siga la guía para instalarla y luego escriba su dirección en el directorio.');
    }
    const mode = String(fd.get('platform_mode') ?? (q.wants === 'completo' ? 'completo' : 'aula'));
    const slug = cleanSlug(str(fd, 'slug') || q.org_name);
    const r = await create(ctx, {
      slug, legal: q.org_name, display: q.org_name, country: q.country_code, ownerName: q.contact_name, ownerEmail: q.contact_email,
      invite: false, mode, kind: q.org_kind,
    });
    const { error } = await ctx.supabase.rpc('decide_org_request', { p_request: id, p_approve: true, p_org: r.id, p_note: note });
    if (error) return fail(error);
    const mail = await welcomeMail(q.contact_email, q.contact_name, q.org_name, slug);
    revalidatePath('/app', 'layout');
    return ok(`Aprobada: ${q.org_name} tiene su plataforma en /o/${slug}.${r.pass}${mail}`);
  });
}

export async function rejectRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await adminCtx();
    const { error } = await ctx.supabase.rpc('decide_org_request', { p_request: reqStr(fd, 'request', 'Solicitud'), p_approve: false, p_org: null, p_note: str(fd, 'note') });
    if (error) return fail(error);
    revalidatePath('/app/instituciones');
    return ok('Solicitud rechazada.');
  });
}

function cleanUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new ValidationError('Dirección inválida. Ejemplo: https://mi-instituto.vercel.app'); }
  if (u.protocol !== 'https:') throw new ValidationError('La dirección debe comenzar con https://');
  return (u.origin + (u.pathname === '/' ? '/' : u.pathname)).toLowerCase().slice(0, 300);
}

export async function saveExternal(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await adminCtx();
    const id = str(fd, 'id');
    const row = {
      name: reqStr(fd, 'name', 'Nombre'), url: cleanUrl(reqStr(fd, 'url', 'Dirección')),
      contact_name: str(fd, 'contact_name'), contact_email: str(fd, 'contact_email')?.toLowerCase() ?? null,
      notes: str(fd, 'notes'), status: String(fd.get('status') ?? 'activa'),
    };
    if (!['activa', 'en_instalacion', 'suspendida'].includes(row.status)) return fail('Estado inválido.');
    const { error } = id ? await ctx.supabase.from('external_platforms').update(row).eq('id', id) : await ctx.supabase.from('external_platforms').insert(row);
    if (error) return fail(error);
    revalidatePath('/app/instituciones');
    return ok(id ? 'Plataforma actualizada.' : 'Plataforma independiente agregada al directorio.');
  });
}

export async function deleteExternal(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await adminCtx();
    const { error } = await ctx.supabase.from('external_platforms').delete().eq('id', reqStr(fd, 'id', 'Plataforma'));
    if (error) return fail(error);
    revalidatePath('/app/instituciones');
    return ok('Quitada del directorio (la plataforma y su base de datos siguen funcionando).');
  });
}

/** Archivos guardados (grabaciones, documentos, materiales…) de una organización, para borrarlos del almacenamiento. */
async function storageObjects(org: string) {
  const admin = createAdminClient();
  const out = new Map<string, string[]>();
  const add = (bucket: string | null | undefined, path: string | null | undefined) => {
    if (!bucket || !path) return;
    out.set(bucket, [...(out.get(bucket) ?? []), path]);
  };
  const q = async (table: string, cols: string, bucket?: string) => {
    const { data } = await admin.from(table).select(cols).eq('organization_id', org).limit(20000);
    for (const r of (data ?? []) as unknown as Record<string, string | null>[]) {
      add(bucket ?? r.storage_bucket, r.storage_path ?? r.pdf_storage_path);
    }
  };
  await Promise.all([
    q('conference_recordings', 'storage_bucket, storage_path'),
    q('document_versions', 'storage_bucket, storage_path'),
    q('enrollment_documents', 'storage_bucket, storage_path'),
    q('class_materials', 'storage_path', 'class-materials'),
    q('user_files', 'storage_path', 'user-files'),
    q('certificates', 'pdf_storage_path', 'certificates'),
  ].map((p) => p.catch(() => undefined)));
  return out;
}

/** 🗑 Elimina una organización completa (suspendida, confirmando su enlace). No se puede deshacer. */
export async function deleteOrganization(fd: FormData): Promise<ActionResult> {
  let done: { name: string; rows: number; files: number; accounts: number } | null = null;
  const res = await guard(async () => {
    const ctx = await adminCtx();
    const org = reqStr(fd, 'org', 'Organización');
    const confirm = reqStr(fd, 'confirm', 'Enlace de confirmación').trim().toLowerCase();
    if (fd.get('entiendo') !== 'on') return fail('Marque «Entiendo que no se puede deshacer».');
    if (org === ctx.orgId) return fail('No puede eliminar la organización con la que está trabajando ahora.');
    const files = await storageObjects(org);
    const { data, error } = await ctx.supabase.rpc('delete_organization', { p_org: org, p_confirm: confirm });
    if (error) return fail(error);
    const r = data as { rows: number; users: string[]; name: string };
    // Archivos del almacenamiento (si alguno falla, la organización ya no existe y no queda accesible)
    const admin = createAdminClient();
    let removed = 0;
    for (const [bucket, paths] of files) {
      for (let i = 0; i < paths.length; i += 500) {
        try { const { data: rm } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500)); removed += rm?.length ?? 0; } catch { /* sigue */ }
      }
    }
    // Cuentas que quedaron sin ninguna organización
    let accounts = 0;
    if (fd.get('borrar_cuentas') === 'on' && r.users?.length) {
      const { data: alone } = await ctx.supabase.rpc('users_without_organization', { p_users: r.users });
      for (const id of (alone ?? []) as string[]) {
        const { error: pe } = await admin.from('profiles').delete().eq('id', id);
        if (!pe) { const { error: ue } = await admin.auth.admin.deleteUser(id); if (!ue) { accounts++; continue; } }
        // Si la persona aparece en registros de otras organizaciones, su cuenta se desactiva en vez de borrarse
        await admin.from('profiles').update({ status: 'suspended', status_reason: 'Su organización fue eliminada' }).eq('id', id);
        accounts++;
      }
    }
    done = { name: r.name, rows: r.rows, files: removed, accounts };
    return ok('Eliminada');
  });
  if (!res.ok || !done) return res;
  revalidatePath('/app', 'layout');
  const d = done as { name: string; rows: number; files: number; accounts: number };
  redirect(`/app/instituciones?eliminada=${encodeURIComponent(d.name)}&filas=${d.rows}&archivos=${d.files}&cuentas=${d.accounts}`);
}
