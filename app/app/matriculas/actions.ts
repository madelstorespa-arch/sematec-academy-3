'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { docFields, fail, guard, num, ok, reqStr, str, type ActionResult } from '@/lib/actions';

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
    revalidatePath('/app/matriculas');
    return ok(`Matrícula registrada.${extra}`);
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

/** ✏ Edita una matrícula ya creada: programa, periodo, sede, malla y observaciones. */
export async function updateEnrollment(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error } = await ctx.supabase.rpc('update_enrollment', {
      p_enrollment: id, p_program: reqStr(fd, 'program_id', 'Programa'), p_period: reqStr(fd, 'period_id', 'Periodo'),
      p_campus: str(fd, 'campus_id'), p_curriculum: str(fd, 'curriculum_id'), p_notes: str(fd, 'notes') ?? '',
    });
    if (error) return fail(error);
    revalidatePath(`/app/matriculas/${id}`); revalidatePath('/app/matriculas');
    return ok('Matrícula actualizada.');
  });
}

/** Documento de identidad (RUT, pasaporte…) del estudiante, desde la matrícula. */
export async function updateEnrollmentDocument(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const student = reqStr(fd, 'student_id', 'Estudiante');
    const { error, count } = await ctx.supabase.from('students').update(docFields(fd, true), { count: 'exact' }).eq('id', student);
    if (error) return fail(error);
    if (!count) return fail('No tiene permisos para editar la ficha del estudiante.');
    revalidatePath(`/app/matriculas/${reqStr(fd, 'id', 'id')}`);
    return ok('Documento de identidad actualizado.');
  });
}

/** Inscribe la matrícula en una sección (asignatura) o da de baja una inscripción. */
export async function enrollmentSection(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const drop = str(fd, 'drop');
    const { error } = drop
      ? await ctx.supabase.rpc('drop_section', { p_section_enrollment: drop, p_reason: str(fd, 'reason') ?? 'Baja desde la matrícula' })
      : await ctx.supabase.rpc('register_section', { p_student: reqStr(fd, 'student_id', 'Estudiante'), p_section: reqStr(fd, 'section_id', 'Sección'), p_override_prerequisites: fd.get('override') === 'on' });
    if (error) return fail(error);
    revalidatePath(`/app/matriculas/${id}`);
    return ok(drop ? 'Inscripción dada de baja.' : 'Inscrito en la sección.');
  });
}

/** Agrega un arancel (cargo en cuotas) asociado a esta matrícula. */
export async function enrollmentCharge(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'id');
    const { error } = await ctx.supabase.rpc('create_charge', {
      p_student: reqStr(fd, 'student_id', 'Estudiante'), p_concept: reqStr(fd, 'concept', 'Concepto'), p_gross: num(fd, 'amount') ?? 0,
      p_currency: reqStr(fd, 'currency', 'Moneda'), p_installments: num(fd, 'installments') ?? 1, p_first_due: reqStr(fd, 'first_due', 'Primer vencimiento'),
      p_enrollment: id, p_benefit: str(fd, 'benefit_id'), p_description: str(fd, 'description') ?? 'Arancel de matrícula',
    });
    if (error) return fail(error);
    revalidatePath(`/app/matriculas/${id}`);
    return ok('Arancel y cuotas generados.');
  });
}
