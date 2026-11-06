'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

const done = (m: string) => { revalidatePath('/app', 'layout'); return ok(m); };

export async function updateOrganization(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
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
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('campuses').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      country_code: reqStr(fd, 'country_code', 'País'), city: str(fd, 'city'), address: str(fd, 'address'), timezone: reqStr(fd, 'timezone', 'Zona horaria'),
    });
    return error ? fail(error) : done('Sede creada.');
  });
}

export async function createRoom(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.from('rooms').insert({
      organization_id: ctx.orgId, campus_id: reqStr(fd, 'campus_id', 'Sede'), code: reqStr(fd, 'code', 'Código').toUpperCase(),
      name: reqStr(fd, 'name', 'Nombre'), capacity: num(fd, 'capacity'), room_type: reqStr(fd, 'room_type', 'Tipo'),
    });
    return error ? fail(error) : done('Sala creada.');
  });
}

export async function saveSetting(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
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
