'use server';
import { revalidatePath } from 'next/cache';
import { can, getContext } from '@/lib/context';
import { docFields, fail, guard, num, ok, reqStr, str, ValidationError, type ActionResult } from '@/lib/actions';
import { checkPassword } from '@/lib/users';
import { createAndLinkAccount } from '@/lib/accounts';

const FORM_KEYS = ['birth_date', 'address', 'city', 'education', 'guardian_name', 'guardian_phone', 'how_found', 'shift', 'modality'] as const;

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
    const form: Record<string, string> = Object.fromEntries(FORM_KEYS.map((k) => [k, str(fd, k) ?? '']).filter(([, v]) => v));
    const prog = str(fd, 'program');
    if (prog) { const [id, ...name] = prog.split('|'); form.program_id = id; form.program = name.join('|').slice(0, 200); }
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
      ask_program: fd.get('ask_program') === 'on',
      shifts: list(str(fd, 'shifts'), ['Día', 'Noche']), modalities: list(str(fd, 'modalities'), ['Presencial', 'En línea', 'Semipresencial']),
      pay_online: fd.get('pay_online') === 'on', pay_transfer: fd.get('pay_transfer') === 'on', pay_office: fd.get('pay_office') === 'on',
      bank_info: (str(fd, 'bank_info') ?? '').slice(0, 800), office_info: (str(fd, 'office_info') ?? '').slice(0, 800),
      notify_email: (str(fd, 'notify_email') ?? '').slice(0, 300),
    };
    if (fee > 0 && !value.pay_online && !value.pay_transfer && !value.pay_office) throw new ValidationError('Active al menos una forma de pago.');
    const { data: existing } = await ctx.supabase.from('organization_settings').select('id').eq('organization_id', ctx.orgId!).eq('key', 'inscripcion.general').maybeSingle();
    const { error } = existing
      ? await ctx.supabase.from('organization_settings').update({ value, updated_by: ctx.user.id }).eq('id', existing.id)
      : await ctx.supabase.from('organization_settings').insert({ organization_id: ctx.orgId, key: 'inscripcion.general', value, description: 'Inscripción general en el sitio web', updated_by: ctx.user.id });
    if (error) return fail(error);
    revalidatePath('/app/inscripciones'); revalidatePath('/', 'layout');
    return ok(value.enabled ? `Inscripción en línea activa${fee > 0 ? ` con un monto de ${fee.toLocaleString('es-CL')} ${value.currency}` : ' sin costo'}.` : 'Inscripción en línea desactivada.');
  });
}

const list = (s: string | null, def: string[]) => { const xs = [...new Set((s ?? '').split(/[,\n]/).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 8); return xs.length ? xs : def; };

/** ✅ Aprobar una inscripción con comprobante o pagada en la oficina: queda registrado como estudiante con su pago. */
export async function approveRegistrationRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!can(ctx, 'students.create')) return fail('No tiene permiso para inscribir estudiantes.');
    const id = reqStr(fd, 'id', 'solicitud');
    const { data: q } = await ctx.supabase.from('registration_requests').select('id, name, email, status, organization_id').eq('id', id).maybeSingle();
    if (!q) return fail('Solicitud no encontrada.');
    const amount = num(fd, 'amount') ?? 0;
    const account = fd.get('create_account') === 'on';
    let user: string | null = null;
    if (account) { const { ensureBuyerUser } = await import('@/lib/payments'); user = await ensureBuyerUser(q.email, q.name, `inscripcion:${q.id}`); }
    const { error } = await ctx.supabase.rpc('approve_registration_request', { p_id: id, p_user: user, p_amount: amount, p_method: str(fd, 'method'), p_reference: str(fd, 'reference'), p_notes: str(fd, 'notes') });
    if (error) return fail(error);
    // 📚 Matrícula en la carrera elegida + asignaturas de su nivel (ve sus cursos y evaluaciones en el Aula)
    let aula = '';
    const period = str(fd, 'enroll_period');
    if (period && can(ctx, 'enrollments.create')) {
      const { data: rq } = await ctx.supabase.from('registration_requests').select('student_id, form_data').eq('id', id).maybeSingle();
      const program = (rq?.form_data as { program_id?: string } | null)?.program_id;
      if (rq?.student_id && program) {
        const { error: e1 } = await ctx.supabase.rpc('enroll_student', { p_student: rq.student_id, p_program: program, p_period: period });
        if (e1) aula = ` ⚠ No se pudo matricular: ${e1.message}`;
        else {
          const { data: fx, error: e2 } = await ctx.supabase.rpc('aula_fix_access', { p_org: q.organization_id, p_student: rq.student_id });
          const n = (fx as { sections?: number } | null)?.sections ?? 0;
          aula = e2 ? ' Matriculado (para inscribir sus asignaturas instale la actualización «Aula acceso»).'
            : n ? ` Matriculado e inscrito en ${n} asignatura(s): ya las ve en el Aula.` : ' Matriculado (aún no hay secciones abiertas de su malla en el periodo).';
        }
      }
    }
    let mail = '';
    if (fd.get('send_email') === 'on') {
      const intro = `Hola ${q.name.split(' ')[0]}:\n\nVerificamos su pago y su inscripción quedó aprobada. Ya está registrado como estudiante.`;
      const r = account
        ? await (await import('@/lib/recovery')).sendAccessLink(q.email, { org: q.organization_id, title: 'Su inscripción fue aprobada', intro })
        : await (await import('@/lib/notify')).sendNotice({ to: q.email, org: q.organization_id, kind: 'inscripcion', subject: 'inscripción aprobada', title: 'Su inscripción fue aprobada', text: intro, by: ctx.user.id });
      mail = r.ok ? ` ✉ Se le avisó por correo a ${q.email}.` : ` ⚠ No se pudo enviar el correo: ${r.error}`;
    }
    revalidatePath('/app/inscripciones'); revalidatePath('/app/estudiantes');
    return ok(`${q.name} quedó inscrito con su pago${account ? ' y su cuenta de acceso' : ''}.${aula}${mail}`);
  });
}

/** ✕ Rechazar (p. ej., comprobante ilegible o pago no recibido) avisando el motivo. */
export async function rejectRegistrationRequest(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const id = reqStr(fd, 'id', 'solicitud'); const notes = reqStr(fd, 'notes', 'Motivo');
    const { data: q } = await ctx.supabase.from('registration_requests').select('name, email, organization_id, tracking_code').eq('id', id).maybeSingle();
    if (!q) return fail('Solicitud no encontrada.');
    const { error } = await ctx.supabase.rpc('reject_registration_request', { p_id: id, p_notes: notes });
    if (error) return fail(error);
    let mail = '';
    if (fd.get('send_email') === 'on') {
      const r = await (await import('@/lib/notify')).sendNotice({ to: q.email, org: q.organization_id, kind: 'inscripcion', subject: 'sobre su inscripción', title: 'Su inscripción no pudo aprobarse',
        text: `Hola ${q.name.split(' ')[0]}:\n\n${notes}\n\nCódigo: ${q.tracking_code}. Puede responder a este correo o volver a inscribirse.`, by: ctx.user.id });
      mail = r.ok ? ` ✉ Se le avisó por correo.` : ` ⚠ No se pudo enviar el correo: ${r.error}`;
    }
    revalidatePath('/app/inscripciones');
    return ok(`Solicitud rechazada.${mail}`);
  });
}
