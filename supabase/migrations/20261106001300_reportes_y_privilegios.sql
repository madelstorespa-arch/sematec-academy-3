-- =====================================================================
-- Migración 013 · Reportes basados en datos y endurecimiento de privilegios
-- RF-052 · Privilegio mínimo (SEG-004, §3 ciberseguridad)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reportes (RF-052): cada función verifica reports.view
-- ---------------------------------------------------------------------
create or replace function public.report_enrollment_summary(p_org uuid, p_period uuid)
returns table (program_code text, program_name text, active int, suspended int, withdrawn int, total int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission(p_org, 'reports.view') then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select p.code, p.name,
         count(*) filter (where e.status = 'active')::int,
         count(*) filter (where e.status = 'suspended')::int,
         count(*) filter (where e.status in ('withdrawn','cancelled'))::int,
         count(e.id)::int
    from public.programs p
    left join public.enrollments e on e.program_id = p.id and e.period_id = p_period
   where p.organization_id = p_org
   group by p.code, p.name order by p.code;
end $$;

create or replace function public.report_academic_summary(p_org uuid, p_period uuid)
returns table (course_code text, section_code text, students int, approved int, failed int, avg_grade numeric, avg_attendance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission(p_org, 'reports.view') then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select c.code, s.code, count(r.id)::int,
         count(*) filter (where r.result = 'approved')::int,
         count(*) filter (where r.result = 'failed')::int,
         round(avg(r.final_grade), 2), round(avg(r.attendance_pct), 2)
    from public.sections s
    join public.courses c on c.id = s.course_id
    left join public.academic_records r on r.section_id = s.id and r.result <> 'withdrawn'
   where s.organization_id = p_org and s.period_id = p_period
   group by c.code, s.code order by c.code, s.code;
end $$;

create or replace function public.report_finance_summary(p_org uuid)
returns table (currency text, billed numeric, collected numeric, outstanding numeric, overdue numeric, students_overdue int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission(p_org, 'reports.view') and private.has_permission(p_org, 'finance.view')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
  select b.currency::text, sum(b.total_billed), sum(b.total_paid), sum(b.outstanding), coalesce(sum(b.overdue), 0),
         count(*) filter (where b.overdue > 0)::int
    from public.account_balances b where b.organization_id = p_org
   group by b.currency order by 1;
end $$;

-- ---------------------------------------------------------------------
-- Privilegios: nada abierto por defecto
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- Lectura: filtrada por RLS
grant select on all tables in schema public to authenticated;

-- Escritura directa permitida (siempre sujeta a RLS y disparadores de validación)
grant insert, update on
  public.organization_settings, public.campuses, public.departments, public.rooms, public.authorities,
  public.students, public.teachers, public.employees, public.employment_contracts, public.contacts,
  public.programs, public.curricula, public.courses, public.academic_periods, public.sections,
  public.section_schedules, public.applications, public.enrollment_documents,
  public.class_sessions, public.attendance_records, public.class_materials, public.assessments, public.grades,
  public.fee_schedules, public.benefits, public.certificate_templates, public.conference_rooms,
  public.documents
to authenticated;
grant update on public.organizations, public.conference_sessions to authenticated;
grant insert on public.grade_scales, public.curriculum_courses, public.course_prerequisites,
               public.exchange_rates, public.document_permissions to authenticated;
grant delete on public.curriculum_courses, public.course_prerequisites, public.section_schedules,
               public.document_permissions to authenticated;
grant insert, update, delete on public.countries, public.currencies, public.regional_settings to authenticated; -- RLS: solo superadmin
-- Perfil propio: solo columnas no sensibles (impide auto-asignarse superadministrador o desbloquearse)
grant update (full_name, phone, preferred_locale, timezone) on public.profiles to authenticated;
-- Notificaciones: solo marcar como leída
grant update (read_at) on public.notifications to authenticated;

-- Columnas que el cliente no puede fijar al crear/editar (las controla el servidor)
revoke update on public.sections from authenticated;
grant update (code, teacher_id, capacity, min_attendance_pct, modality, status) on public.sections to authenticated;
revoke update on public.conference_sessions from authenticated;
grant update (title, scheduled_start, scheduled_end, timezone, recording_enabled) on public.conference_sessions to authenticated;
revoke update on public.organizations from authenticated;
grant update (legal_name, display_name, tax_id, default_locale, timezone, branding, status) on public.organizations to authenticated;

-- Funciones de negocio invocables por usuarios autenticados (validan permisos internamente)
grant execute on function
  public.verify_audit_chain(uuid),
  public.grant_membership(uuid, uuid, text, uuid, timestamptz),
  public.revoke_membership(uuid, text),
  public.create_custom_role(uuid, text, text, text[], boolean),
  public.set_profile_status(uuid, public.profile_status, text),
  public.create_organization(text, text, text, char, text, text, uuid, text),
  public.decide_application(uuid, boolean, text),
  public.enroll_student(uuid, uuid, uuid, uuid, jsonb, uuid),
  public.register_section(uuid, uuid, boolean),
  public.drop_section(uuid, text),
  public.change_enrollment_status(uuid, public.enrollment_status, text),
  public.attendance_pct(uuid, uuid),
  public.weighted_average(uuid, uuid),
  public.close_section_grades(uuid),
  public.amend_grade(uuid, numeric, text),
  public.create_charge(uuid, text, numeric, text, int, date, uuid, uuid, text),
  public.register_payment(uuid, numeric, text, text, text, text, uuid[], text),
  public.void_payment(uuid, text),
  public.refund_payment(uuid, numeric, text, text),
  public.cancel_charge(uuid, text),
  public.reconcile_provider_payments(uuid, text, jsonb),
  public.graduation_status(uuid),
  public.issue_certificate(uuid, uuid, uuid, uuid, uuid, uuid),
  public.revoke_certificate(uuid, text),
  public.verify_certificate(text, inet, text),
  public.create_conference_session(uuid, text, public.conference_type, timestamptz, timestamptz, text, boolean, uuid),
  public.add_conference_participant(uuid, uuid, public.conference_role),
  public.ban_conference_participant(uuid, uuid, text),
  public.authorize_conference_join(uuid),
  public.end_conference_session(uuid),
  public.add_document_version(uuid, text, text, bigint, text, text),
  public.report_enrollment_summary(uuid, uuid),
  public.report_academic_summary(uuid, uuid),
  public.report_finance_summary(uuid)
to authenticated;

-- Verificación pública de certificados (código QR) sin iniciar sesión
grant execute on function public.verify_certificate(text, inet, text) to anon;

-- Solo backend (Edge Functions / webhooks con service_role)
grant execute on function public.record_login_failure(text, inet, text) to service_role;
grant execute on function public.record_conference_event(text, text, uuid, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.register_payment(uuid, numeric, text, text, text, text, uuid[], text) to service_role;
grant execute on function public.verify_audit_chain(uuid) to service_role;

-- Funciones auxiliares usadas por las políticas RLS y disparadores de invocador
grant execute on function
  private.current_aal(), private.is_service(), private.current_user_active(), private.is_platform_admin(),
  private.is_member(uuid), private.has_permission(uuid, text, uuid), private.can_view_user(uuid),
  private.my_student_ids(), private.my_teacher_ids(), private.teaches_section(uuid),
  private.enrolled_in_section(uuid), private.section_is_closed(uuid), private.can_grade(uuid, uuid),
  private.conference_role_of(uuid), private.can_moderate(uuid), private.can_access_document(uuid, boolean),
  private.storage_can_read(text, text), private.storage_can_write(text, text)
to authenticated;
grant execute on function private.storage_can_read(text, text) to anon;   -- devuelve false sin sesión

-- service_role (backend) conserva acceso completo, como define Supabase
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema private to service_role;
grant execute on all functions in schema public to service_role;

-- Tablas futuras: no heredan permisos abiertos
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
