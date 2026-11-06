'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

const refresh = () => revalidatePath('/app/finanzas', 'layout');

export async function createCharge(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('create_charge', {
      p_student: reqStr(fd, 'student_id', 'Estudiante'), p_concept: reqStr(fd, 'concept', 'Concepto'), p_gross: num(fd, 'amount'),
      p_currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(), p_installments: num(fd, 'installments') ?? 1,
      p_first_due: reqStr(fd, 'first_due', 'Primer vencimiento'), p_benefit: str(fd, 'benefit_id'), p_description: str(fd, 'description'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Cargo y cuotas generados.');
  });
}

export async function cancelCharge(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('cancel_charge', { p_charge: reqStr(fd, 'id', 'id'), p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    refresh();
    return ok('Cargo anulado.');
  });
}

export async function registerPayment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { data, error } = await ctx.supabase.rpc('register_payment', {
      p_student: reqStr(fd, 'student_id', 'Estudiante'), p_amount: num(fd, 'amount'), p_currency: reqStr(fd, 'currency', 'Moneda').toUpperCase(),
      p_method: reqStr(fd, 'method', 'Medio de pago'), p_provider: str(fd, 'provider'), p_external_reference: str(fd, 'external_reference'),
      p_notes: str(fd, 'notes'),
    });
    if (error) return fail(error);
    const { data: p } = await ctx.supabase.from('payments').select('receipt_number').eq('id', data).single();
    refresh();
    return ok(`Pago registrado. Recibo N° ${p?.receipt_number}.`);
  });
}

export async function voidPayment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('void_payment', { p_payment: reqStr(fd, 'id', 'id'), p_reason: reqStr(fd, 'reason', 'Motivo') });
    if (error) return fail(error);
    refresh();
    return ok('Pago anulado; se generaron los asientos de reverso.');
  });
}

export async function refundPayment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('refund_payment', {
      p_payment: reqStr(fd, 'id', 'id'), p_amount: num(fd, 'amount'), p_method: reqStr(fd, 'method', 'Medio'), p_reason: reqStr(fd, 'reason', 'Motivo'),
    });
    if (error) return fail(error);
    refresh();
    return ok('Reembolso registrado.');
  });
}

export async function createBenefit(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const kind = reqStr(fd, 'kind', 'Tipo');
    const value = num(fd, 'value');
    const { error } = await ctx.supabase.from('benefits').insert({
      organization_id: ctx.orgId, code: reqStr(fd, 'code', 'Código').toUpperCase(), name: reqStr(fd, 'name', 'Nombre'),
      percent_off: kind === 'percent' ? value : null, amount_off: kind === 'amount' ? value : null,
    });
    if (error) return fail(error);
    refresh();
    return ok('Beneficio creado.');
  });
}
