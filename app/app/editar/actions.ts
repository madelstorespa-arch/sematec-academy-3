'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';
import { tzOffset } from '@/lib/format';
import { ENTITIES } from '@/lib/entities';

type Col = { col: string; data_type: string; nullable: boolean; choices: string[] | null; ref_table: string | null };

/** ✏️ Guarda la edición universal del propietario (la base valida permisos, columnas y valores). */
export async function saveEntity(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId || !ctx.isOwner) return fail('Solo el propietario institucional puede editar.');
    const table = reqStr(fd, 'table', 'módulo'); const id = reqStr(fd, 'id', 'registro');
    const spec = ENTITIES[table];
    if (!spec || !/^[0-9a-f-]{36}$/i.test(id)) return fail('Módulo no editable.');
    const { data: schema, error: se } = await ctx.supabase.rpc('entity_schema', { p_table: table, p_org: ctx.orgId });
    if (se) return fail(se);
    const cols = (schema as Col[]).filter((c) => !spec.fields || spec.fields.includes(c.col));
    const { data: org } = await ctx.supabase.from('organizations').select('timezone').eq('id', ctx.orgId).single();
    const tz = org?.timezone ?? 'America/Santiago';
    const payload: Record<string, unknown> = {};
    for (const c of cols) {
      if (!fd.has(c.col)) continue;
      const raw = String(fd.get(c.col) ?? '').trim();
      if (c.data_type === 'boolean') payload[c.col] = raw === 'true';
      else if (c.data_type === 'array') payload[c.col] = raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : [];
      else if (c.data_type.startsWith('timestamp')) {
        if (!raw) payload[c.col] = null;
        else {
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return fail(`Fecha y hora inválida en «${c.col}».`);
          payload[c.col] = `${raw}:00${tzOffset(tz, new Date(raw + ':00Z'))}`;
        }
      } else if (!raw && c.data_type !== 'text') payload[c.col] = null;
      else if (!raw && c.nullable) payload[c.col] = null;
      else payload[c.col] = raw;
    }
    const { error } = await ctx.supabase.rpc('owner_update', { p_table: table, p_id: id, p_data: payload });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    return ok('Cambios guardados. Puede deshacerlos con ↶ Deshacer.');
  });
}
