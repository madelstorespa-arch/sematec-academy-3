'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function switchOrg(fd: FormData) {
  const id = String(fd.get('org') ?? '');
  if (/^[0-9a-f-]{36}$/.test(id)) {
    (await cookies()).set('sa_org', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  redirect('/app');
}

/** 🏢 Cambia la sucursal con la que se trabaja (solo si la persona tiene acceso a ella). */
export async function switchBranch(fd: FormData) {
  const id = String(fd.get('branch') ?? '');
  const jar = await cookies();
  if (/^[0-9a-f-]{36}$/i.test(id)) jar.set('sematec-sucursal', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  else jar.delete('sematec-sucursal');
  revalidatePath('/app', 'layout');
}

/** 🌐 Idioma de la plataforma para ESTA persona (no cambia nada para las demás). */
export async function setMyLocale(fd: FormData) {
  const { isLocale } = await import('@/lib/i18n');
  const locale = String(fd.get('locale') ?? 'es');
  if (!isLocale(locale)) return;
  const { createClient } = await import('@/lib/supabase/server');
  const sb = await createClient();
  await sb.rpc('update_my_preferences', { p_patch: { locale } });
  revalidatePath('/app', 'layout');
}
