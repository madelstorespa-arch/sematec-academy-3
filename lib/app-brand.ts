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
    let q = createAdminClient().from('site_settings').select('site_name, logo_asset_id, primary_color, organization_id');
    if (process.env.SITE_ORG_ID) q = q.eq('organization_id', process.env.SITE_ORG_ID);
    const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
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
