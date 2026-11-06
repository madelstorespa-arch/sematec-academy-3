-- =====================================================================
-- Migración 008 · Libro de clases, asistencia, evaluaciones y actas
-- Sistemas 10, 13, 22, 23 · RF-021 a RF-024
-- =====================================================================

create table public.class_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  section_id      uuid not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  topic           text,
  content_covered text,                       -- avance curricular (RF-021)
  conference_session_id uuid,                 -- se enlaza en la migración de conferencias
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (section_id, starts_at),
  unique (organization_id, id),
  check (ends_at > starts_at),
  foreign key (organization_id, section_id) references public.sections(organization_id, id)
);

create table public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  class_session_id uuid not null,
  student_id       uuid not null,
  status           public.attendance_status not null,
  notes            text,
  recorded_by      uuid references public.profiles(id),
  recorded_at      timestamptz not null default now(),
  unique (class_session_id, student_id),
  foreign key (organization_id, class_session_id) references public.class_sessions(organization_id, id),
  foreign key (organization_id, student_id)       references public.students(organization_id, id)
);

create table public.class_materials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  section_id      uuid not null,
  title           text not null,
  storage_path    text,
  external_url    text check (external_url is null or external_url ~ '^https://'),
  published       boolean not null default false,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(storage_path, external_url) = 1),
  check (storage_path is null or split_part(storage_path, '/', 1) = organization_id::text),
  foreign key (organization_id, section_id) references public.sections(organization_id, id)
);

create table public.assessments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  section_id      uuid not null,
  name            text not null,
  weight_pct      numeric(5,2) not null check (weight_pct > 0 and weight_pct <= 100),
  due_on          date,
  rubric          jsonb,                       -- rúbrica (RF-023)
  published       boolean not null default false,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (section_id, name),
  unique (organization_id, id),
  foreign key (organization_id, section_id) references public.sections(organization_id, id)
);

create table public.grades (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  assessment_id   uuid not null,
  student_id      uuid not null,
  grade           numeric(6,2) not null,
  comments        text,
  graded_by       uuid references public.profiles(id),
  graded_at       timestamptz not null default now(),
  unique (assessment_id, student_id),
  unique (organization_id, id),
  foreign key (organization_id, assessment_id) references public.assessments(organization_id, id),
  foreign key (organization_id, student_id)    references public.students(organization_id, id)
);

-- Historial inmutable de cambios de notas
create table public.grade_history (
  id          bigint generated always as identity primary key,
  organization_id uuid not null,
  grade_id    uuid not null references public.grades(id) on delete restrict,
  old_grade   numeric(6,2),
  new_grade   numeric(6,2) not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  reason      text
);

create table public.academic_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  student_id      uuid not null,
  course_id       uuid not null,
  section_id      uuid not null,
  period_id       uuid not null,
  final_grade     numeric(6,2),
  attendance_pct  numeric(5,2),
  result          public.record_result not null default 'in_progress',
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (student_id, section_id),
  foreign key (organization_id, student_id) references public.students(organization_id, id),
  foreign key (organization_id, course_id)  references public.courses(organization_id, id),
  foreign key (organization_id, section_id) references public.sections(organization_id, id),
  foreign key (organization_id, period_id)  references public.academic_periods(organization_id, id)
);
create index on public.academic_records (student_id, course_id, result);

-- ---------------------------------------------------------------------
-- Reglas de integridad
-- ---------------------------------------------------------------------
create or replace function private.section_is_closed(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select grades_closed_at is not null from public.sections where id = p_section), false)
$$;

-- La suma de ponderaciones de una sección no puede superar 100 %
create or replace function private.check_assessment_weights()
returns trigger language plpgsql set search_path = '' as $$
declare v_total numeric;
begin
  perform 1 from public.sections where id = new.section_id for update;
  select coalesce(sum(weight_pct), 0) into v_total from public.assessments
   where section_id = new.section_id and id <> new.id;
  if v_total + new.weight_pct > 100 then
    raise exception 'Las ponderaciones suman % %% (máximo 100 %%)', v_total + new.weight_pct using errcode = '23514';
  end if;
  if private.section_is_closed(new.section_id) then
    raise exception 'Acta cerrada: no se pueden modificar evaluaciones' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_assessment_weights before insert or update on public.assessments
  for each row execute function private.check_assessment_weights();

