-- =====================================================================
-- Aula de aprendizaje: contenidos, tareas y entregas, exámenes en línea, foros
-- =====================================================================

-- Acceso a una sección: profesor, estudiante inscrito o personal autorizado
create or replace function private.section_member(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.teaches_section(p_section) or private.enrolled_in_section(p_section)
      or exists (select 1 from public.sections s where s.id = p_section and private.has_permission(s.organization_id, 'sections.view', s.campus_id))
$$;
-- Gestión del aula: profesor de la sección o personal con edición académica
create or replace function private.section_manager(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.teaches_section(p_section)
      or exists (select 1 from public.sections s where s.id = p_section and private.has_permission(s.organization_id, 'sections.edit', s.campus_id))
$$;
create or replace function private.my_student_in_section(p_section uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select se.student_id from public.section_enrollments se
  where se.section_id = p_section and se.status <> 'dropped' and se.student_id in (select private.my_student_ids()) limit 1
$$;
grant execute on function private.section_member(uuid), private.section_manager(uuid), private.my_student_in_section(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Archivos del aula (PDF, Office, imágenes, ZIP; máx. 4 MB)
-- ---------------------------------------------------------------------
create table public.lms_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid not null references public.sections(id),
  owner_id        uuid not null default auth.uid() references public.profiles(id),
  purpose         text not null check (purpose in ('content','submission')),
  filename        text not null check (length(filename) between 1 and 200),
  mime_type       text not null,
  size_bytes      int not null check (size_bytes between 1 and 4194304),
  sha256          text not null,
  bytes           bytea not null,
  created_at      timestamptz not null default now()
);
alter table public.lms_files enable row level security;
-- Archivos de contenido: miembros de la sección. Entregas: su autor y quienes gestionan la sección.
create policy lmsf_select on public.lms_files for select to authenticated using (
  owner_id = auth.uid() or private.section_manager(section_id)
  or (purpose = 'content' and private.section_member(section_id)));
create policy lmsf_insert on public.lms_files for insert to authenticated with check (
  owner_id = auth.uid() and (
    (purpose = 'content' and private.section_manager(section_id))
    or (purpose = 'submission' and private.enrolled_in_section(section_id))));

-- ---------------------------------------------------------------------
-- Contenidos: unidades y recursos
-- ---------------------------------------------------------------------
create table public.course_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid not null references public.sections(id),
  title           text not null check (length(title) between 1 and 200),
  description     text,
  position        int not null default 0,
  published       boolean not null default true,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now()
);
create table public.course_contents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid not null references public.sections(id),
  unit_id         uuid references public.course_units(id) on delete cascade,
  kind            text not null check (kind in ('texto','video','enlace','archivo')),
  title           text not null check (length(title) between 1 and 200),
  body            text,
  url             text check (url is null or url ~* '^https://'),
  file_id         uuid references public.lms_files(id),
  position        int not null default 0,
  published       boolean not null default true,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  check ((kind = 'archivo') = (file_id is not null)),
  check (kind not in ('video','enlace') or url is not null)
);
create index on public.course_contents (section_id, unit_id, position);
alter table public.course_units enable row level security;
alter table public.course_contents enable row level security;
create policy cu_select on public.course_units for select to authenticated
  using (private.section_manager(section_id) or (published and private.section_member(section_id)));
create policy cu_write on public.course_units for all to authenticated
  using (private.section_manager(section_id)) with check (private.section_manager(section_id));
create policy cc_select on public.course_contents for select to authenticated
  using (private.section_manager(section_id) or (published and private.section_member(section_id)));
create policy cc_write on public.course_contents for all to authenticated
  using (private.section_manager(section_id)) with check (private.section_manager(section_id));

-- ---------------------------------------------------------------------
-- Tareas y entregas
-- ---------------------------------------------------------------------
create table public.assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid not null references public.sections(id),
  title           text not null check (length(title) between 1 and 200),
  instructions    text,
  due_at          timestamptz not null,
  max_score       numeric(6,2) not null default 100 check (max_score > 0),
  allow_late      boolean not null default true,
  assessment_id   uuid references public.assessments(id),
  published       boolean not null default true,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now()
);
create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  assignment_id   uuid not null references public.assignments(id) on delete cascade,
  student_id      uuid not null references public.students(id),
  body            text,
  url             text check (url is null or url ~* '^https://'),
  file_id         uuid references public.lms_files(id),
  submitted_at    timestamptz not null default now(),
  late            boolean not null default false,
  score           numeric(6,2),
  feedback        text,
  graded_by       uuid references public.profiles(id),
  graded_at       timestamptz,
  unique (assignment_id, student_id),
  check (num_nonnulls(body, url, file_id) >= 1)
);
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
create policy asg_select on public.assignments for select to authenticated
  using (private.section_manager(section_id) or (published and private.section_member(section_id)));
