-- =====================================================================
-- Migración 010 · Certificados verificables y requisitos de egreso
-- Sistema 36 · RF-049, RF-050
-- =====================================================================

create table public.certificate_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            text not null,
  name            text not null,
  certificate_type text not null check (certificate_type in
                   ('enrollment','course_completion','program_completion','conference_attendance','other')),
  title_template  text not null,                -- p.ej. 'Certificado de aprobación: {{course}}'
  body_template   text not null default '',
  layout          jsonb not null default '{}'::jsonb,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.certificates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  template_id        uuid not null,
  serial_number      bigint not null,
  verification_code  text not null unique check (verification_code ~ '^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$'),
  student_id         uuid,
  recipient_user_id  uuid references public.profiles(id),
  recipient_name     text not null,
  program_id         uuid,
  course_id          uuid,
  conference_session_id uuid,
  title              text not null,
  payload            jsonb not null,           -- datos certificados (canónicos)
  content_hash       text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  pdf_storage_path   text,
  status             public.certificate_status not null default 'issued',
  issued_at          timestamptz not null default now(),
  issued_by          uuid references public.profiles(id),
  revoked_at         timestamptz,
  revoked_by         uuid references public.profiles(id),
  revoke_reason      text,
  unique (organization_id, serial_number),
  check (status <> 'revoked' or (revoked_at is not null and revoke_reason is not null)),
  foreign key (organization_id, template_id) references public.certificate_templates(organization_id, id),
  foreign key (organization_id, student_id)  references public.students(organization_id, id),
  foreign key (organization_id, program_id)  references public.programs(organization_id, id),
  foreign key (organization_id, course_id)   references public.courses(organization_id, id)
);

create table public.credential_verifications (
  id              bigint generated always as identity primary key,
  certificate_id  uuid references public.certificates(id),
  organization_id uuid,
  code_queried    text not null,
  result          text not null check (result in ('valid','revoked','not_found')),
  verified_at     timestamptz not null default now(),
  ip_address      inet,
  user_agent      text
);
create index on public.credential_verifications (certificate_id, verified_at desc);

-- Un certificado emitido es inmutable salvo su revocación
create or replace function private.guard_certificate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Los certificados no se eliminan; se revocan' using errcode = '42501'; end if;
  if old.status = 'revoked' then raise exception 'Certificado revocado: inmutable' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['status','revoked_at','revoked_by','revoke_reason','pdf_storage_path'])
     is distinct from (to_jsonb(old) - array['status','revoked_at','revoked_by','revoke_reason','pdf_storage_path']) then
    raise exception 'El contenido de un certificado emitido no puede alterarse' using errcode = '42501';
  end if;
  if old.pdf_storage_path is not null and new.pdf_storage_path is distinct from old.pdf_storage_path then
    raise exception 'El PDF de un certificado no puede reemplazarse' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard_certificate before update or delete on public.certificates
  for each row execute function private.guard_certificate();

create trigger audit_cert_templates after insert or update or delete on public.certificate_templates for each row execute function private.audit_row();
create trigger audit_certificates   after insert or update or delete on public.certificates for each row execute function private.audit_row();

-- Código legible y no adivinable: XXXX-XXXX-XXXX-XXXX (sin caracteres ambiguos)
create or replace function private.new_verification_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_bytes bytea := extensions.gen_random_bytes(16);
  v text := ''; i int;
begin
  for i in 0..15 loop
    v := v || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    if i in (3, 7, 11) then v := v || '-'; end if;
  end loop;
  return v;
end $$;

