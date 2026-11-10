'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { isLocale } from '@/lib/i18n';
import { fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';

const done = (m: string) => { revalidatePath('/app', 'layout'); return ok(m); };
/** La configuración de todo el sistema (institución, sedes, salas, reglas) solo la cambia el propietario. */
async function ownerCtx() {
  const ctx = await getContext();
  if (!ctx.isOwner && !ctx.isPlatformAdmin) throw new ValidationError('Solo el propietario puede cambiar la configuración de todo el sistema. Usted puede cambiar «Mi configuración».');
  return ctx;
}

export async function updateOrganization(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await ownerCtx();
    const { error, count } = await ctx.supabase.from('organizations').update({
      legal_name: reqStr(fd, 'legal_name', 'Razón social'), display_name: reqStr(fd, 'display_name', 'Nombre visible'),
      tax_id: str(fd, 'tax_id'), timezone: reqStr(fd, 'timezone', 'Zona horaria'), default_locale: reqStr(fd, 'default_locale', 'Idioma'),
    }, { count: 'exact' }).eq('id', ctx.orgId!);
    if (error) return fail(error);
    return count ? done('Datos institucionales actualizados.') : fail('No tiene permisos.');
  });
}

export async function createCampus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await ownerCtx();
    const { error } = await ctx.supabase.from('campuses').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      country_code: reqStr(fd, 'country_code', 'País'), city: str(fd, 'city'), address: str(fd, 'address'), timezone: reqStr(fd, 'timezone', 'Zona horaria'),
    });
    return error ? fail(error) : done('Sede creada.');
  });
}

export async function createRoom(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await ownerCtx();
    const { error } = await ctx.supabase.from('rooms').insert({
      organization_id: ctx.orgId, campus_id: reqStr(fd, 'campus_id', 'Sede'), code: reqStr(fd, 'code', 'Código').toUpperCase(),
      name: reqStr(fd, 'name', 'Nombre'), capacity: num(fd, 'capacity'), room_type: reqStr(fd, 'room_type', 'Tipo'),
    });
    return error ? fail(error) : done('Sala creada.');
  });
}

export async function saveSetting(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await ownerCtx();
    const key = reqStr(fd, 'key', 'Parámetro');
    const raw = reqStr(fd, 'value', 'Valor');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { value = raw; }
    const { data: existing } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', ctx.orgId!).eq('key', key).maybeSingle();
    const { error } = existing
      ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', existing.id)
      : await ctx.supabase.from('organization_settings').insert({ organization_id: ctx.orgId, key, value, description: str(fd, 'description'), updated_by: ctx.user.id });
    return error ? fail(error) : done(`Parámetro «${key}» guardado.`);
  });
}

// ---------- ⚙ Mi configuración (personal, por rol) ----------
const on = (fd: FormData, k: string) => fd.getAll(k).includes('on');
export async function savePreferences(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const part = String(fd.get('part') ?? '');
    let patch: Record<string, unknown> = {};
    if (part === 'personal') {
      const home = String(fd.get('home') ?? '');
      const locale = String(fd.get('locale') ?? 'es');
      patch = { home: /^\/app(\/[a-z0-9/_-]*)?$/.test(home) ? home : null, notices: on(fd, 'notices'), density: fd.get('density') === 'compacta' ? 'compacta' : 'normal',
        ...(isLocale(locale) ? { locale } : {}) };
    } else if (part === 'teaching') {
      if (!ctx.teacherId && !ctx.isOwner) throw new ValidationError('Esta sección es para profesores.');
      patch = { teaching: { waiting_room: on(fd, 'waiting_room'), students_share: on(fd, 'students_share') } };
    } else if (part === 'pos') {
      if (!ctx.perms.has('store.view') && !ctx.perms.has('store.create')) throw new ValidationError('Esta sección es para quienes atienden la caja.');
      const m = String(fd.get('method') ?? 'cash');
      patch = { pos: { method: ['cash', 'card', 'bank_transfer', 'other'].includes(m) ? m : 'cash', auto_print: on(fd, 'auto_print') } };
    } else if (part === 'finance') {
      if (!ctx.perms.has('finance.create')) throw new ValidationError('Esta sección es para finanzas.');
      patch = { finance: { send_receipt: on(fd, 'send_receipt') } };
    } else throw new ValidationError('Sección inválida.');
    const { error } = await ctx.supabase.rpc('update_my_preferences', { p_patch: patch });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Su configuración quedó guardada (solo le afecta a usted).');
  });
}
