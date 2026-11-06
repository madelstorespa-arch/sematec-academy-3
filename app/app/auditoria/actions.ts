'use server';
import { getContext } from '@/lib/context';
import { fail, guard, ok, type ActionResult } from '@/lib/actions';

export async function verifyChain(): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('verify_audit_chain', { p_org: ctx.orgId });
    if (error) return fail(error);
    const r = (data as any[])[0];
    return r.ok ? ok(`Cadena íntegra: ${r.checked} eventos verificados, sin alteraciones.`)
      : fail(`¡ALERTA! La cadena de auditoría está alterada a partir del evento N° ${r.first_broken_seq}. Inicie el procedimiento de incidentes.`);
  });
}
