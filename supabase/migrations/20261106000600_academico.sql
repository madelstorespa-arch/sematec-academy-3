-- =====================================================================
-- Migración 006 · Gestión curricular y operación académica
-- Sistemas 09, 10 · RF-017 a RF-020 · INT-007
-- =====================================================================

create type public.timerange as range (subtype = time);

-- Escalas de calificación regionales (INT-007)
create table public.grade_scales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name            text not null,
  min_grade       numeric(6,2) not null,
  max_grade       numeric(6,2) not null,
  passing_grade   numeric(6,2) not null,
  decimals        smallint not null default 1 check (decimals between 0 and 2),
  created_at      timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id),
  check (min_grade < max_grade and passing_grade between min_grade and max_grade)
);

create table public.programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  department_id   uuid references public.departments(id),
  code            text not null,
  name            text not null,
  level           text not null check (level in ('course','technical','undergraduate','postgraduate','diploma','continuing')),
  modality        text not null default 'in_person' check (modality in ('in_person','online','hybrid')),
  duration_terms  smallint not null check (duration_terms between 1 and 20),
  grade_scale_id  uuid not null,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, grade_scale_id) references public.grade_scales(organization_id, id)
);

-- Mallas curriculares versionadas
create table public.curricula (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  program_id      uuid not null,
  version         text not null,
  valid_from      date not null,
  total_credits   numeric(6,1) not null default 0 check (total_credits >= 0),
  min_attendance_pct numeric(5,2) not null default 75 check (min_attendance_pct between 0 and 100),
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  unique (program_id, version),
  unique (organization_id, id),
  foreign key (organization_id, program_id) references public.programs(organization_id, id)
);

create table public.courses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code            text not null,
  name            text not null,
  credits         numeric(5,1) not null check (credits >= 0),
  weekly_hours    numeric(5,1) not null check (weekly_hours >= 0),
  description     text,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.curriculum_courses (
  curriculum_id   uuid not null references public.curricula(id) on delete restrict,
  course_id       uuid not null references public.courses(id) on delete restrict,
  term_number     smallint not null check (term_number between 1 and 20),
  is_mandatory    boolean not null default true,
  primary key (curriculum_id, course_id)
);

create table public.course_prerequisites (
  course_id       uuid not null references public.courses(id) on delete restrict,
  prerequisite_id uuid not null references public.courses(id) on delete restrict,
  primary key (course_id, prerequisite_id),
  check (course_id <> prerequisite_id)
);

create table public.academic_periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code            text not null,
  name            text not null,
  starts_on       date not null,
  ends_on         date not null,
  enrollment_opens_on  date,
  enrollment_closes_on date,
  status          public.period_status not null default 'planned',
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  check (ends_on > starts_on),
  check (enrollment_closes_on is null or enrollment_opens_on is null or enrollment_closes_on >= enrollment_opens_on)
);

create table public.sections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campus_id       uuid not null,
  course_id       uuid not null,
  period_id       uuid not null,
  code            text not null,
  teacher_id      uuid,
  grade_scale_id  uuid not null,
  capacity        integer not null check (capacity between 1 and 1000),
  min_attendance_pct numeric(5,2) not null default 75 check (min_attendance_pct between 0 and 100),
  modality        text not null default 'in_person' check (modality in ('in_person','online','hybrid')),
  status          public.record_status not null default 'active',
  grades_closed_at timestamptz,          -- acta cerrada: notas bloqueadas
  grades_closed_by uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (period_id, course_id, campus_id, code),
  unique (organization_id, id),
  foreign key (organization_id, campus_id)      references public.campuses(organization_id, id),
  foreign key (organization_id, course_id)      references public.courses(organization_id, id),
  foreign key (organization_id, period_id)      references public.academic_periods(organization_id, id),
  foreign key (organization_id, teacher_id)     references public.teachers(organization_id, id),
  foreign key (organization_id, grade_scale_id) references public.grade_scales(organization_id, id)
);

-- Horarios con control de conflictos de sala y profesor (RF-020)
create table public.section_schedules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  section_id      uuid not null,
  period_id       uuid not null,
  weekday         smallint not null check (weekday between 1 and 7),   -- ISO: 1 = lunes
  time_slot       public.timerange not null check (not isempty(time_slot)),
  room_id         uuid,
  teacher_id      uuid,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, section_id) references public.sections(organization_id, id) on delete cascade,
  foreign key (organization_id, room_id)    references public.rooms(organization_id, id),
  foreign key (organization_id, teacher_id) references public.teachers(organization_id, id),
  constraint no_room_overlap exclude using gist
    (room_id with =, period_id with =, weekday with =, time_slot with &&) where (room_id is not null),
  constraint no_teacher_overlap exclude using gist
    (teacher_id with =, period_id with =, weekday with =, time_slot with &&) where (teacher_id is not null)
);

-- El periodo y el profesor del horario se derivan de la sección
create or replace function private.fill_schedule_from_section()
returns trigger language plpgsql set search_path = '' as $$
begin
  select s.period_id, coalesce(new.teacher_id, s.teacher_id)
    into new.period_id, new.teacher_id
    from public.sections s where s.id = new.section_id;
  return new;
end $$;
create trigger trg_schedule_fill before insert or update on public.section_schedules
  for each row execute function private.fill_schedule_from_section();

create trigger trg_programs_updated before update on public.programs for each row execute function private.set_updated_at();
create trigger trg_courses_updated  before update on public.courses  for each row execute function private.set_updated_at();
create trigger trg_sections_updated before update on public.sections for each row execute function private.set_updated_at();

