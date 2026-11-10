'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';

/** 🛡 Guarda las autorizaciones individuales de una persona (permitir algo extra o quitar un permiso de su rol). */
export async function saveUserPermissions(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const user = reqStr(fd, 'user_id', 'usuario');
    if (!/^[0-9a-f-]{36}$/i.test(user)) throw new ValidationError('Usuario inválido.');
    const items: { code: string; effect: string }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('p:') || (v !== 'allow' && v !== 'deny')) continue;
      const code = k.slice(2);
      if (/^[a-z_]+\.(view|create|edit|approve|void|export|admin)$/.test(code)) items.push({ code, effect: v });
    }
    const until = str(fd, 'valid_until');
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ValidationError('Fecha inválida.');
    const campus = str(fd, 'campus_id');
    const { data, error } = await ctx.supabase.rpc('set_user_permissions', {
      p_org: ctx.orgId, p_user: user, p_items: items, p_campus: campus && /^[0-9a-f-]{36}$/i.test(campus) ? campus : null,
      p_valid_until: until ? new Date(`${until}T23:59:59-03:00`).toISOString() : null, p_reason: str(fd, 'reason'),
    });
    if (error) return fail(error);
    revalidatePath(`/app/usuarios/${user}/permisos`);
    const allow = items.filter((i) => i.effect === 'allow').length, deny = items.length - allow;
    return ok(items.length ? `Autorizaciones guardadas: ${allow} permiso(s) extra y ${deny} quitado(s). Rigen desde su próxima acción (puede deshacerlo con ↶).` : `Sin autorizaciones individuales: la persona queda solo con los permisos de su rol (${data}).`);
  });
}
