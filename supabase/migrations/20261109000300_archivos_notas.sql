-- =====================================================================
-- Recuperación de contraseña, libros asociados, calificaciones,
-- archivos de usuarios (con historial) y grabaciones con permisos
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Límite de enlaces de recuperación (por IP y por correo)
-- ---------------------------------------------------------------------
create or replace function public.password_reset_limited(p_ip inet, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_ip is not null and private.rate_limited('pwreset_ip', host(p_ip), 10, interval '1 hour') then return true; end if;
  return private.rate_limited('pwreset_email', lower(coalesce(p_email, '')), 4, interval '1 hour');
end $$;
revoke all on function public.password_reset_limited(inet, text) from public, anon, authenticated;
grant execute on function public.password_reset_limited(inet, text) to service_role;

-- ---------------------------------------------------------------------
-- 2. Cada libro nuevo queda asociado a una carrera, asignatura o curso
--    (NOT VALID: los antiguos sin asociar se marcan para corregirlos)
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'library_items_associated_chk') then
    alter table public.library_items add constraint library_items_associated_chk
      check (program_id is not null or course_id is not null or section_id is not null) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Calificaciones: promedios por estudiante y sección
-- ---------------------------------------------------------------------
create or replace function private.grades_scope(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when private.is_owner(p_org) or private.has_permission(p_org, 'grades.view', null)
                or private.has_permission(p_org, 'reports.view', null) then 'all'
              when exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = p_org) then 'teacher'
              else 'none' end
$$;

create or replace function public.grades_report(p_org uuid, p_period uuid default null, p_section uuid default null)
returns table (section_id uuid, section_label text, course_credits numeric, period_code text, program_name text,
               student_id uuid, student_name text, student_code text, graded_weight numeric, average numeric,
               final_grade numeric, result text, passing_grade numeric, min_grade numeric, max_grade numeric, at_risk boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_scope text := private.grades_scope(p_org);
begin
  if v_scope = 'none' then raise exception 'Sin permiso para ver calificaciones' using errcode = '42501'; end if;
  return query
  with g as (
    select a.section_id, gr.student_id, sum(gr.grade * a.weight_pct) / nullif(sum(a.weight_pct), 0) avg_w, sum(a.weight_pct) w
      from public.grades gr join public.assessments a on a.id = gr.assessment_id
     where a.organization_id = p_org
     group by a.section_id, gr.student_id
  )
  select s.id, c.code || ' · ' || c.name || ' (' || s.code || ')', c.credits, p.code,
         (select pr.name from public.enrollments e join public.programs pr on pr.id = e.program_id
           where e.student_id = st.id and e.period_id = s.period_id order by e.created_at desc limit 1),
         st.id, st.last_names || ', ' || st.first_names, st.student_code,
         coalesce(g.w, 0), round(g.avg_w, 2), ar.final_grade, coalesce(ar.result::text, 'in_progress'),
         gs.passing_grade, gs.min_grade, gs.max_grade,
         coalesce(ar.final_grade, g.avg_w) < gs.passing_grade
    from public.sections s
    join public.courses c on c.id = s.course_id
    join public.academic_periods p on p.id = s.period_id
    join public.grade_scales gs on gs.id = s.grade_scale_id
    join public.section_enrollments se on se.section_id = s.id and se.status <> 'dropped'
    join public.students st on st.id = se.student_id
    left join g on g.section_id = s.id and g.student_id = st.id
    left join public.academic_records ar on ar.section_id = s.id and ar.student_id = st.id
   where s.organization_id = p_org
     and (p_period is null or s.period_id = p_period) and (p_section is null or s.id = p_section)
     and (v_scope = 'all' or private.teaches_section(s.id))
   order by 2, 7;
end $$;

-- Notas del estudiante (solo evaluaciones publicadas) con promedio ponderado
create or replace function public.my_grades()
returns table (section_id uuid, course_code text, course_name text, credits numeric, period_code text, section_code text,
               assessment text, weight_pct numeric, grade numeric, due_on date, average numeric, final_grade numeric,
               result text, passing_grade numeric)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select se.section_id, se.student_id from public.section_enrollments se
     where se.student_id in (select private.my_student_ids()) and se.status <> 'dropped'
  ), avgs as (
    select a.section_id, gr.student_id, round(sum(gr.grade * a.weight_pct) / nullif(sum(a.weight_pct), 0), 2) av
      from public.grades gr join public.assessments a on a.id = gr.assessment_id
     where a.published and gr.student_id in (select private.my_student_ids())
     group by a.section_id, gr.student_id
  )
  select s.id, c.code, c.name, c.credits, p.code, s.code, a.name, a.weight_pct, gr.grade, a.due_on,
         av.av, ar.final_grade, coalesce(ar.result::text, 'in_progress'), gs.passing_grade
    from mine m
    join public.sections s on s.id = m.section_id
    join public.courses c on c.id = s.course_id
    join public.academic_periods p on p.id = s.period_id
    join public.grade_scales gs on gs.id = s.grade_scale_id
    left join public.assessments a on a.section_id = s.id and a.published
    left join public.grades gr on gr.assessment_id = a.id and gr.student_id = m.student_id
    left join avgs av on av.section_id = s.id and av.student_id = m.student_id
    left join public.academic_records ar on ar.section_id = s.id and ar.student_id = m.student_id
   order by p.code desc, c.name, a.due_on nulls last, a.name
