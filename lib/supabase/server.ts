import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Identificador de la acción en curso (uno por solicitud al servidor). Va en cada
 * llamada a la base para agrupar en la auditoría todo lo que hizo una misma acción
 * del usuario (así «Deshacer» revierte la acción completa, aunque tenga varios pasos).
 */
const actionId = cache(() => crypto.randomUUID());

/** Cliente con la sesión del usuario: todas las consultas pasan por RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  // 🏢 Sucursal elegida en el sistema: la base de datos la valida (si no tiene acceso, usa la suya)
  const branch = cookieStore.get('sematec-sucursal')?.value ?? '';
  const headers: Record<string, string> = { 'x-sematec-action': actionId() };
  if (/^[0-9a-f-]{36}$/i.test(branch)) headers['x-sucursal'] = branch;
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    global: { headers },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el middleware refresca la sesión.
        }
      },
    },
  });
}
