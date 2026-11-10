import { anonClient } from '@/lib/site';

export type Avail = { capacity: number | null; taken: number; status: 'disponible' | 'ultimos' | 'agotado' | 'cerrado' };
/** Cupos de los cursos publicados (disponible, últimos cupos, agotado, cerrado). */
export async function offeringAvailability(orgId: string): Promise<Map<string, Avail>> {
  const { data } = await anonClient().rpc('offering_availability', { p_org: orgId });
  return new Map(((data ?? []) as any[]).map((r) => [r.id, { capacity: r.capacity, taken: Number(r.taken), status: r.status }]));
}
export const AVAIL_TEXT: Record<Avail['status'], [string, string]> = {
  disponible: ['● Disponible', 'text-emerald-700'], ultimos: ['● ¡Últimos cupos!', 'text-amber-600'],
  agotado: ['● Cupos agotados', 'text-red-600'], cerrado: ['● Inscripciones cerradas', 'text-slate-500'],
};