-- Nota dentro de la escala, estudiante inscrito y acta abierta
create or replace function private.check_grade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_section uuid; gs public.grade_scales;
begin
  select a.section_id into v_section from public.assessments a where a.id = new.assessment_id;
  select g.* into gs from public.sections s join public.grade_scales g on g.id = s.grade_scale_id where s.id = v_section;
  if new.grade < gs.min_grade or new.grade > gs.max_grade then
    raise exception 'Nota % fuera de la escala [% - %]', new.grade, gs.min_grade, gs.max_grade using errcode = '23514';
  end if;
  if not exists (select 1 from public.section_enrollments se
                  where se.section_id = v_section and se.student_id = new.student_id and se.status <> 'dropped') then
    raise exception 'El estudiante no está inscrito en la sección' using errcode = '23503';
  end if;
  if private.section_is_closed(v_section) and coalesce(current_setting('sematec.grade_amendment', true), '') <> 'on' then
    raise exception 'Acta cerrada: use la rectificación autorizada' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.assessment_id <> old.assessment_id or new.student_id <> old.student_id) then
    raise exception 'No se puede reasignar una nota' using errcode = '42501';
  end if;
  new.graded_by := coalesce(auth.uid(), new.graded_by);
  new.graded_at := now();
  return new;
end $$;
create trigger trg_grade_check before insert or update on public.grades
  for each row execute function private.check_grade();

create or replace function private.log_grade_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.grade is distinct from old.grade then
    insert into public.grade_history (organization_id, grade_id, old_grade, new_grade, changed_by, reason)
    values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.grade end, new.grade, auth.uid(),
            nullif(current_setting('sematec.audit_reason', true), ''));
  end if;
  return null;
end $$;
create trigger trg_grade_history after insert or update on public.grades
  for each row execute function private.log_grade_history();
create trigger trg_grade_history_immutable before update or delete on public.grade_history
  for each row execute function private.block_audit_mutation();

-- Asistencia: estudiante inscrito y acta abierta
create or replace function private.check_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_section uuid;
begin
  select section_id into v_section from public.class_sessions where id = new.class_session_id;
  if not exists (select 1 from public.section_enrollments se
                  where se.section_id = v_section and se.student_id = new.student_id and se.status <> 'dropped') then
    raise exception 'El estudiante no está inscrito en la sección' using errcode = '23503';
  end if;
  if private.section_is_closed(v_section) then
    raise exception 'Acta cerrada: asistencia bloqueada' using errcode = '42501';
  end if;
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  new.recorded_at := now();
  return new;
end $$;
create trigger trg_attendance_check before insert or update on public.attendance_records
  for each row execute function private.check_attendance();

