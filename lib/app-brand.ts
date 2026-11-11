import 'server-only';
import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';

export type AppBrand = { name: string; logoId: string | null; color: string };

/**
 * Marca de la app instalable: nombre, logo y color de la institución principal
 * (SITE_ORG_ID si hay varias). No depende de que el sitio público esté publicado.
 */
export const getAppBrand = cache(async (): Promise<AppBrand> => {
  const fallback = { name: 'SEMATEC ACADEMY', logoId: null, color: '#1f45c8' };
  try {
    let q = createAdminClient().from('site_settings').select('site_name, logo_asset_id, primary_color, organization_id, is_published, organizations(created_at)');
    if (process.env.SITE_ORG_ID) q = q.eq('organization_id', process.env.SITE_ORG_ID);
    const { data: rows } = await q.limit(500);
    // Marca de la institución principal: la del sitio público publicado o, si no hay, la de la primera
    // institución creada. Nunca la de una organización agregada después (cada una usa su marca dentro de su espacio).
    const created = (r: { organizations?: unknown }) => {
      const o = r.organizations as { created_at?: string } | { created_at?: string }[] | null | undefined;
      const v = Array.isArray(o) ? o[0]?.created_at : o?.created_at;
      return v ? Date.parse(v) : Number.MAX_SAFE_INTEGER;
    };
    const data = [...(rows ?? [])].sort((a, b) => Number(!!b.is_published) - Number(!!a.is_published) || created(a) - created(b))[0];
    if (!data) return fallback;
    return {
      name: data.site_name || fallback.name,
      logoId: data.logo_asset_id ?? null,
      color: /^#[0-9a-f]{6}$/i.test(data.primary_color ?? '') ? data.primary_color : fallback.color,
    };
  } catch {
    return fallback; // base aún sin instalar
  }
});

/** URL del ícono de la app; cambia cuando cambia el logo (los dispositivos lo actualizan). */
export const appIconUrl = (b: AppBrand, size: 180 | 192 | 512, maskable = false) =>
  `/app-icon/${size}?v=${(b.logoId ?? 'base').slice(0, 8)}${maskable ? '&m=1' : ''}`;
