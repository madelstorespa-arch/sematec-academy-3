import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Cliente con la clave service_role. SOLO servidor. Se usa exclusivamente para:
 * crear/invitar usuarios en Auth, registrar intentos fallidos y procesar webhooks.
 * Antes de usarlo, el llamador debe haber verificado la autorización del usuario.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor');
  return createClient(env.supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