create trigger audit_class_sessions after insert or update or delete on public.class_sessions     for each row execute function private.audit_row();
create trigger audit_attendance     after insert or update or delete on public.attendance_records for each row execute function private.audit_row();
create trigger audit_assessments    after insert or update or delete on public.assessments        for each row execute function private.audit_row();
create trigger audit_grades         after insert or update or delete on public.grades             for each row execute function private.audit_row();
create trigger audit_academic_rec   after insert or update or delete on public.academic_records   for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Cálculos (RF-024)
-- ---------------------------------------------------------------------
-- Asistencia: presente y atraso cuentan como asistencia; justificadas se excluyen del total.
create or replace function public.attendance_pct(p_section uuid, p_student uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when count(*) filter (where ar.status <> 'excused') = 0 then null
         else round(100.0 * count(*) filter (where ar.status in ('present','late'))
                    / count(*) filter (where ar.status <> 'excused'), 2) end
  from public.class_sessions cs
  join public.attendance_records ar on ar.class_session_id = cs.id and ar.student_id = p_student
  where cs.section_id = p_section
$$;

-- Promedio ponderado, normalizado a las ponderaciones con nota registrada
create or replace function public.weighted_average(p_section uuid, p_student uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(sum(g.grade * a.weight_pct) / nullif(sum(a.weight_pct), 0),
               (select gs.decimals from public.sections s join public.grade_scales gs on gs.id = s.grade_scale_id where s.id = p_section))
  from public.assessments a
  join public.grades g on g.assessment_id = a.id and g.student_id = p_student
  where a.section_id = p_section
$$;

-- Cierre de acta: calcula nota final, asistencia y resultado; bloquea cambios
create or replace function public.close_section_grades(p_section uuid)
returns table (student_id uuid, final_grade numeric, attendance numeric, result public.record_result)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare sec public.sections; gs public.grade_scales; v_weights numeric; v_missing int;
begin
  select * into sec from public.sections where id = p_section for update;
  if not found then raise exception 'Sección inexistente' using errcode = 'P0002'; end if;
  if not (private.teaches_section(p_section) or private.has_permission(sec.organization_id, 'grades.approve', sec.campus_id)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if sec.grades_closed_at is not null then raise exception 'El acta ya está cerrada' using errcode = '22023'; end if;
  select * into gs from public.grade_scales where id = sec.grade_scale_id;
  select coalesce(sum(weight_pct), 0) into v_weights from public.assessments a where a.section_id = p_section;
  if v_weights <> 100 then
    raise exception 'Las ponderaciones suman % %%; deben sumar 100 %%', v_weights using errcode = '23514';
  end if;
  select count(*) into v_missing
    from public.section_enrollments se cross join public.assessments a
   where se.section_id = p_section and se.status = 'enrolled' and a.section_id = p_section
     and not exists (select 1 from public.grades g where g.assessment_id = a.id and g.student_id = se.student_id);
  if v_missing > 0 then
    raise exception 'Faltan % notas por registrar', v_missing using errcode = '23514';
  end if;

  update public.academic_records r
     set final_grade = public.weighted_average(p_section, r.student_id),
         attendance_pct = public.attendance_pct(p_section, r.student_id),
         closed_at = now()
   where r.section_id = p_section and r.result <> 'withdrawn';
  update public.academic_records r
     set result = case when r.final_grade >= gs.passing_grade
                        and coalesce(r.attendance_pct, 100) >= sec.min_attendance_pct
                       then 'approved' else 'failed' end::public.record_result
   where r.section_id = p_section and r.result <> 'withdrawn';
  update public.section_enrollments se set status = 'completed' where se.section_id = p_section and se.status = 'enrolled';
  update public.sections set grades_closed_at = now(), grades_closed_by = auth.uid() where id = p_section;

  return query select r.student_id, r.final_grade, r.attendance_pct, r.result
                 from public.academic_records r where r.section_id = p_section order by r.student_id;
end $$;

-- Rectificación de nota con acta cerrada: permiso de aprobación, MFA y motivo
create or replace function public.amend_grade(p_grade uuid, p_new_grade numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.grades; sec public.sections; gs public.grade_scales;
begin
  select * into g from public.grades where id = p_grade for update;
  if not found then raise exception 'Nota inexistente' using errcode = 'P0002'; end if;
  select s.* into sec from public.sections s join public.assessments a on a.section_id = s.id where a.id = g.assessment_id;
  if not private.has_permission(g.organization_id, 'grades.approve', sec.campus_id) or private.current_aal() <> 'aal2' then
    raise exception 'Rectificación no autorizada (requiere permiso de aprobación y MFA)' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'Debe indicar un motivo detallado' using errcode = '22023';
  end if;
  perform set_config('sematec.grade_amendment', 'on', true);
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.grades set grade = p_new_grade where id = p_grade;
  perform set_config('sematec.grade_amendment', 'off', true);
  if sec.grades_closed_at is not null then
    select * into gs from public.grade_scales where id = sec.grade_scale_id;
    update public.academic_records r
       set final_grade = public.weighted_average(sec.id, r.student_id),
           result = case when public.weighted_average(sec.id, r.student_id) >= gs.passing_grade
                          and coalesce(r.attendance_pct, 100) >= sec.min_attendance_pct
                         then 'approved' else 'failed' end::public.record_result
     where r.section_id = sec.id and r.student_id = g.student_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.class_sessions     enable row level security;
alter table public.attendance_records enable row level security;
alter table public.class_materials    enable row level security;
alter table public.assessments        enable row level security;
alter table public.grades             enable row level security;
alter table public.grade_history      enable row level security;
alter table public.academic_records   enable row level security;

create or replace function private.enrolled_in_section(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.section_enrollments se
                 where se.section_id = p_section and se.status <> 'dropped'
                   and se.student_id in (select private.my_student_ids()))
$$;

create policy cs_read on public.class_sessions for select to authenticated
  using (private.has_permission(organization_id, 'attendance.view') or private.teaches_section(section_id)
         or private.enrolled_in_section(section_id));
create policy cs_ins on public.class_sessions for insert to authenticated
  with check (private.teaches_section(section_id) or private.has_permission(organization_id, 'attendance.create'));
create policy cs_upd on public.class_sessions for update to authenticated
  using (private.teaches_section(section_id) or private.has_permission(organization_id, 'attendance.edit'))
  with check (private.teaches_section(section_id) or private.has_permission(organization_id, 'attendance.edit'));

create policy att_read on public.attendance_records for select to authenticated
  using (private.has_permission(organization_id, 'attendance.view')
         or student_id in (select private.my_student_ids())
         or exists (select 1 from public.class_sessions cs where cs.id = class_session_id and private.teaches_section(cs.section_id)));
create policy att_ins on public.attendance_records for insert to authenticated
  with check (private.has_permission(organization_id, 'attendance.create')
              or exists (select 1 from public.class_sessions cs where cs.id = class_session_id and private.teaches_section(cs.section_id)));
create policy att_upd on public.attendance_records for update to authenticated
  using (private.has_permission(organization_id, 'attendance.edit')
         or exists (select 1 from public.class_sessions cs where cs.id = class_session_id and private.teaches_section(cs.section_id)))
  with check (private.has_permission(organization_id, 'attendance.edit')
         or exists (select 1 from public.class_sessions cs where cs.id = class_session_id and private.teaches_section(cs.section_id)));

create policy mat_read on public.class_materials for select to authenticated
  using (private.teaches_section(section_id) or private.has_permission(organization_id, 'sections.view')
         or (published and private.enrolled_in_section(section_id)));
create policy mat_write on public.class_materials for insert to authenticated
  with check (private.teaches_section(section_id) or private.has_permission(organization_id, 'sections.edit'));
create policy mat_upd on public.class_materials for update to authenticated
  using (private.teaches_section(section_id) or private.has_permission(organization_id, 'sections.edit'))
  with check (private.teaches_section(section_id) or private.has_permission(organization_id, 'sections.edit'));

create policy asm_read on public.assessments for select to authenticated
  using (private.has_permission(organization_id, 'grades.view') or private.teaches_section(section_id)
         or (published and private.enrolled_in_section(section_id)));
create policy asm_ins on public.assessments for insert to authenticated
  with check (private.teaches_section(section_id) or private.has_permission(organization_id, 'grades.create'));
create policy asm_upd on public.assessments for update to authenticated
  using (private.teaches_section(section_id) or private.has_permission(organization_id, 'grades.edit'))
  with check (private.teaches_section(section_id) or private.has_permission(organization_id, 'grades.edit'));

create or replace function private.can_grade(p_assessment uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_org, 'grades.edit')
      or exists (select 1 from public.assessments a where a.id = p_assessment and private.teaches_section(a.section_id))
$$;

create policy grades_read on public.grades for select to authenticated
  using (private.has_permission(organization_id, 'grades.view')
         or private.can_grade(assessment_id, organization_id)
         or (student_id in (select private.my_student_ids())
             and exists (select 1 from public.assessments a where a.id = assessment_id and a.published)));
create policy grades_ins on public.grades for insert to authenticated
  with check (private.can_grade(assessment_id, organization_id));
create policy grades_upd on public.grades for update to authenticated
  using (private.can_grade(assessment_id, organization_id))
  with check (private.can_grade(assessment_id, organization_id));

create policy gh_read on public.grade_history for select to authenticated
  using (private.has_permission(organization_id, 'grades.view') or private.has_permission(organization_id, 'audit.view'));

create policy ar_read on public.academic_records for select to authenticated
  using (private.has_permission(organization_id, 'grades.view')
         or student_id in (select private.my_student_ids())
         or private.teaches_section(section_id));