create policy asg_write on public.assignments for all to authenticated
  using (private.section_manager(section_id)) with check (private.section_manager(section_id)
    and (assessment_id is null or exists (select 1 from public.assessments a where a.id = assessment_id and a.section_id = assignments.section_id)));
create policy sub_select on public.submissions for select to authenticated using (
  student_id in (select private.my_student_ids())
  or exists (select 1 from public.assignments a where a.id = assignment_id and private.section_manager(a.section_id)));

-- Entrega del estudiante (crea o reemplaza mientras no esté calificada)
create or replace function public.submit_assignment(p_assignment uuid, p_body text, p_url text, p_file uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.assignments; v_student uuid; v_id uuid; v_late boolean;
begin
  select * into a from public.assignments where id = p_assignment and published;
  if not found then raise exception 'Tarea inexistente' using errcode = 'P0002'; end if;
  v_student := private.my_student_in_section(a.section_id);
  if v_student is null then raise exception 'No está inscrito en esta sección' using errcode = '42501'; end if;
  v_late := now() > a.due_at;
  if v_late and not a.allow_late then raise exception 'El plazo de entrega terminó' using errcode = 'P0001'; end if;
  if p_url is not null and p_url !~* '^https://' then raise exception 'El enlace debe comenzar con https://' using errcode = '22023'; end if;
  if p_file is not null and not exists (select 1 from public.lms_files f where f.id = p_file and f.owner_id = auth.uid() and f.purpose = 'submission' and f.section_id = a.section_id) then
    raise exception 'Archivo inválido' using errcode = '42501';
  end if;
  if exists (select 1 from public.submissions s where s.assignment_id = p_assignment and s.student_id = v_student and s.score is not null) then
    raise exception 'La entrega ya fue calificada y no puede modificarse' using errcode = 'P0001';
  end if;
  insert into public.submissions (organization_id, assignment_id, student_id, body, url, file_id, late)
  values (a.organization_id, p_assignment, v_student, nullif(trim(p_body), ''), p_url, p_file, v_late)
  on conflict (assignment_id, student_id) do update
    set body = excluded.body, url = excluded.url, file_id = excluded.file_id, late = excluded.late, submitted_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Publica en el libro de notas oficial (si la actividad está vinculada a una evaluación)
create or replace function private.post_grade(p_assessment uuid, p_student uuid, p_ratio numeric, p_comment text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_min numeric; v_max numeric; v_dec int; v_org uuid; v_grade numeric;
begin
  if p_assessment is null then return null; end if;
  select g.min_grade, g.max_grade, g.decimals, a.organization_id into v_min, v_max, v_dec, v_org
  from public.assessments a join public.sections s on s.id = a.section_id join public.grade_scales g on g.id = s.grade_scale_id
  where a.id = p_assessment;
  v_grade := round(v_min + (v_max - v_min) * greatest(0, least(1, p_ratio)), v_dec);
  insert into public.grades (organization_id, assessment_id, student_id, grade, comments)
  values (v_org, p_assessment, p_student, v_grade, left(p_comment, 500))
  on conflict (assessment_id, student_id) do update set grade = excluded.grade, comments = excluded.comments;
  return v_grade;
end $$;

create or replace function public.grade_submission(p_submission uuid, p_score numeric, p_feedback text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare s public.submissions; a public.assignments;
begin
  select * into s from public.submissions where id = p_submission for update;
  if not found then raise exception 'Entrega inexistente' using errcode = 'P0002'; end if;
  select * into a from public.assignments where id = s.assignment_id;
  if not private.section_manager(a.section_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_score is null or p_score < 0 or p_score > a.max_score then
    raise exception 'El puntaje debe estar entre 0 y %', a.max_score using errcode = '22023';
  end if;
  update public.submissions set score = p_score, feedback = nullif(trim(p_feedback), ''), graded_by = auth.uid(), graded_at = now() where id = s.id;
  insert into public.notifications (organization_id, user_id, category, title, body, data)
  select a.organization_id, st.user_id, 'grade', 'Tarea calificada: ' || left(a.title, 120), 'Puntaje ' || p_score || ' de ' || a.max_score, jsonb_build_object('assignment_id', a.id)
  from public.students st where st.id = s.student_id and st.user_id is not null;
  return private.post_grade(a.assessment_id, s.student_id, p_score / a.max_score, coalesce(p_feedback, 'Tarea: ' || a.title));
end $$;

-- ---------------------------------------------------------------------
-- Exámenes en línea
-- ---------------------------------------------------------------------
create table public.quizzes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid not null references public.sections(id),
  title           text not null check (length(title) between 1 and 200),
  instructions    text,
  opens_at        timestamptz not null default now(),
  closes_at       timestamptz not null,
  time_limit_min  int check (time_limit_min between 1 and 600),
  max_attempts    int not null default 1 check (max_attempts between 1 and 10),
  show_results    boolean not null default true,
  assessment_id   uuid references public.assessments(id),
  published       boolean not null default false,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (closes_at > opens_at)
);
create table public.quiz_questions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  position        int not null default 0,
  kind            text not null check (kind in ('unica','multiple','vf')),
  prompt          text not null check (length(prompt) between 1 and 4000),
  options         jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  points          numeric(6,2) not null default 1 check (points > 0)
);
-- Las respuestas correctas viven aparte: los estudiantes nunca pueden leerlas
create table public.quiz_answer_keys (
  question_id     uuid primary key references public.quiz_questions(id) on delete cascade,
  correct         int[] not null check (cardinality(correct) >= 1)
);
create table public.quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  student_id      uuid not null references public.students(id),
  started_at      timestamptz not null default now(),
  deadline        timestamptz not null,
  submitted_at    timestamptz,
  answers         jsonb,
  score           numeric(7,2),
  max_score       numeric(7,2),
  grade           numeric(6,2)
);
create index on public.quiz_attempts (quiz_id, student_id);
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_answer_keys enable row level security;
alter table public.quiz_attempts enable row level security;
create policy qz_select on public.quizzes for select to authenticated
  using (private.section_manager(section_id) or (published and private.section_member(section_id)));
create policy qz_write on public.quizzes for all to authenticated
  using (private.section_manager(section_id)) with check (private.section_manager(section_id)
    and (assessment_id is null or exists (select 1 from public.assessments a where a.id = assessment_id and a.section_id = quizzes.section_id)));
-- Preguntas: el gestor siempre; el estudiante solo durante un intento abierto
create policy qq_select on public.quiz_questions for select to authenticated using (
  exists (select 1 from public.quizzes q where q.id = quiz_id and (private.section_manager(q.section_id)
    or exists (select 1 from public.quiz_attempts t where t.quiz_id = q.id and t.submitted_at is null and t.deadline > now()
               and t.student_id in (select private.my_student_ids())))));
create policy qq_write on public.quiz_questions for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and private.section_manager(q.section_id)))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.organization_id = quiz_questions.organization_id and private.section_manager(q.section_id)));
create policy qk_all on public.quiz_answer_keys for all to authenticated
  using (exists (select 1 from public.quiz_questions x join public.quizzes q on q.id = x.quiz_id where x.id = question_id and private.section_manager(q.section_id)))
  with check (exists (select 1 from public.quiz_questions x join public.quizzes q on q.id = x.quiz_id where x.id = question_id and private.section_manager(q.section_id)));
