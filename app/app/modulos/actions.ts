'use server';
import { revalidatePath } from 'next/cache';
import { getContext, requireOrg } from '@/lib/context';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { cleanFields, prefixOf, slugify, type CustomModule } from '@/lib/modules';
import { LOCKED, baseNav } from '@/lib/nav-items';

const refresh = () => revalidatePath('/app', 'layout');
const roles = (fd: FormData, k: string) => fd.getAll(k).map(String).filter((r) => /^[a-z_]{2,40}$/.test(r)).slice(0, 30);

async function owner() {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  if (!ctx.isOwner) throw new ValidationError('Solo el propietario puede crear o editar módulos y el menú.');
  return { ctx, orgId };
}

/** 🧩 Crea o edita un módulo: nombre, ícono, campos, quién lo ve y quién lo edita. */
export async function saveModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const id = str(fd, 'id');
    const name = reqStr(fd, 'name', 'Nombre').replace(/[<>]/g, '').slice(0, 80);
    let fields;
    try { fields = cleanFields(JSON.parse(String(fd.get('fields') ?? '[]'))); } catch { throw new ValidationError('Los campos no son válidos.'); }
    if (!fields.length) throw new ValidationError('Agregue al menos un campo (por ejemplo «Nombre»).');
    const prefix = (str(fd, 'code_prefix') ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const row = {
      name, icon: (str(fd, 'icon') ?? '🧩').slice(0, 8), description: str(fd, 'description')?.slice(0, 500) ?? null,
      code_prefix: prefix.length === 4 ? prefix : prefixOf(name), fields,
      view_roles: roles(fd, 'view_roles'), edit_roles: roles(fd, 'edit_roles'),
      show_in_menu: fd.get('show_in_menu') === 'on', active: fd.getAll('active').includes('on'),
    };
    if (id) {
      const { error } = await ctx.supabase.from('custom_modules').update(row).eq('id', id).eq('organization_id', orgId);
      if (error) return fail(error);
      refresh(); return ok(`Módulo «${name}» actualizado.`);
    }
    let slug = slugify(name) || 'modulo';
    if (slug.length < 2) slug = `${slug}-m`;
    const { data: taken } = await ctx.supabase.from('custom_modules').select('slug').eq('organization_id', orgId).like('slug', `${slug}%`);
    const used = new Set((taken ?? []).map((t) => t.slug));
    for (let n = 2; used.has(slug); n++) slug = `${slugify(name).slice(0, 36)}-${n}`;
    const { error } = await ctx.supabase.from('custom_modules').insert({ ...row, slug, organization_id: orgId });
    if (error) return fail(error);
    refresh(); return ok(`Módulo «${name}» creado: ya aparece en el menú.`, { slug });
  });
}

export async function deleteModule(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const { error } = await ctx.supabase.from('custom_modules').delete().eq('id', reqStr(fd, 'id', 'Módulo')).eq('organization_id', orgId);
    if (error) return fail(error);
    refresh(); return ok('Módulo eliminado (puede deshacerlo con ↶).');
  });
}

/** ☰ Personaliza el menú: cambiar nombres y ocultar opciones. */
export async function saveMenu(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId } = await owner();
    const hrefs = new Set(baseNav(ctx).map((i) => i.href));
    const hidden = fd.getAll('hide').map(String).filter((h) => hrefs.has(h) && !LOCKED.has(h));
    const labels: Record<string, string> = {};
    for (const h of hrefs) {
      const v = String(fd.get(`label:${h}`) ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
      if (v) labels[h] = v;
    }
    const value = { hidden, labels };
    const { data: existing } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', orgId).eq('key', 'menu.custom').maybeSingle();
    const { error } = existing
      ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', existing.id)
      : await ctx.supabase.from('organization_settings').insert({ organization_id: orgId, key: 'menu.custom', value, description: 'Menú personalizado', updated_by: ctx.user.id });
    if (error) return fail(error);
    refresh(); return ok('Menú actualizado.');
  });
}

// ---------- Registros de un módulo ----------
async function moduleFor(fd: FormData) {
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: m } = await ctx.supabase.from('custom_modules').select('*').eq('id', reqStr(fd, 'module_id', 'Módulo')).eq('organization_id', orgId).maybeSingle();
  if (!m) throw new ValidationError('Módulo no encontrado.');
  return { ctx, orgId, m: m as CustomModule };
}

function dataFrom(fd: FormData, m: CustomModule) {
  const data: Record<string, unknown> = {};
  for (const f of m.fields) {
    const raw = fd.get(`f_${f.key}`);
    if (f.type === 'checkbox') { data[f.key] = raw === 'on'; continue; }
    const v = typeof raw === 'string' ? raw.trim().slice(0, f.type === 'textarea' ? 5000 : 500) : '';
    if (!v) { if (f.required) throw new ValidationError(`Complete el campo «${f.label}».`); data[f.key] = null; continue; }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(v.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) throw new ValidationError(`«${f.label}» debe ser un número.`);
      data[f.key] = String(n);
    } else data[f.key] = v;
  }
  return data;
}

export async function saveRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, orgId, m } = await moduleFor(fd);
    const data = dataFrom(fd, m);
    const id = str(fd, 'id');
    const q = id
      ? ctx.supabase.from('custom_records').update({ data }).eq('id', id).eq('module_id', m.id).select('code').single()
      : ctx.supabase.from('custom_records').insert({ organization_id: orgId, module_id: m.id, data }).select('code').single();
    const { data: r, error } = await q;
    if (error) return fail(error);
    revalidatePath(`/app/m/${m.slug}`);
    return ok(id ? `Registro ${r.code} actualizado.` : `Registro creado con el código ${r.code}.`);
  });
}

export async function deleteRecord(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { ctx, m } = await moduleFor(fd);
    const { data, error } = await ctx.supabase.from('custom_records').delete().eq('id', reqStr(fd, 'id', 'Registro')).eq('module_id', m.id).select('id');
    if (error) return fail(error);
    if (!data?.length) return fail('No tiene permiso para eliminar este registro.');
    revalidatePath(`/app/m/${m.slug}`);
    return ok('Registro eliminado (puede deshacerlo con ↶).');
  });
}
