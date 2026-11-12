'use server';
import { revalidatePath } from 'next/cache';
import { can, getContext } from '@/lib/context';
import { docFields, fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { checkPassword } from '@/lib/users';
import { createAndLinkAccount } from '@/lib/accounts';

const FORM_KEYS = ['birth_date', 'address', 'city', 'education', 'guardian_name', 'guardian_phone', 'how_found'] as const;

/** 📝 Inscripción en caja o secretaría: registra al estudiante con el monto pagado, listo para matricular. */
export async function registerInternal(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'students.create')) return fail('No tiene permiso para inscribir estudiantes.');
    const doc = docFields(fd, true);
    const amount = num(fd, 'amount') ?? 0;
    if (amount < 0) throw new ValidationError('El monto no puede ser negativo.');
    const email = str(fd, 'email')?.toLowerCase() ?? null;
    const wantsAccount = fd.get('create_account') === 'on';
    if (wantsAccount && !email) throw new ValidationError('Para crear la cuenta de acceso escriba el correo.');
    const password = wantsAccount ? checkPassword(str(fd, 'password')) : null;
    const form = Object.fromEntries(FORM_KEYS.map((k) => [k, str(fd, k) ?? '']).filter(([, v]) => v));
    const first = reqStr(fd, 'first_names', 'Nombres'); const last = reqStr(fd, 'last_names', 'Apellidos');
    const { data, error } = await ctx.supabase.rpc('register_student_internal', {
      p_org: ctx.orgId, p_first: first, p_last: last, p_email: email, p_phone: str(fd, 'phone'),
      p_doc_country: doc.id_document_country, p_doc_type: doc.id_document_type, p_doc_number: doc.id_document_number, p_form: form,
      p_amount: amount, p_currency: str(fd, 'currency'), p_method: amount > 0 ? reqStr(fd, 'method', 'Medio de pago') : null,
      p_reference: str(fd, 'reference'), p_notes: str(fd, 'notes'),
    });
    if (error) return fail(error);
    const r = data as { student_id: string; payment_id: string | null };
    revalidatePath('/app/inscripciones'); revalidatePath('/app/estudiantes');
    let extra = '';
    if (wantsAccount && email && password) {
      try { await createAndLinkAccount('student', r.student_id, email, `${first} ${last}`, password); extra = ` Cuenta creada: usuario ${email}.`; }
      catch (e) { extra = ` La cuenta no se pudo crear (${(e as Error).message}); créela desde su ficha.`; }
    }
    return ok(`${first} ${last} quedó inscrito${amount > 0 ? ' y su pago registrado' : ''}.${extra} Ya puede matricularlo.`, r);
  });
}

/** Configuración del formulario de inscripción en línea del sitio web. */
export async function saveRegistrationConfig(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.isOwner && !ctx.isPlatformAdmin && !can(ctx, 'settings.edit')) return fail('Solo el propietario o un administrador puede cambiar esta configuración.');
    const fee = num(fd, 'fee') ?? 0;
    if (fee < 0) throw new ValidationError('El monto no puede ser negativo.');
    const value = {
      enabled: fd.get('enabled') === 'on', fee, currency: (str(fd, 'currency') ?? 'CLP').toUpperCase().slice(0, 3),
      title: (str(fd, 'title') ?? 'Inscripción').slice(0, 120), intro: (str(fd, 'intro') ?? '').slice(0, 800),
      ask_birth: fd.get('ask_birth') === 'on', ask_address: fd.get('ask_address') === 'on', ask_education: fd.get('ask_education') === 'on', ask_guardian: fd.get('ask_guardian') === 'on',
    };
    const { data: existing } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', ctx.orgId!).eq('key', 'inscripcion.general').maybeSingle();
    const { error } = existing
      ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', existing.id)
      : await ctx.supabase.from('organization_settings').insert({ organization_id: ctx.orgId, key: 'inscripcion.general', value, description: 'Inscripción general en el sitio web', updated_by: ctx.user.id });
    if (error) return fail(error);
    revalidatePath('/app/inscripciones'); revalidatePath('/', 'layout');
    return ok(value.enabled ? `Inscripción en línea activa${fee > 0 ? ` con un monto de ${fee.toLocaleString('es-CL')} ${value.currency}` : ' sin costo'}.` : 'Inscripción en línea desactivada.');
  });
}
