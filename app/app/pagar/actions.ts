'use server';
import { getContext } from '@/lib/context';
import { explain, type ActionResult } from '@/lib/actions';
import { startPayment } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ProviderId } from '@/lib/payments/types';

/** Pago en línea de cuotas (estudiante o apoderado): crea el pedido y redirige al pago seguro. */
export async function payInstallments(fd: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const provider = String(fd.get('provider') ?? '') as ProviderId;
  const ids = fd.getAll('inst').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) return { ok: false, error: 'Marque las cuotas que desea pagar.' };
  const { data, error } = await ctx.supabase.rpc('create_installments_order', {
    p_student: String(fd.get('student_id') ?? ''), p_installments: ids, p_provider: provider,
  });
  if (error) return { ok: false, error: explain(error) };
  const o = data as { order_id: string; order_number: number; amount: number; currency: string; title: string };
  try {
    const start = await startPayment(provider, {
      id: o.order_id, number: o.order_number, amount: Number(o.amount), currency: o.currency, title: o.title,
      email: ctx.user.email ?? '', name: ctx.profile?.full_name ?? '', bank: String(fd.get('bank') ?? '') || undefined,
    });
    return { ok: true, message: 'Redirigiendo al pago seguro…', data: start.redirect };
  } catch (e) {
    console.error(e);
    await createAdminClient().rpc('mark_order_result', { p_order: o.order_id, p_provider: provider, p_reference: null, p_paid: false, p_amount: 0, p_currency: o.currency, p_status: 'start_error', p_payload: { error: String(e) } });
    return { ok: false, error: 'No fue posible conectar con el medio de pago. No se realizó ningún cobro; intente nuevamente o elija otro medio.' };
  }
}