create policy qa_select on public.quiz_attempts for select to authenticated using (
  student_id in (select private.my_student_ids())
  or exists (select 1 from public.quizzes q where q.id = quiz_id and private.section_manager(q.section_id)));

create or replace function public.start_quiz(p_quiz uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.quizzes; v_student uuid; v_id uuid; v_used int;
begin
  select * into q from public.quizzes where id = p_quiz and published;
  if not found then raise exception 'Examen inexistente' using errcode = 'P0002'; end if;
  v_student := private.my_student_in_section(q.section_id);
  if v_student is null then raise exception 'No está inscrito en esta sección' using errcode = '42501'; end if;
  -- Continúa un intento abierto
  select id into v_id from public.quiz_attempts where quiz_id = p_quiz and student_id = v_student and submitted_at is null and deadline > now();
  if v_id is not null then return v_id; end if;
  if now() < q.opens_at then raise exception 'El examen aún no está disponible' using errcode = 'P0001'; end if;
  if now() > q.closes_at then raise exception 'El examen ya cerró' using errcode = 'P0001'; end if;
  select count(*) into v_used from public.quiz_attempts where quiz_id = p_quiz and student_id = v_student;
  if v_used >= q.max_attempts then raise exception 'Ya usó todos sus intentos' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.quiz_questions where quiz_id = p_quiz) then raise exception 'El examen no tiene preguntas' using errcode = 'P0001'; end if;
  insert into public.quiz_attempts (organization_id, quiz_id, student_id, deadline)
  values (q.organization_id, p_quiz, v_student,
          least(q.closes_at, case when q.time_limit_min is null then q.closes_at else now() + make_interval(mins => q.time_limit_min) end))
  returning id into v_id;
  return v_id;
