-- =====================================================================
-- Migración 007 · Postulaciones, matrículas e inscripción de asignaturas
-- Sistemas 06, 07, 08 · RF-010 a RF-016
-- =====================================================================

create table public.applications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  campus_id         uuid,
  program_id        uuid not null,
  period_id         uuid not null,
  contact_id        uuid references public.contacts(id),
  applicant_user_id uuid references public.profiles(id),
  form_data         jsonb not null default '{}'::jsonb,   -- formulario configurable (RF-010)
  status            public.application_status not null default 'draft',
  submitted_at      timestamptz,
  decided_at        timestamptz,
  decided_by        uuid references public.profiles(id),
  decision_notes    text,
  student_id        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, campus_id)  references public.campuses(organization_id, id),
  foreign key (organization_id, program_id) references public.programs(organization_id, id),
  foreign key (organization_id, period_id)  references public.academic_periods(organization_id, id),
  foreign key (organization_id, student_id) references public.students(organization_id, id),
  check (status in ('draft') or submitted_at is not null),
  check (status not in ('approved','rejected') or (decided_at is not null and decided_by is not null))
);

create table public.enrollments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id       uuid not null,
  student_id      uuid not null,
  program_id      uuid not null,
  curriculum_id   uuid not null,
  period_id       uuid not null,
  application_id  uuid,
  status          public.enrollment_status not null default 'active',
  status_reason   text,
  enrolled_at     timestamptz not null default now(),
  enrolled_by     uuid references public.profiles(id),
  financial_terms jsonb not null default '{}'::jsonb,       -- compromiso económico (RF-014)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (student_id, program_id, period_id),
  unique (organization_id, id),
  foreign key (organization_id, campus_id)      references public.campuses(organization_id, id),
  foreign key (organization_id, student_id)     references public.students(organization_id, id),
  foreign key (organization_id, program_id)     references public.programs(organization_id, id),
  foreign key (organization_id, curriculum_id)  references public.curricula(organization_id, id),
  foreign key (organization_id, period_id)      references public.academic_periods(organization_id, id),
  foreign key (organization_id, application_id) references public.applications(organization_id, id)
);

create table public.section_enrollments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  section_id      uuid not null,
  student_id      uuid not null,
  enrollment_id   uuid not null,
  status          public.section_enr_status not null default 'enrolled',
  enrolled_at     timestamptz not null default now(),
  dropped_at      timestamptz,
  prerequisite_override_by uuid references public.profiles(id),
  unique (section_id, student_id),
  unique (organization_id, id),
  foreign key (organization_id, section_id)    references public.sections(organization_id, id),
  foreign key (organization_id, student_id)    references public.students(organization_id, id),
  foreign key (organization_id, enrollment_id) references public.enrollments(organization_id, id)
);
create index on public.section_enrollments (student_id);

-- Documentos de postulación/matrícula en Storage privado (RF-011)
create table public.enrollment_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  application_id  uuid,
  enrollment_id   uuid,
  document_type   text not null,
  storage_bucket  text not null default 'enrollment-documents',
  storage_path    text not null check (storage_path ~ '^[0-9a-f-]{36}/'),  -- debe iniciar con el id de institución
  sha256          text check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type       text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes      bigint not null check (size_bytes between 1 and 20971520),          -- máx. 20 MB
  status          text not null default 'pending' check (status in ('pending','verified','rejected')),
  uploaded_by     uuid references public.profiles(id),
  verified_by     uuid references public.profiles(id),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(application_id, enrollment_id) >= 1),
  check (split_part(storage_path, '/', 1) = organization_id::text),
  foreign key (organization_id, application_id) references public.applications(organization_id, id),
  foreign key (organization_id, enrollment_id)  references public.enrollments(organization_id, id)
);

create trigger trg_applications_updated before update on public.applications for each row execute function private.set_updated_at();
create trigger trg_enrollments_updated  before update on public.enrollments  for each row execute function private.set_updated_at();
create trigger audit_applications after insert or update or delete on public.applications for each row execute function private.audit_row();
create trigger audit_enrollments  after insert or update or delete on public.enrollments  for each row execute function private.audit_row();
create trigger audit_section_enr  after insert or update or delete on public.section_enrollments for each row execute function private.audit_row();
create trigger audit_enr_docs     after insert or update or delete on public.enrollment_documents for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Operaciones transaccionales
-- ---------------------------------------------------------------------

