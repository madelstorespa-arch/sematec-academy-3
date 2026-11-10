-- =====================================================================
-- Etapa B: carpetas para ordenar archivos, evaluaciones con enlace externo
-- (Google Drive / Forms, Microsoft Forms…), preferencias personales por usuario.
-- =====================================================================

-- ---------- 📂 Carpetas ----------
create table if not exists public.file_folders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id       uuid references public.file_folders(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80 and name !~ '[\\/<>]'),
  color           text not null default 'amber' check (color in ('amber','blue','green','red','purple','slate')),
  created_at      timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index if not exists file_folders_owner_idx on public.file_folders (owner_id, parent_id);
create unique index if not exists file_folders_name_uq on public.file_folders (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
alter table public.file_folders enable row level security;
revoke all on public.file_folders from anon;
grant select, insert, update, delete on public.file_folders to authenticated;
grant all on public.file_folders to service_role;
create or replace function private.folder_is_mine(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.file_folders f where f.id = p_id and f.owner_id = auth.uid())
$$;
grant execute on function private.folder_is_mine(uuid) to authenticated;
drop policy if exists ffold_rw on public.file_folders;
create policy ffold_rw on public.file_folders for all to authenticated
  using (owner_id = auth.uid() or private.is_owner(organization_id))
  with check (owner_id = auth.uid() and private.is_member(organization_id)
    and (parent_id is null or private.folder_is_mine(parent_id)));

-- La carpeta padre no puede ser una subcarpeta propia (evita ciclos)
create or replace function private.folder_no_cycle() returns trigger language plpgsql set search_path = '' as $$
declare cur uuid := new.parent_id; n int := 0;
begin
  while cur is not null loop
    if cur = new.id then raise exception 'Una carpeta no puede quedar dentro de sí misma' using errcode = '22023'; end if;
    select parent_id into cur from public.file_folders where id = cur;
    n := n + 1; if n > 50 then raise exception 'Demasiados niveles de carpetas' using errcode = '22023'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_folder_no_cycle on public.file_folders;
create trigger trg_folder_no_cycle before insert or update of parent_id on public.file_folders for each row execute function private.folder_no_cycle();
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_file_folders') then
    create trigger audit_file_folders after insert or update or delete on public.file_folders for each row execute function private.audit_row();
  end if;
end $$;

alter table public.user_files add column if not exists folder_id uuid references public.file_folders(id) on delete set null;
create index if not exists user_files_folder_idx on public.user_files (folder_id);

/** Mover un archivo propio a una carpeta propia (o a la raíz con null). */
create or replace function public.move_user_file(p_id uuid, p_folder uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.user_files;
begin
  select * into f from public.user_files where id = p_id and deleted_at is null;
  if f.id is null then raise exception 'Archivo no encontrado' using errcode = 'P0002'; end if;
  if f.owner_id <> auth.uid() then raise exception 'Solo quien subió el archivo puede ordenarlo' using errcode = '42501'; end if;
  if p_folder is not null and not exists (select 1 from public.file_folders d where d.id = p_folder and d.owner_id = auth.uid()) then
    raise exception 'Carpeta no válida' using errcode = '42501';
  end if;
  update public.user_files set folder_id = p_folder where id = p_id;
end $$;
grant execute on function public.move_user_file(uuid, uuid) to authenticated;

/** Renombrar un archivo propio. */
create or replace function public.rename_user_file(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 200 then raise exception 'Nombre inválido' using errcode = '22023'; end if;
  update public.user_files set name = left(btrim(regexp_replace(p_name, '[\\/:*?"<>|]', '_', 'g')), 200)
   where id = p_id and owner_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'Solo quien subió el archivo puede renombrarlo' using errcode = '42501'; end if;
end $$;
grant execute on function public.rename_user_file(uuid, text) to authenticated;

-- ---------- 🔗 Evaluaciones con enlace externo (Drive, Google Forms, Microsoft Forms…) ----------
create table if not exists public.external_evaluations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  section_id      uuid not null references public.sections(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 2 and 160),
  instructions    text check (length(instructions) <= 4000),
  url             text not null check (url ~ '^https://[^\s<>"]+$' and length(url) <= 2000),
  provider        text not null default 'otro',
  opens_at        timestamptz not null,
  closes_at       timestamptz not null,
  assessment_id   uuid references public.assessments(id) on delete set null,
  published       boolean not null default true,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index if not exists ext_eval_section_idx on public.external_evaluations (section_id, opens_at);
create table if not exists public.external_evaluation_access (
  evaluation_id uuid not null references public.external_evaluations(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  first_opened  timestamptz not null default now(),
  last_opened   timestamptz not null default now(),
  times         int not null default 1,
  primary key (evaluation_id, student_id)
);
alter table public.external_evaluations enable row level security;
alter table public.external_evaluation_access enable row level security;
revoke all on public.external_evaluations, public.external_evaluation_access from anon, authenticated;
-- El enlace (url) NO se entrega directamente a los estudiantes: solo por la función, dentro del horario
grant select (id, organization_id, section_id, title, instructions, provider, opens_at, closes_at, assessment_id, published, created_by, created_at)
  on public.external_evaluations to authenticated;
grant insert, update, delete on public.external_evaluations to authenticated;
grant select on public.external_evaluation_access to authenticated;
grant all on public.external_evaluations, public.external_evaluation_access to service_role;
drop policy if exists exev_read on public.external_evaluations;
create policy exev_read on public.external_evaluations for select to authenticated
  using (private.section_manager(section_id) or (published and private.section_member(section_id)));
drop policy if exists exev_write on public.external_evaluations;
create policy exev_write on public.external_evaluations for all to authenticated
  using (private.section_manager(section_id))
  with check (private.section_manager(section_id)
    and organization_id = (select s.organization_id from public.sections s where s.id = section_id)
    and (assessment_id is null or exists (select 1 from public.assessments a where a.id = assessment_id and a.section_id = external_evaluations.section_id)));
drop policy if exists exacc_read on public.external_evaluation_access;
create policy exacc_read on public.external_evaluation_access for select to authenticated
  using (student_id in (select private.my_student_ids())
    or exists (select 1 from public.external_evaluations e where e.id = evaluation_id and private.section_manager(e.section_id)));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_external_evaluations') then
    create trigger audit_external_evaluations after insert or update or delete on public.external_evaluations for each row execute function private.audit_row();
  end if;
end $$;

/**
 * Entrega el enlace de la evaluación: el profesor siempre; el estudiante inscrito solo mientras está abierta.
 * Registra cada ingreso del estudiante (para que el profesor vea quién entró y cuándo).
 */
create or replace function public.open_external_evaluation(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare e public.external_evaluations; v_student uuid;
begin
  select * into e from public.external_evaluations where id = p_id;
  if e.id is null then raise exception 'Evaluación no encontrada' using errcode = 'P0002'; end if;
  if private.section_manager(e.section_id) then return e.url; end if;
  v_student := private.my_student_in_section(e.section_id);
  if v_student is null or not e.published then raise exception 'No está inscrito en este curso' using errcode = '42501'; end if;
  if now() < e.opens_at then raise exception 'La evaluación aún no abre (abre el %)', to_char(e.opens_at at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI') using errcode = '22023'; end if;
  if now() >= e.closes_at then raise exception 'La evaluación ya cerró' using errcode = '22023'; end if;
  insert into public.external_evaluation_access (evaluation_id, student_id) values (e.id, v_student)
  on conflict (evaluation_id, student_id) do update set last_opened = now(), times = public.external_evaluation_access.times + 1;
  return e.url;
end $$;
grant execute on function public.open_external_evaluation(uuid) to authenticated;

-- ---------- ⚙ Preferencias personales (idioma, caja, docencia, avisos): cada usuario las suyas ----------
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object');
create or replace function public.update_my_preferences(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) <> 'object' or length(p_patch::text) > 8000 then raise exception 'Preferencias inválidas' using errcode = '22023'; end if;
  update public.profiles set preferences = jsonb_strip_nulls(preferences || p_patch) where id = auth.uid() returning preferences into v;
  if p_patch ? 'locale' and (p_patch ->> 'locale') ~ '^[a-z]{2}(-[A-Z]{2})?$' then
    update public.profiles set preferred_locale = p_patch ->> 'locale' where id = auth.uid();
  end if;
  return v;
end $$;
grant execute on function public.update_my_preferences(jsonb) to authenticated;
