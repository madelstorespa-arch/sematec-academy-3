'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { autoStudentAccess } from '@/lib/portal-access';

export async function enroll(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const student = reqStr(fd, 'student_id', 'Estudiante');
    const program = reqStr(fd, 'program_id', 'Programa');
    const period = reqStr(fd, 'period_id', 'Periodo');
    const { data: enrollmentId, error } = await ctx.supabase.rpc('enroll_student', { p_student: student, p_program: program, p_period: period });
    if (error) return fail(error);
    let extra = '';
    // Compromiso económico opcional: genera el arancel en cuotas
    const amount = num(fd, 'amount');
    if (amount && amount > 0) {
      if (!can(ctx, 'finance.create')) extra = ' (El arancel no se generó: requiere permiso de finanzas.)';
      else {
        const { error: e2 } = await ctx.supabase.rpc('create_charge', {
          p_student: student, p_concept: 'tuition', p_gross: amount, p_currency: reqStr(fd, 'currency', 'Moneda'),
          p_installments: num(fd, 'installments') ?? 1, p_first_due: reqStr(fd, 'first_due', 'Primer vencimiento'),
          p_enrollment: enrollmentId, p_benefit: str(fd, 'benefit_id'), p_description: 'Arancel de matrícula',
        });
        extra = e2 ? ` Atención: la matrícula quedó registrada, pero el arancel NO se generó: ${e2.message}` : ' Arancel y cuotas generados.';
      }
    }
    // Cuenta del portal automática para el estudiante matriculado
    let access = '';
    if (can(ctx, 'students.edit')) {
      try { const r = await autoStudentAccess(ctx, student); if (r) access = ` ${r}`; }
      catch (e) { access = ` La cuenta del portal no se creó automáticamente: ${(e as Error).message}`; }
    }
    revalidatePath('/app/matriculas');
    return ok(`Matrícula registrada.${extra}${access}`);
  });
}

export async function changeStatus(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const { error } = await ctx.supabase.rpc('change_enrollment_status', {
      p_enrollment: reqStr(fd, 'id', 'id'), p_status: reqStr(fd, 'status', 'Estado'), p_reason: reqStr(fd, 'reason', 'Motivo'),
    });
    if (error) return fail(error);
    revalidatePath('/app/matriculas');
    return ok('Estado de la matrícula actualizado.');
  });
}
