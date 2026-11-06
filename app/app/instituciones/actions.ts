'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { ensureAuthUser } from '@/lib/users';

export async function createOrganization(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isPlatformAdmin || ctx.aal !== 'aal2') return fail('Solo el superadministrador con MFA puede crear instituciones.');
    const email = reqStr(fd, 'owner_email', 'Correo del propietario');
    const owner = await ensureAuthUser(email, reqStr(fd, 'owner_name', 'Nombre del propietario'), fd.get('invite') ? 'invite' : 'password');
    const { error } = await ctx.supabase.rpc('create_organization', {
      p_slug: reqStr(fd, 'slug', 'Identificador').toLowerCase(), p_legal_name: reqStr(fd, 'legal_name', 'Razón social'),
      p_display_name: reqStr(fd, 'display_name', 'Nombre visible'), p_country: reqStr(fd, 'country', 'País'),
      p_currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(), p_timezone: reqStr(fd, 'timezone', 'Zona horaria'),
      p_owner: owner.id, p_tax_id: str(fd, 'tax_id'),
    });
    if (error) return fail(error);
    revalidatePath('/app', 'layout');
    const pass = 'password' in owner && owner.password ? ` Contraseña temporal del propietario (se muestra solo esta vez): ${owner.password}` : '';
    return ok(`Institución creada con propietario ${email}.${pass}`);
  });
}
