'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ValidationError } from '@/lib/actions';
import { saveImage } from '@/lib/media';

const refresh = () => { revalidatePath('/', 'layout'); };
const SOCIAL = ['facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x'];

export async function saveSite(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'settings.admin')) return fail('No tiene permisos.');
    const highlights = [1, 2, 3].map((i) => ({ title: str(fd, `h${i}_title`) ?? '', text: str(fd, `h${i}_text`) ?? '' })).filter((h) => h.title);
    const social: Record<string, string> = {};
    for (const k of SOCIAL) { const u = str(fd, `social_${k}`); if (u) { if (!/^https:\/\//.test(u)) return fail(`El enlace de ${k} debe comenzar con https://`); social[k] = u; } }
    const row = {
      organization_id: ctx.orgId, site_name: reqStr(fd, 'site_name', 'Nombre de la academia'), tagline: str(fd, 'tagline') ?? '',
      primary_color: reqStr(fd, 'primary_color', 'Color principal'), accent_color: reqStr(fd, 'accent_color', 'Color de acento'),
      hero_title: str(fd, 'hero_title') ?? '', hero_subtitle: str(fd, 'hero_subtitle') ?? '', about_text: str(fd, 'about_text') ?? '',
      mission: str(fd, 'mission') ?? '', vision: str(fd, 'vision') ?? '', highlights, contact_email: str(fd, 'contact_email'),
      contact_phone: str(fd, 'contact_phone'), whatsapp: str(fd, 'whatsapp'), address: str(fd, 'address'), office_hours: str(fd, 'office_hours'),
      social_links: social, footer_text: str(fd, 'footer_text') ?? '', terms_text: str(fd, 'terms_text') ?? '', privacy_text: str(fd, 'privacy_text') ?? '',
      is_published: fd.get('is_published') === 'on', updated_by: ctx.user.id,
    };
    const { data: exists } = await ctx.supabase.from('site_settings').select('organization_id').eq('organization_id', ctx.orgId!).maybeSingle();
    const { error } = exists
      ? await ctx.supabase.from('site_settings').update(row).eq('organization_id', ctx.orgId!)
      : await ctx.supabase.from('site_settings').insert(row);
    if (error) return fail(error);
    refresh();
    return ok(row.is_published ? 'Sitio guardado y publicado.' : 'Sitio guardado (no publicado).');
  });
}

export async function uploadSiteImage(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'settings.admin')) return fail('No tiene permisos.');
    const kind = reqStr(fd, 'kind', 'tipo') as 'logo' | 'hero';
    const { data: exists } = await ctx.supabase.from('site_settings').select('organization_id').eq('organization_id', ctx.orgId!).maybeSingle();
    if (!exists) return fail('Guarde primero los datos del sitio.');
    const r = await saveImage(fd.get('file') as File, { kind, organizationId: ctx.orgId, userId: ctx.user.id, isPublic: true });
    if (r.error) return fail(r.error);
    const { error } = await ctx.supabase.from('site_settings').update({ [kind === 'logo' ? 'logo_asset_id' : 'hero_asset_id']: r.id }).eq('organization_id', ctx.orgId!);
    if (error) return fail(error);
    refresh();
    return ok(kind === 'logo' ? 'Logo actualizado en toda la plataforma.' : 'Imagen de portada actualizada.');
  });
}

function offeringRow(fd: FormData) {
  const regular = num(fd, 'regular_price') ?? num(fd, 'price');
  if (!regular || regular <= 0) throw new ValidationError('Escriba el precio normal.');
  const pct = num(fd, 'discount_pct');
  if (pct != null && (pct < 0 || pct >= 100)) throw new ValidationError('El descuento debe estar entre 0 y 99 %.');
  const price = pct ? Math.round(regular * (1 - pct / 100) * 100) / 100 : regular;
  return {
    kind: str(fd, 'kind') ?? 'curso', regular_price: regular, discount_pct: pct || null, discount_ends_on: pct ? str(fd, 'discount_ends_on') : null,
    slug: reqStr(fd, 'slug', 'Dirección web (slug)').toLowerCase(), title: reqStr(fd, 'title', 'Título'), summary: str(fd, 'summary') ?? '',
    description: str(fd, 'description') ?? '', category: str(fd, 'category') ?? 'Curso', modality: reqStr(fd, 'modality', 'Modalidad'),
    duration_text: str(fd, 'duration_text'), schedule_text: str(fd, 'schedule_text'), starts_on: str(fd, 'starts_on'),
    price, currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(), admission_mode: reqStr(fd, 'admission_mode', 'Ingreso'),
    program_id: reqStr(fd, 'program_id', 'Programa'), period_id: reqStr(fd, 'period_id', 'Periodo'), capacity: num(fd, 'capacity'),
    is_published: fd.get('is_published') === 'on', sort_order: num(fd, 'sort_order') ?? 0,
  };
}

export async function createOffering(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('catalog_offerings').insert({ organization_id: ctx.orgId, ...offeringRow(fd) });
    if (error) return fail(error);
    refresh();
    return ok('Curso creado.');
  });
}

export async function updateOffering(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error, count } = await ctx.supabase.from('catalog_offerings').update(offeringRow(fd), { count: 'exact' }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos.');
    refresh();
    return ok('Curso actualizado.');
  });
}

export async function uploadCourseImage(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'settings.admin')) return fail('No tiene permisos.');
    const r = await saveImage(fd.get('file') as File, { kind: 'course', organizationId: ctx.orgId, userId: ctx.user.id, isPublic: true });
    if (r.error) return fail(r.error);
    const { error } = await ctx.supabase.from('catalog_offerings').update({ image_asset_id: r.id }).eq('id', reqStr(fd, 'id', 'id'));
    if (error) return fail(error);
    refresh();
    return ok('Imagen del curso actualizada.');
  });
}