$$;

revoke all on function public.grades_report(uuid, uuid, uuid), public.my_grades() from public, anon;
grant execute on function public.grades_report(uuid, uuid, uuid), public.my_grades() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Archivos de usuarios: fotos, videos y documentos. Eliminar los oculta;
--    el propietario ve el historial, restaura o elimina definitivamente.
-- ---------------------------------------------------------------------
create table if not exists public.user_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id        uuid not null references public.profiles(id),
  name            text not null check (length(name) between 1 and 200),
  description     text check (length(description) <= 2000),
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  storage_path    text not null unique,
  visibility      text not null default 'private' check (visibility in ('private','section','staff','org')),
  section_id      uuid references public.sections(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id),
  check ((visibility = 'section') = (section_id is not null))
);
create index if not exists user_files_org_idx on public.user_files (organization_id, created_at desc);
create index if not exists user_files_owner_idx on public.user_files (owner_id, created_at desc);
alter table public.user_files enable row level security;
revoke all on public.user_files from anon;
grant select on public.user_files to authenticated;

drop policy if exists ufiles_read on public.user_files;
create policy ufiles_read on public.user_files for select to authenticated using (
  private.is_owner(organization_id)
  or (deleted_at is null and (
        owner_id = auth.uid()
     or (visibility = 'org' and private.is_member(organization_id))
     or (visibility = 'staff' and (private.is_staff(organization_id) or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = user_files.organization_id)))
     or (visibility = 'section' and (private.teaches_section(section_id) or private.enrolled_in_section(section_id))))));

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_user_files') then
    create trigger audit_user_files after insert or update or delete on public.user_files for each row execute function private.audit_row();
  end if;
end $$;