end $$;

-- Corrige en el servidor: respuestas {"<question_id>": [índices]}
create or replace function public.submit_quiz(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.quiz_attempts; q public.quizzes; v_score numeric := 0; v_max numeric := 0; r record; v_given int[]; v_grade numeric;
begin
  select * into t from public.quiz_attempts where id = p_attempt for update;
  if not found or t.student_id not in (select private.my_student_ids()) then raise exception 'Intento inexistente' using errcode = '42501'; end if;
  if t.submitted_at is not null then raise exception 'Este intento ya fue enviado' using errcode = 'P0001'; end if;
  select * into q from public.quizzes where id = t.quiz_id;
  -- 2 minutos de tolerancia por conexión; pasado eso, se corrige lo recibido igual que si fuese a tiempo
  if now() > t.deadline + interval '2 minutes' then p_answers := '{}'::jsonb; end if;
  for r in select x.id, x.points, x.kind, k.correct from public.quiz_questions x join public.quiz_answer_keys k on k.question_id = x.id where x.quiz_id = q.id loop
    v_max := v_max + r.points;
    select coalesce(array_agg(distinct v::int order by v::int), '{}') into v_given
      from jsonb_array_elements_text(case when jsonb_typeof(p_answers -> r.id::text) = 'array' then p_answers -> r.id::text else '[]'::jsonb end) v
      where v ~ '^\d+$';
    if v_given = (select array_agg(distinct c order by c) from unnest(r.correct) c) then v_score := v_score + r.points; end if;
  end loop;
  v_grade := private.post_grade(q.assessment_id, t.student_id, case when v_max > 0 then v_score / v_max else 0 end, 'Examen en línea: ' || q.title);
  update public.quiz_attempts set submitted_at = now(), answers = coalesce(p_answers, '{}'), score = v_score, max_score = v_max, grade = v_grade where id = t.id;
  return jsonb_build_object('score', v_score, 'max', v_max, 'grade', v_grade, 'show', q.show_results);
end $$;

-- Revisión del estudiante tras enviar (si el profesor lo permite)
create or replace function public.quiz_review(p_attempt uuid)
returns table (question_id uuid, prompt text, options jsonb, given jsonb, correct int[], points numeric)
language sql stable security definer set search_path = '' as $$
  select x.id, x.prompt, x.options, t.answers -> x.id::text, k.correct, x.points
  from public.quiz_attempts t join public.quizzes q on q.id = t.quiz_id
  join public.quiz_questions x on x.quiz_id = q.id join public.quiz_answer_keys k on k.question_id = x.id
  where t.id = p_attempt and t.submitted_at is not null and t.student_id in (select private.my_student_ids())
    and q.show_results and now() > q.closes_at
  order by x.position
$$;

-- ---------------------------------------------------------------------
-- Foros por sección
-- ---------------------------------------------------------------------
create table public.forum_threads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid not null references public.sections(id),
  author_id       uuid not null default auth.uid() references public.profiles(id),
  author_name     text,
  title           text not null check (length(title) between 3 and 200),
  body            text not null check (length(body) between 1 and 10000),
  pinned          boolean not null default false,
  locked          boolean not null default false,
  created_at      timestamptz not null default now(),
  last_post_at    timestamptz not null default now()
);
create table public.forum_posts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  thread_id       uuid not null references public.forum_threads(id) on delete cascade,
  author_id       uuid not null default auth.uid() references public.profiles(id),
  author_name     text,
  body            text not null check (length(body) between 1 and 10000),
  created_at      timestamptz not null default now()
);
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;
create policy ft_select on public.forum_threads for select to authenticated using (private.section_member(section_id));
create policy ft_insert on public.forum_threads for insert to authenticated with check (
  author_id = auth.uid() and (private.section_manager(section_id) or (private.enrolled_in_section(section_id) and not pinned and not locked)));
