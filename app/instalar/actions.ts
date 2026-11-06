'use server';
import { runInstall, setupEnabled, tokenOk } from '@/lib/setup/install';
import { createAdminClient } from '@/lib/supabase/admin';

export async function runSetup(fd: FormData) {
  if (!setupEnabled()) return { ok: false, error: 'Instalador desactivado.' };
  if (!tokenOk(String(fd.get('token') ?? ''))) {
    await new Promise((r) => setTimeout(r, 1500)); // frena intentos por fuerza bruta
    return { ok: false, error: 'Clave de instalación incorrecta.' };
  }
  try {
    const log = await runInstall(fd.get('demo') === 'on');
    // Comprobación final a través de la API de Supabase (la que usa la aplicación)
    let api = '';
    try {
      const { count, error } = await createAdminClient().from('permissions').select('*', { count: 'exact', head: true });
      api = error ? ` · Aviso: la API aún no ve las tablas (${error.message}); espere 1 minuto y recargue.` : ` · API verificada (${count} permisos).`;
    } catch { api = ''; }
    return { ok: true, message: 'Instalación completa.' + api, data: log };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