-- Registrar un archivo ya subido (lo llama el servidor tras verificar la subida)
create or replace function public.register_user_file(p_org uuid, p_name text, p_mime text, p_size bigint, p_path text,
  p_visibility text default 'private', p_section uuid default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.is_member(p_org) then raise exception 'Sin acceso a la institución' using errcode = '42501'; end if;
  if p_path not like p_org::text || '/' || auth.uid()::text || '/%' or p_path like '%..%' then raise exception 'Ruta inválida' using errcode = '22023'; end if;
  if p_visibility = 'section' and not (private.teaches_section(p_section) or private.enrolled_in_section(p_section) or private.is_owner(p_org)) then
    raise exception 'No pertenece a esa sección' using errcode = '42501';
  end if;
  if private.rate_limited('upload', auth.uid()::text, 200, interval '1 hour') then
    raise exception 'Demasiadas subidas seguidas. Espere unos minutos.' using errcode = '54000';
  end if;
  insert into public.user_files (organization_id, owner_id, name, description, mime_type, size_bytes, storage_path, visibility, section_id)
  values (p_org, auth.uid(), left(trim(p_name), 200), nullif(trim(p_description), ''), p_mime, p_size, p_path,
          coalesce(p_visibility, 'private'), case when p_visibility = 'section' then p_section end)
  returning id into v_id;
  return v_id;
end $$;

-- 🗑 Eliminar (el dueño del archivo o el propietario): queda oculto, con historial
create or replace function public.delete_user_file(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.user_files;
begin
  select * into f from public.user_files where id = p_id;
  if f.id is null then raise exception 'Archivo no encontrado' using errcode = 'P0002'; end if;
  if f.owner_id <> auth.uid() and not private.is_owner(f.organization_id) then raise exception 'Solo quien lo subió puede eliminarlo' using errcode = '42501'; end if;
  update public.user_files set deleted_at = now(), deleted_by = auth.uid() where id = p_id and deleted_at is null;
end $$;

-- ♻ Restaurar (propietario)
create or replace function public.restore_user_file(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.user_files;
begin
  select * into f from public.user_files where id = p_id;
  if f.id is null or not private.is_owner(f.organization_id) then raise exception 'Solo el propietario puede restaurar' using errcode = '42501'; end if;
  update public.user_files set deleted_at = null, deleted_by = null where id = p_id;
end $$;

-- ✖ Eliminar definitivamente (propietario): borra el registro; devuelve la ruta para borrar el archivo
create or replace function public.purge_user_file(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare f public.user_files;
begin
  select * into f from public.user_files where id = p_id;
  if f.id is null or not private.is_owner(f.organization_id) then raise exception 'Solo el propietario puede eliminar definitivamente' using errcode = '42501'; end if;
  perform set_config('sematec.audit_reason', 'Eliminación definitiva por el propietario', true);
  delete from public.user_files where id = p_id;
  return f.storage_path;
end $$;

revoke all on function public.register_user_file(uuid, text, text, bigint, text, text, uuid, text), public.delete_user_file(uuid),
  public.restore_user_file(uuid), public.purge_user_file(uuid) from public, anon;
grant execute on function public.register_user_file(uuid, text, text, bigint, text, text, uuid, text), public.delete_user_file(uuid),
  public.restore_user_file(uuid), public.purge_user_file(uuid) to authenticated;

-- Depósito privado (solo el servidor sube y firma enlaces). 50 MB por archivo (plan Free de Supabase).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-files', 'user-files', false, 52428800, null)
on conflict (id) do nothing;

-- user_files: el borrado definitivo no pasa por Deshacer (el archivo ya no existe)
create or replace function private.undo_blocked_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['audit_events','undo_log','organizations','payments','payment_allocations','charges','installments',
               'checkout_orders','student_accounts','certificates','grades','grade_history','academic_records',
               'quiz_attempts','submissions','conference_participants','conference_recordings','documents',
               'document_versions','enrollment_documents','security_incidents','staff_attendance',
               'library_files','lms_files','media_assets','profiles','exchange_rates','user_files']
$$;

-- ---------------------------------------------------------------------
-- 5. Aula virtual: todos pueden compartir pantalla; grabación por partes;
--    solo personas autorizadas guardan, descargan, envían y cortan videos
-- ---------------------------------------------------------------------
alter table public.conference_sessions alter column students_can_share set default true;
update public.conference_sessions set students_can_share = true where status in ('scheduled', 'live');

alter table public.conference_recordings
  add column if not exists group_id uuid,
  add column if not exists part_no int,
  add column if not exists source_id uuid references public.conference_recordings(id) on delete set null;
create index if not exists conference_recordings_group_idx on public.conference_recordings (group_id, part_no);

-- ¿Puede guardar, descargar, enviar y cortar grabaciones de esta sesión?
create or replace function public.can_manage_recordings(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.conference_is_moderator(p_session)
      or exists (select 1 from public.conference_sessions s where s.id = p_session
                  and (private.is_owner(s.organization_id) or private.has_permission(s.organization_id, 'conferences.export', null)))
$$;
revoke all on function public.can_manage_recordings(uuid) from public, anon;
grant execute on function public.can_manage_recordings(uuid) to authenticated;
