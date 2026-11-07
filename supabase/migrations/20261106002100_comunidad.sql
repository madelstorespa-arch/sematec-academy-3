-- =====================================================================
-- Comunidad: credencial estudiantil, encuestas y evaluación docente,
-- apoderados, egresados y bolsa de empleo
-- =====================================================================

insert into public.permissions (code, module, action, description)
select m.module || '.' || a.action, m.module, a.action, m.label || ' · ' || a.label
from (values ('surveys', 'Encuestas y evaluación docente'), ('alumni', 'Egresados y bolsa de empleo'), ('guardians', 'Apoderados')) as m(module, label)
cross join (values ('view','Ver'), ('create','Crear'), ('edit','Editar'), ('admin','Administrar')) as a(action, label)
on conflict (code) do nothing;

insert into public.roles (organization_id, code, name, is_system, requires_mfa)
select null, 'apoderado', 'Apoderado', true, false
where not exists (select 1 from public.roles where code = 'apoderado' and organization_id is null);

with grants(role_code, modules, actions) as (values
  ('propietario_institucional', array['surveys','alumni','guardians'], array['view','create','edit','admin']),
  ('director_general',   array['surveys','alumni','guardians'], array['view','create','edit']),
  ('director_academico', array['surveys','alumni','guardians'], array['view','create','edit']),
  ('coordinador',        array['surveys','alumni'], array['view','create','edit']),
  ('secretaria',         array['surveys','alumni','guardians'], array['view','create','edit']),
  ('admision',           array['alumni'], array['view']),
  ('auditor',            array['surveys','alumni','guardians'], array['view'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from grants g
join public.roles r on r.code = g.role_code and r.organization_id is null
join public.permissions p on p.module = any(g.modules) and p.action = any(g.actions)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Credencial estudiantil verificable
-- ---------------------------------------------------------------------
create table public.student_credentials (
  student_id      uuid primary key references public.students(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  code            text not null unique default upper(encode(extensions.gen_random_bytes(6), 'hex')),
  issued_at       timestamptz not null default now(),
  valid_until     date not null default (current_date + 365),
  revoked         boolean not null default false
);
alter table public.student_credentials enable row level security;
create policy cred_select on public.student_credentials for select to authenticated using (
  student_id in (select private.my_student_ids()) or private.has_permission(organization_id, 'students.view'));

-- El estudiante obtiene (o renueva) su credencial; el personal también puede emitirla
create or replace function public.issue_credential(p_student uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_code text;
begin
  select organization_id into v_org from public.students where id = p_student and status = 'active';
  if v_org is null then raise exception 'Estudiante inexistente o inactivo' using errcode = 'P0002'; end if;
  if not (p_student in (select private.my_student_ids()) or private.has_permission(v_org, 'students.edit')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  insert into public.student_credentials (student_id, organization_id) values (p_student, v_org)
  on conflict (student_id) do update set valid_until = greatest(public.student_credentials.valid_until, current_date + 365), revoked = false
  returning code into v_code;
  return v_code;
end $$;

-- Verificación pública (sin sesión): solo datos mínimos
create or replace function public.verify_credential(p_code text)
returns table (full_name text, student_code text, institution text, program text, valid boolean, valid_until date)
language sql stable security definer set search_path = '' as $$
  select s.first_names || ' ' || s.last_names, s.student_code, o.display_name,
         (select pr.name from public.enrollments e join public.programs pr on pr.id = e.program_id
           where e.student_id = s.id order by e.created_at desc limit 1),
         not c.revoked and c.valid_until >= current_date and s.status = 'active', c.valid_until
  from public.student_credentials c join public.students s on s.id = c.student_id join public.organizations o on o.id = c.organization_id
  where c.code = upper(trim(p_code))
$$;

-- ---------------------------------------------------------------------
-- Encuestas (anónimas o nominativas) y evaluación docente
-- ---------------------------------------------------------------------
create table public.surveys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid references public.sections(id),
  audience        text not null default 'students' check (audience in ('all','students','teachers','staff','section')),
  title           text not null check (length(title) between 3 and 200),
  description     text,
  anonymous       boolean not null default true,
  opens_at        timestamptz not null default now(),
  closes_at       timestamptz not null,
  published       boolean not null default false,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  check ((audience = 'section') = (section_id is not null)),
  check (closes_at > opens_at)
);
create table public.survey_questions (
  id              uuid primary key default gen_random_uuid(),
  survey_id       uuid not null references public.surveys(id) on delete cascade,
  position        int not null default 0,
  kind            text not null check (kind in ('escala','opcion','texto')),
  prompt          text not null check (length(prompt) between 2 and 1000),
  options         jsonb not null default '[]'::jsonb,
  required        boolean not null default true
);
-- Participación (quién respondió) separada de las respuestas: en encuestas anónimas no se pueden cruzar
create table public.survey_participation (
  survey_id       uuid not null references public.surveys(id) on delete cascade,
  user_id         uuid not null references public.profiles(id),
  responded_at    timestamptz not null default now(),
  primary key (survey_id, user_id)
);
create table public.survey_responses (
  id              uuid primary key default gen_random_uuid(),
  survey_id       uuid not null references public.surveys(id) on delete cascade,
  respondent_id   uuid references public.profiles(id),   -- null si la encuesta es anónima
  submitted_on    date not null default current_date      -- sin hora exacta, para no permitir cruces
);
create table public.survey_answers (
  response_id     uuid not null references public.survey_responses(id) on delete cascade,
  question_id     uuid not null references public.survey_questions(id) on delete cascade,
  value_num       int,
  value_text      text check (length(value_text) <= 4000),
  primary key (response_id, question_id)
);
create trigger audit_surveys after insert or update or delete on public.surveys for each row execute function private.audit_row();

create or replace function private.survey_eligible(s public.surveys)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(s.organization_id) and case s.audience
    when 'all' then true
    when 'students' then exists (select 1 from public.students x where x.user_id = auth.uid() and x.organization_id = s.organization_id)
    when 'teachers' then exists (select 1 from public.teachers x where x.user_id = auth.uid() and x.organization_id = s.organization_id)
    when 'staff' then private.is_staff(s.organization_id)
    when 'section' then private.enrolled_in_section(s.section_id)
  end
$$;

alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_participation enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers enable row level security;
create policy sv_select on public.surveys for select to authenticated using (
  private.has_permission(organization_id, 'surveys.view') or (published and private.survey_eligible(surveys))
  or (section_id is not null and private.teaches_section(section_id) and published));
create policy sv_write on public.surveys for all to authenticated
  using (private.has_permission(organization_id, 'surveys.edit')) with check (private.has_permission(organization_id, 'surveys.create'));
create policy svq_select on public.survey_questions for select to authenticated using (exists (select 1 from public.surveys s where s.id = survey_id));
create policy svq_write on public.survey_questions for all to authenticated
  using (exists (select 1 from public.surveys s where s.id = survey_id and private.has_permission(s.organization_id, 'surveys.edit')))
  with check (exists (select 1 from public.surveys s where s.id = survey_id and private.has_permission(s.organization_id, 'surveys.create')));
-- El personal ve QUIÉN respondió (para recordar a quien falta), nunca QUÉ respondió en encuestas anónimas
create policy svp_select on public.survey_participation for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.surveys s where s.id = survey_id and private.has_permission(s.organization_id, 'surveys.view')));

-- Encuestas abiertas que el usuario actual puede responder y aún no responde
create or replace function public.my_open_surveys(p_org uuid)
returns table (id uuid, title text, description text, closes_at timestamptz, anonymous boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.title, s.description, s.closes_at, s.anonymous from public.surveys s
  where s.organization_id = p_org and s.published and now() between s.opens_at and s.closes_at
    and private.survey_eligible(s)
    and not exists (select 1 from public.survey_participation p where p.survey_id = s.id and p.user_id = auth.uid())
  order by s.closes_at
$$;
revoke all on function public.my_open_surveys(uuid) from public, anon;
grant execute on function public.my_open_surveys(uuid) to authenticated;

-- Responder: valida elegibilidad, plazo, una sola vez y respuestas obligatorias
create or replace function public.answer_survey(p_survey uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.surveys; v_resp uuid; q record; v jsonb;
begin
  select * into s from public.surveys where id = p_survey and published;
  if not found or not private.survey_eligible(s) then raise exception 'Encuesta no disponible' using errcode = '42501'; end if;
  if now() < s.opens_at or now() > s.closes_at then raise exception 'La encuesta no está abierta' using errcode = 'P0001'; end if;
  insert into public.survey_participation (survey_id, user_id) values (p_survey, auth.uid())
  on conflict do nothing;
  if not found then raise exception 'Ya respondió esta encuesta' using errcode = 'P0001'; end if;
  insert into public.survey_responses (survey_id, respondent_id) values (p_survey, case when s.anonymous then null else auth.uid() end) returning id into v_resp;
  for q in select * from public.survey_questions where survey_id = p_survey loop
    v := p_answers -> q.id::text;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') then
      if q.required then raise exception 'Responda: %', left(q.prompt, 80) using errcode = '22023'; end if;
      continue;
    end if;
    if q.kind = 'escala' then
      if (v #>> '{}') !~ '^[1-5]$' then raise exception 'Valor fuera de escala' using errcode = '22023'; end if;
      insert into public.survey_answers (response_id, question_id, value_num) values (v_resp, q.id, (v #>> '{}')::int);
    elsif q.kind = 'opcion' then
      if (v #>> '{}') !~ '^\d+$' or (v #>> '{}')::int >= jsonb_array_length(q.options) then raise exception 'Opción inválida' using errcode = '22023'; end if;
      insert into public.survey_answers (response_id, question_id, value_num) values (v_resp, q.id, (v #>> '{}')::int);
    else
      insert into public.survey_answers (response_id, question_id, value_text) values (v_resp, q.id, left(v #>> '{}', 4000));
    end if;
  end loop;
end $$;

-- Resultados agregados: gestores de encuestas y el profesor evaluado (solo de su sección)
create or replace function public.survey_results(p_survey uuid)
returns table (question_id uuid, kind text, prompt text, options jsonb, responses bigint, average numeric, counts jsonb, texts text[])
language plpgsql stable security definer set search_path = '' as $$
declare s public.surveys;
begin
  select * into s from public.surveys where id = p_survey;
  if not found or not (private.has_permission(s.organization_id, 'surveys.view') or (s.section_id is not null and private.teaches_section(s.section_id))) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
  select q.id, q.kind, q.prompt, q.options, count(a.response_id),
         round(avg(a.value_num) filter (where q.kind = 'escala'), 2),
         coalesce((select jsonb_object_agg(x.v, x.n) from (select a2.value_num::text v, count(*) n from public.survey_answers a2 where a2.question_id = q.id and a2.value_num is not null group by a2.value_num) x), '{}'::jsonb),
         array_remove(array_agg(a.value_text order by random()), null)
  from public.survey_questions q left join public.survey_answers a on a.question_id = q.id
  where q.survey_id = p_survey group by q.id order by min(q.position), q.id;
end $$;

-- ---------------------------------------------------------------------
-- Apoderados
-- ---------------------------------------------------------------------
create table public.guardian_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  student_id      uuid not null references public.students(id) on delete cascade,
  guardian_id     uuid not null references public.profiles(id),
  relationship    text not null default 'apoderado' check (relationship in ('madre','padre','tutor','apoderado','otro')),
  status          text not null default 'activo' check (status in ('activo','revocado')),
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (student_id, guardian_id)
);
create trigger audit_guardians after insert or update or delete on public.guardian_links for each row execute function private.audit_row();
alter table public.guardian_links enable row level security;
create policy gl_select on public.guardian_links for select to authenticated using (guardian_id = auth.uid() or private.has_permission(organization_id, 'guardians.view'));
create policy gl_write on public.guardian_links for all to authenticated
  using (private.has_permission(organization_id, 'guardians.edit')) with check (private.has_permission(organization_id, 'guardians.create'));

-- Los apoderados no son personal de la institución
create or replace function private.is_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_user_active() and exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id
    where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
      and (m.valid_until is null or m.valid_until > now())
      and r.code not in ('estudiante','postulante','egresado','profesor','apoderado'))
$$;

-- Vincula una cuenta como apoderado de un estudiante y le da el rol «apoderado»
create or replace function public.link_guardian(p_student uuid, p_user uuid, p_relationship text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_campus uuid; v_role uuid;
begin
  select organization_id, campus_id into v_org, v_campus from public.students where id = p_student;
  if v_org is null or not private.has_permission(v_org, 'guardians.create', v_campus) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if exists (select 1 from public.students where id = p_student and user_id = p_user) then
    raise exception 'El apoderado no puede ser el mismo estudiante' using errcode = '22023';
  end if;
  insert into public.guardian_links (organization_id, student_id, guardian_id, relationship)
  values (v_org, p_student, p_user, coalesce(nullif(p_relationship, ''), 'apoderado'))
  on conflict (student_id, guardian_id) do update set status = 'activo', relationship = excluded.relationship;
  select id into v_role from public.roles where organization_id is null and code = 'apoderado';
  insert into public.memberships (user_id, organization_id, role_id, granted_by)
  values (p_user, v_org, v_role, auth.uid())
  on conflict (user_id, organization_id, role_id, campus_id) do update set status = 'active', revoked_at = null;
end $$;
revoke all on function public.link_guardian(uuid, uuid, text) from public, anon;
grant execute on function public.link_guardian(uuid, uuid, text) to authenticated;

create or replace function private.is_guardian_of(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardian_links g where g.student_id = p_student and g.guardian_id = auth.uid() and g.status = 'activo')
$$;

-- Resumen para el apoderado: notas publicadas, asistencia y estado de cuenta del pupilo
create or replace function public.guardian_summary(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.is_guardian_of(p_student) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'student', (select jsonb_build_object('name', first_names || ' ' || last_names, 'code', student_code) from public.students where id = p_student),
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
        'course', c.name, 'section', sc.code,
        'grades', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'weight', a.weight_pct, 'grade', g.grade) order by a.created_at)
                    from public.assessments a left join public.grades g on g.assessment_id = a.id and g.student_id = p_student
                    where a.section_id = sc.id and a.published), '[]'::jsonb),
        'attendance', (select round(100.0 * count(*) filter (where ar.status in ('present','late')) / nullif(count(*), 0), 1)
                    from public.attendance_records ar join public.class_sessions cs on cs.id = ar.class_session_id
                    where cs.section_id = sc.id and ar.student_id = p_student and ar.status <> 'excused')))
      from public.section_enrollments se join public.sections sc on sc.id = se.section_id join public.courses c on c.id = sc.course_id
      where se.student_id = p_student and se.status <> 'dropped'), '[]'::jsonb),
    'balance', (select coalesce(sum(b.outstanding), 0) from public.installment_balances b
                where b.student_id = p_student and not b.cancelled and b.outstanding > 0),
    'overdue', (select count(*) from public.installment_balances b
                where b.student_id = p_student and not b.cancelled and b.outstanding > 0 and b.days_overdue > 0),
    'next_due', (select min(b.due_on) from public.installment_balances b
                where b.student_id = p_student and not b.cancelled and b.outstanding > 0)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Egresados y bolsa de empleo
-- ---------------------------------------------------------------------
create table public.alumni_profiles (
  student_id      uuid primary key references public.students(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  graduation_year int check (graduation_year between 1950 and 2100),
  program_name    text,
  employment      text not null default 'sin_info' check (employment in ('empleado','independiente','estudiando','buscando','sin_info')),
  employer        text,
  job_title       text,
  linkedin_url    text check (linkedin_url is null or linkedin_url ~* '^https://'),
  consent_contact boolean not null default false,
  updated_at      timestamptz not null default now()
);
create table public.job_postings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind            text not null default 'empleo' check (kind in ('empleo','practica')),
  title           text not null check (length(title) between 3 and 200),
  company         text not null,
  location        text,
  modality        text not null default 'presencial' check (modality in ('presencial','remoto','hibrido')),
  description     text not null,
  apply_url       text check (apply_url is null or apply_url ~* '^https://'),
  apply_email     text check (apply_email is null or apply_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  closes_on       date,
  published       boolean not null default true,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(apply_url, apply_email) >= 1)
);
create trigger trg_alumni_updated before update on public.alumni_profiles for each row execute function private.set_updated_at();
create trigger audit_jobs after insert or update or delete on public.job_postings for each row execute function private.audit_row();
alter table public.alumni_profiles enable row level security;
alter table public.job_postings enable row level security;
create policy al_select on public.alumni_profiles for select to authenticated using (
  student_id in (select private.my_student_ids()) or private.has_permission(organization_id, 'alumni.view'));
create policy al_insert on public.alumni_profiles for insert to authenticated with check (
  student_id in (select private.my_student_ids()) or private.has_permission(organization_id, 'alumni.create'));
create policy al_update on public.alumni_profiles for update to authenticated
  using (student_id in (select private.my_student_ids()) or private.has_permission(organization_id, 'alumni.edit'))
  with check (student_id in (select private.my_student_ids()) or private.has_permission(organization_id, 'alumni.edit'));
create policy jp_select on public.job_postings for select to authenticated using (
  private.has_permission(organization_id, 'alumni.view')
  or (published and (closes_on is null or closes_on >= current_date) and private.is_member(organization_id)));
create policy jp_write on public.job_postings for all to authenticated
  using (private.has_permission(organization_id, 'alumni.edit')) with check (private.has_permission(organization_id, 'alumni.create'));

-- Privilegios
grant select on public.student_credentials to authenticated;
grant select, insert, update, delete on public.surveys, public.survey_questions to authenticated;
grant select on public.survey_participation to authenticated;
grant select, insert, update on public.guardian_links to authenticated;
grant select, insert, update on public.alumni_profiles, public.job_postings to authenticated;
grant delete on public.job_postings to authenticated;
grant all on public.student_credentials, public.surveys, public.survey_questions, public.survey_participation, public.survey_responses,
  public.survey_answers, public.guardian_links, public.alumni_profiles, public.job_postings to service_role;
grant execute on function public.issue_credential(uuid), public.answer_survey(uuid, jsonb), public.survey_results(uuid), public.guardian_summary(uuid) to authenticated;
grant execute on function public.verify_credential(text) to anon, authenticated;
grant execute on function private.survey_eligible(public.surveys), private.is_guardian_of(uuid) to authenticated;
revoke all on function public.issue_credential(uuid), public.answer_survey(uuid, jsonb), public.survey_results(uuid), public.guardian_summary(uuid) from public, anon;
grant execute on function public.issue_credential(uuid), public.answer_survey(uuid, jsonb), public.survey_results(uuid), public.guardian_summary(uuid) to authenticated;
