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
  try {
    // Varias instituciones pueden publicar su sitio: la plataforma principal es la institución más antigua
    // (así una organización creada después nunca reemplaza el sitio principal). SITE_ORG_ID la fija a mano.
    let q = anonClient().from('site_settings').select('*').eq('is_published', true);
    if (process.env.SITE_ORG_ID) q = q.eq('organization_id', process.env.SITE_ORG_ID);
    const { data: rows } = await q.limit(200);
    if (!rows?.length) return null;
    if (rows.length === 1) return rows[0] as Site;
    const { data: orgs } = await anonClient().rpc('public_org_created', { p_ids: rows.map((r: any) => r.organization_id) });
    const created = new Map<string, number>((orgs as { id: string; created_at: string }[] | null ?? []).map((o) => [o.id, Date.parse(o.created_at)]));
    const at = (r: any) => created.get(r.organization_id) ?? Number.MAX_SAFE_INTEGER;
    return ([...rows].sort((a, b) => at(a) - at(b))[0] as Site) ?? null;
  } catch (e) {
    console.error('Sitio público no disponible:', (e as Error).message);
    return null; // configuración incompleta o base aún sin instalar
  }
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
