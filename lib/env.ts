function req(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta la variable de entorno ${name}. Revise .env.local (ver .env.example).`);
  return value;
}
export const env = {
  supabaseUrl: () => req('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => req('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  /**
   * Dirección pública para los enlaces de los correos. En Vercel se detecta sola; si alguien copió por error
   * «http://localhost:3000» en NEXT_PUBLIC_SITE_URL, se ignora (los enlaces nunca deben apuntar a localhost en producción).
   */
  siteUrl: () => {
    const onVercel = !!process.env.VERCEL;
    const usable = (u?: string | null) => !!u && /^https?:\/\/[^\s/]+/.test(u) && !(onVercel && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u));
    const own = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
    const dep = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
    return ((usable(own) ? own : null) ?? prod ?? dep ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  /** true si NEXT_PUBLIC_SITE_URL tiene un valor de prueba (localhost) en producción. */
  siteUrlMisconfigured: () => !!process.env.VERCEL && /localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SITE_URL ?? ''),
};