create trigger audit_grade_scales after insert or update or delete on public.grade_scales for each row execute function private.audit_row();
create trigger audit_programs  after insert or update or delete on public.programs  for each row execute function private.audit_row();
create trigger audit_curricula after insert or update or delete on public.curricula for each row execute function private.audit_row();
create trigger audit_courses   after insert or update or delete on public.courses   for each row execute function private.audit_row();
create trigger audit_periods   after insert or update or delete on public.academic_periods for each row execute function private.audit_row();
create trigger audit_sections  after insert or update or delete on public.sections  for each row execute function private.audit_row();
create trigger audit_schedules after insert or update or delete on public.section_schedules for each row execute function private.audit_row();

-- ¿El usuario actual es profesor de la sección?
create or replace function private.teaches_section(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sections s
    where s.id = p_section and s.teacher_id in (select private.my_teacher_ids())
  ) or exists (
    select 1 from public.section_schedules sc
    where sc.section_id = p_section and sc.teacher_id in (select private.my_teacher_ids())
  )
$$;

-- RLS -------------------------------------------------------------------
alter table public.grade_scales         enable row level security;
alter table public.programs             enable row level security;
alter table public.curricula            enable row level security;
alter table public.courses              enable row level security;
alter table public.curriculum_courses   enable row level security;
alter table public.course_prerequisites enable row level security;
alter table public.academic_periods     enable row level security;
alter table public.sections             enable row level security;
alter table public.section_schedules    enable row level security;

-- La oferta académica es visible para miembros de la institución
create policy gs_read   on public.grade_scales for select to authenticated using (private.is_member(organization_id));
create policy gs_write  on public.grade_scales for insert to authenticated with check (private.has_permission(organization_id, 'academic.admin'));
create policy prog_read on public.programs for select to authenticated using (private.is_member(organization_id));
create policy prog_ins  on public.programs for insert to authenticated with check (private.has_permission(organization_id, 'academic.create'));
create policy prog_upd  on public.programs for update to authenticated
  using (private.has_permission(organization_id, 'academic.edit')) with check (private.has_permission(organization_id, 'academic.edit'));
create policy curr_read on public.curricula for select to authenticated using (private.is_member(organization_id));
create policy curr_ins  on public.curricula for insert to authenticated with check (private.has_permission(organization_id, 'academic.create'));
create policy curr_upd  on public.curricula for update to authenticated
  using (private.has_permission(organization_id, 'academic.edit')) with check (private.has_permission(organization_id, 'academic.edit'));
create policy course_read on public.courses for select to authenticated using (private.is_member(organization_id));
create policy course_ins  on public.courses for insert to authenticated with check (private.has_permission(organization_id, 'academic.create'));
create policy course_upd  on public.courses for update to authenticated
  using (private.has_permission(organization_id, 'academic.edit')) with check (private.has_permission(organization_id, 'academic.edit'));

create policy cc_read on public.curriculum_courses for select to authenticated
  using (exists (select 1 from public.curricula c where c.id = curriculum_id and private.is_member(c.organization_id)));
create policy cc_write on public.curriculum_courses for insert to authenticated
  with check (exists (select 1 from public.curricula c join public.courses co on co.id = course_id
                      where c.id = curriculum_id and co.organization_id = c.organization_id
                        and private.has_permission(c.organization_id, 'academic.edit')));
create policy cc_delete on public.curriculum_courses for delete to authenticated
  using (exists (select 1 from public.curricula c where c.id = curriculum_id and private.has_permission(c.organization_id, 'academic.admin')));

create policy pre_read on public.course_prerequisites for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and private.is_member(c.organization_id)));
create policy pre_write on public.course_prerequisites for insert to authenticated
  with check (exists (select 1 from public.courses c join public.courses p on p.id = prerequisite_id
                      where c.id = course_id and p.organization_id = c.organization_id
                        and private.has_permission(c.organization_id, 'academic.edit')));
create policy pre_delete on public.course_prerequisites for delete to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and private.has_permission(c.organization_id, 'academic.admin')));

create policy period_read on public.academic_periods for select to authenticated using (private.is_member(organization_id));
create policy period_ins  on public.academic_periods for insert to authenticated with check (private.has_permission(organization_id, 'academic.create'));
create policy period_upd  on public.academic_periods for update to authenticated
  using (private.has_permission(organization_id, 'academic.edit')) with check (private.has_permission(organization_id, 'academic.edit'));

create policy sec_read on public.sections for select to authenticated using (private.is_member(organization_id));
create policy sec_ins  on public.sections for insert to authenticated with check (private.has_permission(organization_id, 'sections.create', campus_id));
create policy sec_upd  on public.sections for update to authenticated
  using (private.has_permission(organization_id, 'sections.edit', campus_id))
  with check (private.has_permission(organization_id, 'sections.edit', campus_id));

create policy sch_read on public.section_schedules for select to authenticated using (private.is_member(organization_id));
create policy sch_ins  on public.section_schedules for insert to authenticated with check (private.has_permission(organization_id, 'sections.create'));
create policy sch_upd  on public.section_schedules for update to authenticated
  using (private.has_permission(organization_id, 'sections.edit')) with check (private.has_permission(organization_id, 'sections.edit'));
create policy sch_del  on public.section_schedules for delete to authenticated using (private.has_permission(organization_id, 'sections.edit'));