-- RF-012: evaluar y comunicar postulaciones
create or replace function public.decide_application(p_application uuid, p_approve boolean, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application for update;
  if not found then raise exception 'Postulación inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(a.organization_id, 'admissions.approve', a.campus_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if a.status not in ('submitted','under_review') then
    raise exception 'La postulación no está en evaluación (estado %)', a.status using errcode = '22023';
  end if;
  update public.applications
     set status = case when p_approve then 'approved' else 'rejected' end::public.application_status,
         decided_at = now(), decided_by = auth.uid(), decision_notes = p_notes
   where id = p_application;
end $$;

-- RF-013/RF-014: matrícula en programa (con compromiso económico)
create or replace function public.enroll_student(
  p_student uuid, p_program uuid, p_period uuid, p_curriculum uuid default null,
  p_financial_terms jsonb default '{}'::jsonb, p_application uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.students; v_curr uuid; v_id uuid;
begin
  select * into s from public.students where id = p_student for share;
  if not found then raise exception 'Estudiante inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(s.organization_id, 'enrollments.create', s.campus_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if s.status <> 'active' then raise exception 'El estudiante no está activo' using errcode = '22023'; end if;
  if p_application is not null and not exists (
      select 1 from public.applications where id = p_application and status = 'approved' and organization_id = s.organization_id) then
    raise exception 'La postulación no está aprobada' using errcode = '22023';
  end if;
  v_curr := coalesce(p_curriculum, (
    select c.id from public.curricula c where c.program_id = p_program and c.status = 'active'
     order by c.valid_from desc limit 1));
  if v_curr is null then raise exception 'El programa no tiene malla vigente' using errcode = '22023'; end if;
  insert into public.enrollments (organization_id, campus_id, student_id, program_id, curriculum_id, period_id,
                                  application_id, enrolled_by, financial_terms)
  values (s.organization_id, s.campus_id, s.id, p_program, v_curr, p_period, p_application, auth.uid(), p_financial_terms)
  returning id into v_id;
  if p_application is not null then
    update public.applications set student_id = s.id where id = p_application;
  end if;
  return v_id;
end $$;

-- Inscripción de asignatura con control de cupos, prerrequisitos y choques de horario
create or replace function public.register_section(p_student uuid, p_section uuid, p_override_prerequisites boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sec public.sections; per public.academic_periods; v_enr uuid; v_taken int; v_id uuid;
  v_is_staff boolean; v_is_self boolean; v_missing text;
begin
  -- Bloqueo de la sección: serializa inscripciones concurrentes y evita sobrecupo
  select * into sec from public.sections where id = p_section for update;
  if not found then raise exception 'Sección inexistente' using errcode = 'P0002'; end if;
  select * into per from public.academic_periods where id = sec.period_id;

  v_is_staff := private.has_permission(sec.organization_id, 'enrollments.create', sec.campus_id);
  v_is_self  := p_student in (select private.my_student_ids());
  if not (v_is_staff or v_is_self) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_is_self and not v_is_staff and not (
       per.status = 'open' and current_date between coalesce(per.enrollment_opens_on, per.starts_on)
                                                and coalesce(per.enrollment_closes_on, per.ends_on)) then
    raise exception 'El periodo de inscripción no está abierto' using errcode = '22023';
  end if;
  if sec.status <> 'active' or sec.grades_closed_at is not null then
    raise exception 'La sección no admite inscripciones' using errcode = '22023';
  end if;

  select e.id into v_enr from public.enrollments e
   where e.student_id = p_student and e.period_id = sec.period_id and e.status = 'active'
     and e.organization_id = sec.organization_id
   limit 1;
  if v_enr is null then
    raise exception 'El estudiante no tiene matrícula activa en el periodo' using errcode = '22023';
  end if;

  if exists (select 1 from public.section_enrollments
              where section_id = p_section and student_id = p_student and status <> 'dropped') then
    raise exception 'El estudiante ya está inscrito en la sección' using errcode = '23505';
  end if;

  select count(*) into v_taken from public.section_enrollments
   where section_id = p_section and status = 'enrolled';
  if v_taken >= sec.capacity then
    raise exception 'Sección sin cupos disponibles (%/%)', v_taken, sec.capacity using errcode = '23514';
  end if;

  -- Prerrequisitos aprobados
  select string_agg(c.code, ', ') into v_missing
    from public.course_prerequisites p
    join public.courses c on c.id = p.prerequisite_id
   where p.course_id = sec.course_id
     and not exists (select 1 from public.academic_records r
                      where r.student_id = p_student and r.course_id = p.prerequisite_id and r.result = 'approved');
  if v_missing is not null then
    if not (p_override_prerequisites and private.has_permission(sec.organization_id, 'enrollments.approve', sec.campus_id)) then
      raise exception 'Prerrequisitos pendientes: %', v_missing using errcode = '23514';
    end if;
  end if;

  -- Choque de horario del estudiante
  if exists (
    select 1 from public.section_schedules a
    join public.section_enrollments se on se.student_id = p_student and se.status = 'enrolled'
    join public.section_schedules b on b.section_id = se.section_id
    where a.section_id = p_section and b.period_id = a.period_id and b.weekday = a.weekday
      and b.time_slot && a.time_slot) then
    raise exception 'Choque de horario con otra asignatura inscrita' using errcode = '23P01';
  end if;

  insert into public.section_enrollments (organization_id, section_id, student_id, enrollment_id, prerequisite_override_by)
  values (sec.organization_id, p_section, p_student, v_enr, case when v_missing is not null then auth.uid() end)
  on conflict (section_id, student_id) do update
     set status = 'enrolled', dropped_at = null, enrolled_at = now()
   where public.section_enrollments.status = 'dropped'
  returning id into v_id;
  if v_id is null then raise exception 'El estudiante ya está inscrito en la sección' using errcode = '23505'; end if;

  -- Registro académico en curso
  insert into public.academic_records (organization_id, student_id, course_id, section_id, period_id, result)
  values (sec.organization_id, p_student, sec.course_id, p_section, sec.period_id, 'in_progress')
  on conflict (student_id, section_id) do update set result = 'in_progress', final_grade = null;
  return v_id;
end $$;

create or replace function public.drop_section(p_section_enrollment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare se public.section_enrollments; sec public.sections;
begin
  select * into se from public.section_enrollments where id = p_section_enrollment for update;
  if not found then raise exception 'Inscripción inexistente' using errcode = 'P0002'; end if;
  select * into sec from public.sections where id = se.section_id;
  if not private.has_permission(se.organization_id, 'enrollments.edit', sec.campus_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if sec.grades_closed_at is not null then raise exception 'Acta cerrada' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', coalesce(p_reason, ''), true);
  update public.section_enrollments set status = 'dropped', dropped_at = now() where id = se.id;
  update public.academic_records set result = 'withdrawn' where student_id = se.student_id and section_id = se.section_id;
end $$;

-- RF-016: retiros, suspensiones, egresos y cambios (siempre con motivo)
create or replace function public.change_enrollment_status(p_enrollment uuid, p_status public.enrollment_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if not found then raise exception 'Matrícula inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(e.organization_id, 'enrollments.approve', e.campus_id) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Debe indicar un motivo' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.enrollments set status = p_status, status_reason = p_reason where id = p_enrollment;
  if p_status in ('withdrawn','cancelled') then
    update public.section_enrollments se set status = 'dropped', dropped_at = now()
     from public.sections s
     where se.enrollment_id = p_enrollment and se.status = 'enrolled'
       and s.id = se.section_id and s.grades_closed_at is null;
  end if;
end $$;

-- RLS -------------------------------------------------------------------
alter table public.applications         enable row level security;
alter table public.enrollments          enable row level security;
alter table public.section_enrollments  enable row level security;
alter table public.enrollment_documents enable row level security;

create policy app_read on public.applications for select to authenticated
  using (private.has_permission(organization_id, 'admissions.view', campus_id) or applicant_user_id = (select auth.uid()));
create policy app_ins on public.applications for insert to authenticated
  with check (status in ('draft','submitted') and decided_at is null
              and (private.has_permission(organization_id, 'admissions.create', campus_id)
                   or (applicant_user_id = (select auth.uid()) and private.current_user_active())));
-- El postulante solo edita borradores propios; la decisión va por decide_application
create policy app_upd on public.applications for update to authenticated
  using ((applicant_user_id = (select auth.uid()) and status = 'draft')
         or private.has_permission(organization_id, 'admissions.edit', campus_id))
  with check (status in ('draft','submitted','under_review','withdrawn')
              and ((applicant_user_id = (select auth.uid()) and decided_at is null)
                   or private.has_permission(organization_id, 'admissions.edit', campus_id)));

create policy enr_read on public.enrollments for select to authenticated
  using (private.has_permission(organization_id, 'enrollments.view', campus_id)
         or student_id in (select private.my_student_ids()));

create policy senr_read on public.section_enrollments for select to authenticated
  using (private.has_permission(organization_id, 'enrollments.view')
         or student_id in (select private.my_student_ids())
         or private.teaches_section(section_id));

create policy edoc_read on public.enrollment_documents for select to authenticated
  using (private.has_permission(organization_id, 'admissions.view')
         or private.has_permission(organization_id, 'enrollments.view')
         or uploaded_by = (select auth.uid()));
create policy edoc_ins on public.enrollment_documents for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and status = 'pending' and verified_by is null
              and (private.has_permission(organization_id, 'admissions.create')
                   or exists (select 1 from public.applications a where a.id = application_id and a.applicant_user_id = (select auth.uid()))));
create policy edoc_verify on public.enrollment_documents for update to authenticated
  using (private.has_permission(organization_id, 'admissions.approve'))
  with check (private.has_permission(organization_id, 'admissions.approve'));

-- Los profesores ven a los estudiantes inscritos en sus secciones
create policy students_read_teacher on public.students for select to authenticated
  using (exists (select 1 from public.section_enrollments se
                 where se.student_id = students.id and se.status <> 'dropped' and private.teaches_section(se.section_id)));
