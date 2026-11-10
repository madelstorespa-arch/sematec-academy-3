'use server';
import { getContext } from '@/lib/context';

export type SearchHit = { kind: string; id: string; title: string; subtitle: string; href: string };

/** 🔍 Búsqueda en todo el sistema: solo devuelve lo que el usuario tiene permiso de ver (RLS). */
export async function searchAll(q: string): Promise<SearchHit[]> {
  const text = String(q ?? '').slice(0, 80).trim();
  if (text.length < 2) return [];
  const ctx = await getContext();
  if (!ctx.orgId) return [];
  const [{ data, error }, { data: shop }] = await Promise.all([
    ctx.supabase.rpc('global_search', { p_org: ctx.orgId, p_q: text, p_limit: 40 }),
    ctx.supabase.rpc('store_search', { p_org: ctx.orgId, p_q: text }),
  ]);
  if (error) { console.error('[buscar]', error.message); return []; }
  return [...(shop ?? []), ...(data ?? [])].map((r: any) => ({ kind: r.kind, id: r.id, title: r.title ?? '', subtitle: r.subtitle ?? '', href: r.href }));
}
