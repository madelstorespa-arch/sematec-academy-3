import 'server-only';
import { cache } from 'react';
import { createClient as createPlain } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export type Site = {
  organization_id: string; site_name: string; tagline: string; logo_asset_id: string | null; hero_asset_id: string | null;
  primary_color: string; accent_color: string; hero_title: string; hero_subtitle: string; about_text: string; mission: string; vision: string;
  highlights: { title: string; text: string }[]; contact_email: string | null; contact_phone: string | null; whatsapp: string | null;
  address: string | null; office_hours: string | null; social_links: Record<string, string>; footer_text: string; terms_text: string;
  privacy_text: string; is_published: boolean;
};

/** Cliente anónimo (sin sesión): solo ve lo publicado. */
export const anonClient = () => createPlain(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false } });

/** Sitio público activo (SITE_ORG_ID permite fijar la institución si hay varias publicadas). */
export const getPublicSite = cache(async (): Promise<Site | null> => {
  let q = anonClient().from('site_settings').select('*').eq('is_published', true);
  if (process.env.SITE_ORG_ID) q = q.eq('organization_id', process.env.SITE_ORG_ID);
  const { data } = await q.order('updated_at').limit(1).maybeSingle();
  return (data as Site) ?? null;
});

export const mediaUrl = (id?: string | null) => (id ? `/media/${id}` : null);

/** Variables CSS de marca (los colores se aplican a toda la interfaz). */
export function brandStyle(primary = '#1f45c8', accent = '#10b5a3'): React.CSSProperties {
  const shade = (hex: string, f: number) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  return {
    ['--color-brand-500' as any]: shade(primary, 0.12), ['--color-brand-600' as any]: primary, ['--color-brand-700' as any]: shade(primary, -0.18),
    ['--color-brand-50' as any]: shade(primary, 0.93), ['--color-brand-100' as any]: shade(primary, 0.85), ['--color-accent' as any]: accent,
  };
}