-- RF-050: requisitos de egreso — todas las asignaturas obligatorias de la malla aprobadas
create or replace function public.graduation_status(p_enrollment uuid)
returns table (mandatory_courses int, approved_courses int, missing_courses text[], eligible boolean)
language plpgsql stable security definer set search_path = '' as $$
declare e public.enrollments;
begin
  select * into e from public.enrollments where id = p_enrollment;
  if not found then raise exception 'Matrícula inexistente' using errcode = 'P0002'; end if;
  if not (private.has_permission(e.organization_id, 'enrollments.view') or e.student_id in (select private.my_student_ids())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
  select count(*)::int,
         count(*) filter (where ok)::int,
         coalesce(array_agg(code order by code) filter (where not ok), '{}'),
         bool_and(ok)
  from (select c.code, exists (select 1 from public.academic_records r
                               where r.student_id = e.student_id and r.course_id = cc.course_id and r.result = 'approved') as ok
          from public.curriculum_courses cc join public.courses c on c.id = cc.course_id
         where cc.curriculum_id = e.curriculum_id and cc.is_mandatory) x;
end $$;

-- RF-049: emisión de certificado con validación de requisitos
create or replace function public.issue_certificate(
  p_template uuid, p_student uuid default null, p_course uuid default null,
  p_enrollment uuid default null, p_conference_session uuid default null, p_recipient_user uuid default null)
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
    'document', case when s.id is not null then s.id_document_country || ':' || s.id_document_type || ':' || s.id_document_number end,
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

create or replace function public.revoke_certificate(p_certificate uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_certificate for update;
  if not found then raise exception 'Certificado inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(c.organization_id, 'certificates.void') or private.current_aal() <> 'aal2' then
    raise exception 'No autorizado (requiere permiso de anulación y MFA)' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Debe indicar un motivo' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where id = c.id;
end $$;

-- Verificación pública por código (QR). Devuelve solo datos mínimos y registra la consulta.
create or replace function public.verify_certificate(p_code text, p_ip inet default null, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare c public.certificates; v_result text; v_org text; v_hash_ok boolean;
begin
  select * into c from public.certificates where verification_code = upper(trim(p_code));
  if not found then
    insert into public.credential_verifications (code_queried, result, ip_address, user_agent)
    values (left(p_code, 40), 'not_found', p_ip, left(p_user_agent, 300));
    return jsonb_build_object('valid', false, 'status', 'not_found');
  end if;
  v_hash_ok := c.content_hash = encode(extensions.digest(c.verification_code || '|' || c.payload::text, 'sha256'), 'hex');
  v_result := case when c.status = 'revoked' then 'revoked' else 'valid' end;
  insert into public.credential_verifications (certificate_id, organization_id, code_queried, result, ip_address, user_agent)
  values (c.id, c.organization_id, c.verification_code, v_result, p_ip, left(p_user_agent, 300));
  select legal_name into v_org from public.organizations where id = c.organization_id;
  return jsonb_build_object(
    'valid', v_result = 'valid' and v_hash_ok, 'status', v_result, 'integrity_ok', v_hash_ok,
    'organization', v_org, 'title', c.title, 'recipient', c.recipient_name,
    'serial', c.serial_number, 'issued_at', c.issued_at, 'revoked_at', c.revoked_at);
end $$;

-- RLS -------------------------------------------------------------------
alter table public.certificate_templates    enable row level security;
alter table public.certificates             enable row level security;
alter table public.credential_verifications enable row level security;

create policy ct_read on public.certificate_templates for select to authenticated using (private.has_permission(organization_id, 'certificates.view'));
create policy ct_ins  on public.certificate_templates for insert to authenticated with check (private.has_permission(organization_id, 'certificates.admin'));
create policy ct_upd  on public.certificate_templates for update to authenticated
  using (private.has_permission(organization_id, 'certificates.admin')) with check (private.has_permission(organization_id, 'certificates.admin'));

create policy cert_read on public.certificates for select to authenticated
  using (private.has_permission(organization_id, 'certificates.view')
         or student_id in (select private.my_student_ids())
         or recipient_user_id = (select auth.uid()));

create policy cv_read on public.credential_verifications for select to authenticated
  using (private.has_permission(organization_id, 'certificates.view'));
