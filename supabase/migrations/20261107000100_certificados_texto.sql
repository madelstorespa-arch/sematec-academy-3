-- =====================================================================
-- Certificados con más texto: texto de la plantilla editable, firmas,
-- pie y texto adicional por certificado (incluido en la huella SHA-256).
-- El N° de documento ya no se imprime en los certificados.
-- =====================================================================
alter table public.certificate_templates
  add column if not exists subtitle text check (length(subtitle) <= 300),
  add column if not exists footer_text text check (length(footer_text) <= 1000),
  add column if not exists signer1_name text, add column if not exists signer1_title text,
  add column if not exists signer2_name text, add column if not exists signer2_title text,
  add column if not exists city text;

drop function if exists public.issue_certificate(uuid, uuid, uuid, uuid, uuid, uuid);
create or replace function public.issue_certificate(
  p_template uuid, p_student uuid default null, p_course uuid default null,
  p_enrollment uuid default null, p_conference_session uuid default null, p_recipient_user uuid default null,
  p_extra text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.certificate_templates; s public.students; e public.enrollments; o public.organizations;
  v_name text; v_title text; v_payload jsonb; v_code text; v_serial bigint; v_id uuid; v_course text; v_program text;
  v_grade numeric; v_eligible boolean;
begin
  select * into t from public.certificate_templates where id = p_template and status = 'active';
  if not found then raise exception 'Plantilla inexistente o inactiva' using errcode = 'P0002'; end if;
  if not private.has_permission(t.organization_id, 'certificates.create') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into o from public.organizations where id = t.organization_id;
  if p_student is not null then
    select * into s from public.students where id = p_student and organization_id = t.organization_id;
    if not found then raise exception 'Estudiante no pertenece a la institución' using errcode = '42501'; end if;
    v_name := s.first_names || ' ' || s.last_names;
    -- Configurable sin código: bloquear certificados con deuda vencida
    if (private.org_setting(t.organization_id, 'certificates.block_if_overdue', 'false'::jsonb))::boolean
       and exists (select 1 from public.installment_balances b
                    where b.student_id = s.id and b.days_overdue > 0 and not b.cancelled) then
      raise exception 'El estudiante registra deuda vencida' using errcode = '23514';
    end if;
  end if;

  case t.certificate_type
    when 'enrollment' then
      select * into e from public.enrollments where id = p_enrollment and student_id = p_student and status = 'active';
      if not found then raise exception 'No existe matrícula activa' using errcode = '23514'; end if;
      select name into v_program from public.programs where id = e.program_id;
    when 'course_completion' then
      select r.final_grade, c.name into v_grade, v_course
        from public.academic_records r join public.courses c on c.id = r.course_id
       where r.student_id = p_student and r.course_id = p_course and r.result = 'approved'
       order by r.closed_at desc limit 1;
      if v_course is null then raise exception 'La asignatura no está aprobada' using errcode = '23514'; end if;
    when 'program_completion' then
      select * into e from public.enrollments where id = p_enrollment and student_id = p_student;
      if not found then raise exception 'Matrícula inexistente' using errcode = 'P0002'; end if;
      select g.eligible into v_eligible from public.graduation_status(p_enrollment) g;
      if not coalesce(v_eligible, false) then raise exception 'No cumple los requisitos de egreso' using errcode = '23514'; end if;
      select name into v_program from public.programs where id = e.program_id;
    when 'conference_attendance' then
      if not exists (select 1 from public.conference_participants cp
                      where cp.session_id = p_conference_session and cp.user_id = p_recipient_user and cp.attended) then
        raise exception 'El participante no cumple la asistencia requerida' using errcode = '23514';
      end if;
      select full_name into v_name from public.profiles where id = p_recipient_user;
    else null;
  end case;
  if coalesce(trim(v_name), '') = '' then raise exception 'Destinatario sin nombre' using errcode = '22023'; end if;

  v_title := replace(replace(replace(t.title_template, '{{course}}', coalesce(v_course, '')),
                     '{{program}}', coalesce(v_program, '')), '{{name}}', v_name);
  v_serial := private.next_number(t.organization_id, 'certificate');
  v_code := private.new_verification_code();
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'organization', o.legal_name, 'organization_id', o.id, 'serial', v_serial, 'type', t.certificate_type,
    'title', v_title, 'recipient', v_name,
    'extra', nullif(left(trim(p_extra), 2000), ''),
    -- Texto, firmas y pie quedan fijados en el certificado (no cambian si se edita la plantilla)
    'subtitle', nullif(t.subtitle, ''), 'footer', nullif(t.footer_text, ''), 'city', nullif(t.city, ''),
    'body', nullif(replace(replace(replace(replace(replace(coalesce(t.body_template, ''),
              '{{name}}', v_name), '{{program}}', coalesce(v_program, '')), '{{course}}', coalesce(v_course, '')),
              '{{grade}}', coalesce(v_grade::text, '')), '{{date}}', to_char(now() at time zone o.timezone, 'DD-MM-YYYY')), ''),
    'signers', (select jsonb_agg(x) from (values (t.signer1_name, t.signer1_title), (t.signer2_name, t.signer2_title)) v(n, c),
                lateral (select jsonb_build_object('name', v.n, 'title', v.c) x) j where coalesce(trim(v.n), '') <> ''),
    'program', v_program, 'course', v_course, 'final_grade', v_grade,
    'conference_session', p_conference_session, 'issued_on', to_char(now() at time zone o.timezone, 'YYYY-MM-DD')));

  insert into public.certificates (organization_id, template_id, serial_number, verification_code, student_id,
      recipient_user_id, recipient_name, program_id, course_id, conference_session_id, title, payload, content_hash, issued_by)
  values (t.organization_id, t.id, v_serial, v_code, p_student, coalesce(p_recipient_user, s.user_id), v_name,
      e.program_id, p_course, p_conference_session, v_title, v_payload,
      encode(extensions.digest(v_code || '|' || v_payload::text, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- Editar un certificado ya emitido sin romper su autenticidad: se emite una versión
-- corregida (nuevo N° y código QR, con el texto editado) y la anterior queda revocada
-- indicando que fue reemplazada. Requiere permiso de anulación y MFA.
create or replace function public.amend_certificate(p_certificate uuid, p_changes jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.certificates; o public.organizations; v_payload jsonb; v_code text; v_serial bigint; v_id uuid; v_title text; v_name text;
begin
  select * into c from public.certificates where id = p_certificate for update;
  if not found then raise exception 'Certificado inexistente' using errcode = 'P0002'; end if;
  if c.status <> 'issued' then raise exception 'Solo se editan certificados vigentes' using errcode = '22023'; end if;
  if not private.has_permission(c.organization_id, 'certificates.void') or private.current_aal() <> 'aal2' then
    raise exception 'No autorizado (requiere permiso de anulación y MFA)' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Indique el motivo del cambio' using errcode = '22023'; end if;
  select * into o from public.organizations where id = c.organization_id;
  v_title := coalesce(nullif(trim(p_changes ->> 'title'), ''), c.title);
  v_name := coalesce(nullif(trim(p_changes ->> 'recipient'), ''), c.recipient_name);
  v_serial := private.next_number(c.organization_id, 'certificate');
  v_code := private.new_verification_code();
  v_payload := jsonb_strip_nulls(
    (c.payload - array['serial','title','recipient','subtitle','body','extra','city','footer','signers','issued_on','replaces','document'])
    || jsonb_build_object(
      'serial', v_serial, 'title', v_title, 'recipient', v_name,
      'subtitle', nullif(trim(p_changes ->> 'subtitle'), ''), 'body', nullif(trim(p_changes ->> 'body'), ''),
      'extra', nullif(left(trim(p_changes ->> 'extra'), 2000), ''), 'city', nullif(trim(p_changes ->> 'city'), ''),
      'footer', nullif(trim(p_changes ->> 'footer'), ''),
      'signers', (select jsonb_agg(x) from jsonb_array_elements(coalesce(p_changes -> 'signers', '[]'::jsonb)) x
                  where coalesce(trim(x ->> 'name'), '') <> ''),
      'issued_on', to_char(now() at time zone o.timezone, 'YYYY-MM-DD'),
      'replaces', c.verification_code));
  insert into public.certificates (organization_id, template_id, serial_number, verification_code, student_id,
      recipient_user_id, recipient_name, program_id, course_id, conference_session_id, title, payload, content_hash, issued_by)
  values (c.organization_id, c.template_id, v_serial, v_code, c.student_id, c.recipient_user_id, v_name, c.program_id,
      c.course_id, c.conference_session_id, v_title, v_payload,
      encode(extensions.digest(v_code || '|' || v_payload::text, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'Reemplazado por el certificado N° ' || v_serial || ' (código ' || v_code || '): ' || trim(p_reason)
   where id = c.id;
  return v_id;
end $$;
revoke all on function public.amend_certificate(uuid, jsonb, text) from public, anon;
grant execute on function public.amend_certificate(uuid, jsonb, text) to authenticated;
