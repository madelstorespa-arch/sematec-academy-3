'use server';
import { revalidatePath } from 'next/cache';
import { getContext, requireOrg } from '@/lib/context';
import { fail, guard, ok, type ActionResult } from '@/lib/actions';
import { cleanFields, keyOf } from '@/lib/modules';
import { CATALOG, type SysTemplate } from '@/lib/systems-catalog';

function rowOf(s: SysTemplate, orgId: string, slug: string) {
  const fields = cleanFields(s.fields.map((f) => ({ label: f.label, type: f.type ?? 'text', required: f.required, options: f.options, list: f.list })));
  const k = (label?: string) => (label ? fields.find((f) => f.label === label)?.key ?? keyOf(label) : undefined);
  const features = { ...s.features, amount: k(s.features.amount), date: k(s.features.date) };
  return {
    organization_id: orgId, slug, name: s.name, icon: s.icon, description: s.description, code_prefix: s.prefix, fields,
    view_roles: s.features.public_view && !s.features.self_service ? [] : s.roles, edit_roles: s.roles,
    show_in_menu: false, active: true, area: s.area, catalog_key: s.key, workflow: s.workflow, features,
  };
}

/** 🧩 Activa sistemas del catálogo (uno, un área completa o todos). Solo el propietario. */
export async function installSystems(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const orgId = requireOrg(ctx);
    if (!ctx.isOwner) return fail('Solo el propietario activa sistemas.');
    const which = String(fd.get('which') ?? '');
    const list = which === 'all' ? CATALOG : which.startsWith('area:') ? CATALOG.filter((s) => s.area === which.slice(5)) : CATALOG.filter((s) => s.key === which);
    if (!list.length) return fail('Sistema no encontrado.');
    const { data: have } = await ctx.supabase.from('custom_modules').select('slug, catalog_key, active, id').eq('organization_id', orgId);
    const byKey = new Map((have ?? []).filter((h) => h.catalog_key).map((h) => [h.catalog_key as string, h]));
    const slugs = new Set((have ?? []).map((h) => h.slug));
    const rows = []; const reactivate: string[] = [];
    for (const s of list) {
      const h = byKey.get(s.key);
      if (h) { if (!h.active) reactivate.push(h.id); continue; }
      let slug = s.key.replace(/_/g, '-').slice(0, 38);
      for (let i = 2; slugs.has(slug); i++) slug = `${s.key.replace(/_/g, '-').slice(0, 36)}-${i}`;
      slugs.add(slug);
      rows.push(rowOf(s, orgId, slug));
    }
    if (rows.length) { const { error } = await ctx.supabase.from('custom_modules').insert(rows); if (error) return fail(error); }
    if (reactivate.length) { const { error } = await ctx.supabase.from('custom_modules').update({ active: true }).in('id', reactivate); if (error) return fail(error); }
    revalidatePath('/app', 'layout');
    const nNew = rows.length + reactivate.length;
    return ok(nNew ? `${nNew} sistema(s) activado(s). Ya están en «Sistemas» y en el Mapa de la plataforma.` : 'Esos sistemas ya estaban activos.');
  });
}

/** Desactiva un sistema (sus registros se conservan y vuelve con «Activar»). */
export async function uninstallSystem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const orgId = requireOrg(ctx);
    if (!ctx.isOwner) return fail('Solo el propietario desactiva sistemas.');
    const { error } = await ctx.supabase.from('custom_modules').update({ active: false }).eq('organization_id', orgId).eq('catalog_key', String(fd.get('key') ?? ''));
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Sistema desactivado. Sus registros se conservan.');
  });
}

/** 📌 Fijar un sistema en el menú lateral (o quitarlo). */
export async function pinSystem(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const orgId = requireOrg(ctx);
    if (!ctx.isOwner) return fail('Solo el propietario cambia el menú.');
    const { error } = await ctx.supabase.from('custom_modules').update({ show_in_menu: fd.get('on') === '1' }).eq('organization_id', orgId).eq('slug', String(fd.get('slug') ?? ''));
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok(fd.get('on') === '1' ? 'Fijado en el menú.' : 'Quitado del menú.');
  });
}