create policy ft_update on public.forum_threads for update to authenticated
  using (private.section_manager(section_id)) with check (private.section_manager(section_id));
create policy ft_delete on public.forum_threads for delete to authenticated
  using (private.section_manager(section_id) or (author_id = auth.uid() and private.section_member(section_id)));
create policy fp_select on public.forum_posts for select to authenticated using (
  exists (select 1 from public.forum_threads t where t.id = thread_id and private.section_member(t.section_id)));
create policy fp_insert on public.forum_posts for insert to authenticated with check (
  author_id = auth.uid() and exists (select 1 from public.forum_threads t where t.id = thread_id and t.organization_id = forum_posts.organization_id
    and (private.section_manager(t.section_id) or (private.section_member(t.section_id) and not t.locked))));
create policy fp_delete on public.forum_posts for delete to authenticated using (
  author_id = auth.uid() or exists (select 1 from public.forum_threads t where t.id = thread_id and private.section_manager(t.section_id)));

create or replace function private.forum_names() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select full_name into new.author_name from public.profiles where id = new.author_id;
  if tg_table_name = 'forum_posts' then update public.forum_threads set last_post_at = now() where id = new.thread_id; end if;
  return new;
end $$;
create trigger trg_ft_names before insert on public.forum_threads for each row execute function private.forum_names();
create trigger trg_fp_names before insert on public.forum_posts for each row execute function private.forum_names();

-- Auditoría
create trigger audit_assignments after insert or update or delete on public.assignments for each row execute function private.audit_row();
create trigger audit_submissions after insert or update or delete on public.submissions for each row execute function private.audit_row();
create trigger audit_quizzes     after insert or update or delete on public.quizzes for each row execute function private.audit_row();
create trigger audit_quiz_att    after insert or update or delete on public.quiz_attempts for each row execute function private.audit_row();

-- Privilegios
grant select, insert on public.lms_files to authenticated;
grant select, insert, update, delete on public.course_units, public.course_contents, public.assignments, public.quizzes,
  public.quiz_questions, public.quiz_answer_keys to authenticated;
grant select on public.submissions, public.quiz_attempts to authenticated;
grant select, insert, delete on public.forum_threads, public.forum_posts to authenticated;
grant update (pinned, locked) on public.forum_threads to authenticated;
grant all on public.lms_files, public.course_units, public.course_contents, public.assignments, public.submissions, public.quizzes,
  public.quiz_questions, public.quiz_answer_keys, public.quiz_attempts, public.forum_threads, public.forum_posts to service_role;
grant execute on function public.submit_assignment(uuid, text, text, uuid), public.grade_submission(uuid, numeric, text),
  public.start_quiz(uuid), public.submit_quiz(uuid, jsonb), public.quiz_review(uuid) to authenticated;
