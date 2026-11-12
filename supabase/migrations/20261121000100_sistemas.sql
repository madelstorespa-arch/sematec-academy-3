-- =====================================================================
-- Sistemas de la plataforma (catálogo de 80+ sistemas listos)
-- Motor de módulos ampliado:
--  · Área, plantilla de catálogo, flujo de estados y funciones por sistema
--  · Cada registro con estado, responsable, fecha límite y cierre
--  · Historial y comentarios, archivos adjuntos
--  · Autoservicio: cualquier persona de la institución crea solicitudes y ve solo las suyas
-- =====================================================================

alter table public.custom_modules add column if not exists area text;
alter table public.custom_modules add column if not exists catalog_key text check (catalog_key is null or catalog_key ~ '^[a-z0-9_]{2,40}$');
alter table public.custom_modules add column if not exists workflow jsonb not null default '[]'::jsonb check (jsonb_typeof(workflow) = 'array' and jsonb_array_length(workflow) <= 12);
alter table public.custom_modules add column if not exists features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object');
create unique index if not exists custom_modules_catalog_uq on public.custom_modules (organization_id, catalog_key) where catalog_key is not null;

alter table public.custom_records add column if not exists status text;
alter table public.custom_records add column if not exists assignee_id uuid references public.profiles(id) on delete set null;
alter table public.custom_records add column if not exists due_on date;
alter table public.custom_records add column if not exists closed_at timestamptz;
create index if not exists custom_records_status_idx on public.custom_records (module_id, status);
create index if not exists custom_records_assignee_idx on public.custom_records (assignee_id) where assignee_id is not null;

-- ¿El sistema acepta solicitudes de cualquier persona de la institución (autoservicio)?
create or replace function private.module_self(p_module uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.custom_modules m where m.id = p_module and m.active
                 and coalesce((m.features ->> 'self_service')::boolean, false) and private.is_member(m.organization_id))
$$;
grant execute on function private.module_self(uuid) to authenticated;

-- Validación: datos según los campos + estado según el flujo
create or replace function private.custom_record_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.custom_modules; f jsonb; v jsonb; k text; t text; w jsonb;
begin
  select * into m from public.custom_modules where id = new.module_id;
  if m.organization_id <> new.organization_id then raise exception 'Módulo de otra institución' using errcode = '42501'; end if;
  for f in select * from jsonb_array_elements(m.fields) loop
    k := f ->> 'key'; t := f ->> 'type'; v := new.data -> k;
    if coalesce((f ->> 'required')::boolean, false) and (v is null or v = 'null'::jsonb or btrim(v #>> '{}') = '' or v = '[]'::jsonb) then
      raise exception 'Complete el campo «%»', f ->> 'label' using errcode = '22023';
    end if;
    if v is not null and v <> 'null'::jsonb and btrim(v #>> '{}') <> '' then
      if t in ('number','money') and (v #>> '{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '«%» debe ser un número', f ->> 'label' using errcode = '22023'; end if;
      if t = 'date' and (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '«%» debe ser una fecha', f ->> 'label' using errcode = '22023'; end if;
      if t = 'email' and (v #>> '{}') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '«%» debe ser un correo válido', f ->> 'label' using errcode = '22023'; end if;
      if t = 'select' and jsonb_typeof(f -> 'options') = 'array' and not (f -> 'options') ? (v #>> '{}') then
        raise exception 'Opción inválida en «%»', f ->> 'label' using errcode = '22023'; end if;
    end if;
  end loop;
  if jsonb_array_length(m.workflow) > 0 then
    if new.status is null then new.status := m.workflow -> 0 ->> 'key'; end if;
    select x into w from jsonb_array_elements(m.workflow) x where x ->> 'key' = new.status;
    if w is null then raise exception 'Estado inválido' using errcode = '22023'; end if;
    if coalesce((w ->> 'final')::boolean, false) then new.closed_at := coalesce(case when tg_op = 'UPDATE' and old.status = new.status then old.closed_at end, now());
    else new.closed_at := null; end if;
  end if;
  if new.assignee_id is not null and not exists (select 1 from public.memberships ms where ms.user_id = new.assignee_id and ms.organization_id = new.organization_id and ms.status = 'active') then
    raise exception 'El responsable debe ser una persona de la institución' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and new.code is null then
    new.code := m.code_prefix || lpad(private.next_number(m.organization_id, 'mod_' || m.id::text)::text, 6, '0');
  end if;
  if tg_op = 'UPDATE' then new.code := old.code; new.created_by := old.created_by; new.updated_by := auth.uid(); new.updated_at := now(); end if;
  return new;
end $$;

-- Historial y comentarios
create table if not exists public.custom_record_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id       uuid not null references public.custom_records(id) on delete cascade,
  kind            text not null check (kind in ('created','comment','status','assign','file','due')),
  body            text check (body is null or length(body) <= 4000),
  from_status     text, to_status text,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists custom_record_events_idx on public.custom_record_events (record_id, created_at);

create table if not exists public.custom_record_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id       uuid not null references public.custom_records(id) on delete cascade,
  path            text not null, name text not null check (length(name) <= 200), size bigint not null default 0, mime text,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists custom_record_files_idx on public.custom_record_files (record_id);

create or replace function private.custom_record_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.custom_record_events (organization_id, record_id, kind, to_status, created_by) values (new.organization_id, new.id, 'created', new.status, auth.uid());
  else
    if new.status is distinct from old.status then
      insert into public.custom_record_events (organization_id, record_id, kind, from_status, to_status, created_by) values (new.organization_id, new.id, 'status', old.status, new.status, auth.uid());
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      insert into public.custom_record_events (organization_id, record_id, kind, body, created_by)
      values (new.organization_id, new.id, 'assign', coalesce((select full_name from public.profiles where id = new.assignee_id), 'Sin responsable'), auth.uid());
    end if;
    if new.due_on is distinct from old.due_on then
      insert into public.custom_record_events (organization_id, record_id, kind, body, created_by) values (new.organization_id, new.id, 'due', coalesce(to_char(new.due_on, 'DD-MM-YYYY'), 'sin fecha'), auth.uid());
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_custom_records_log on public.custom_records;
create trigger trg_custom_records_log after insert or update on public.custom_records for each row execute function private.custom_record_log();

-- Seguridad: quien gestiona el sistema ve todo; en autoservicio cada persona ve lo suyo; el responsable ve lo asignado
drop policy if exists cmod_read on public.custom_modules;
create policy cmod_read on public.custom_modules for select to authenticated
  using (private.is_owner(organization_id) or private.module_can(id, false) or private.module_self(id));
drop policy if exists crec_read on public.custom_records;
create policy crec_read on public.custom_records for select to authenticated
  using (private.module_can(module_id, false) or (created_by = auth.uid() and private.module_self(module_id)) or (assignee_id = auth.uid() and private.is_member(organization_id)));
drop policy if exists crec_insert on public.custom_records;
create policy crec_insert on public.custom_records for insert to authenticated
  with check (private.module_can(module_id, true) or (private.module_self(module_id) and created_by = auth.uid() and assignee_id is null));
drop policy if exists crec_update on public.custom_records;
create policy crec_update on public.custom_records for update to authenticated
  using (private.module_can(module_id, true) or (assignee_id = auth.uid() and private.is_member(organization_id)))
  with check (private.module_can(module_id, true) or (assignee_id = auth.uid() and private.is_member(organization_id)));

alter table public.custom_record_events enable row level security;
alter table public.custom_record_files enable row level security;
grant select, insert on public.custom_record_events to authenticated;
grant select, insert, delete on public.custom_record_files to authenticated;
grant all on public.custom_record_events, public.custom_record_files to service_role;
drop policy if exists crev_read on public.custom_record_events;
create policy crev_read on public.custom_record_events for select to authenticated using (exists (select 1 from public.custom_records r where r.id = record_id));
drop policy if exists crev_insert on public.custom_record_events;
create policy crev_insert on public.custom_record_events for insert to authenticated
  with check (kind in ('comment','file') and created_by = auth.uid() and exists (select 1 from public.custom_records r where r.id = record_id and r.organization_id = custom_record_events.organization_id));
drop policy if exists crfile_read on public.custom_record_files;
create policy crfile_read on public.custom_record_files for select to authenticated using (exists (select 1 from public.custom_records r where r.id = record_id));
drop policy if exists crfile_insert on public.custom_record_files;
create policy crfile_insert on public.custom_record_files for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.custom_records r where r.id = record_id and r.organization_id = custom_record_files.organization_id));
drop policy if exists crfile_delete on public.custom_record_files;
create policy crfile_delete on public.custom_record_files for delete to authenticated
  using (created_by = auth.uid() or exists (select 1 from public.custom_records r where r.id = record_id and private.module_can(r.module_id, true)));

-- Sistemas que la persona puede abrir (para el centro de sistemas y el mapa)
create or replace function public.my_systems(p_org uuid)
returns table (slug text, name text, icon text, area text, description text, catalog_key text, manage boolean, show_in_menu boolean)
language sql stable security definer set search_path = '' as $$
  select m.slug, m.name, m.icon, m.area, m.description, m.catalog_key, private.module_can(m.id, true), m.show_in_menu
    from public.custom_modules m
   where m.organization_id = p_org and m.active and (private.module_can(m.id, false) or private.module_self(m.id))
   order by m.area nulls last, m.name
$$;
grant execute on function public.my_systems(uuid) to authenticated;

create or replace function public.my_custom_modules(p_org uuid)
returns table (slug text, name text, icon text)
language sql stable security definer set search_path = '' as $$
  select m.slug, m.name, m.icon from public.custom_modules m
   where m.organization_id = p_org and m.active and m.show_in_menu and (private.module_can(m.id, false) or private.module_self(m.id))
   order by m.name
$$;
grant execute on function public.my_custom_modules(uuid) to authenticated;

-- Permisos de la persona en un sistema
create or replace function public.custom_module_access(p_module uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('view', private.module_can(p_module, false), 'edit', private.module_can(p_module, true), 'self', private.module_self(p_module))
$$;
grant execute on function public.custom_module_access(uuid) to authenticated;

-- Personas a las que se puede asignar un registro (miembros activos)
create or replace function public.module_people(p_module uuid)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.full_name from public.custom_modules m
    join public.memberships ms on ms.organization_id = m.organization_id and ms.status = 'active'
    join public.roles r on r.id = ms.role_id
    join public.profiles p on p.id = ms.user_id
   where m.id = p_module and private.module_can(m.id, true)
     and r.code not in ('estudiante','postulante','egresado','apoderado')
   order by p.full_name limit 300
$$;
grant execute on function public.module_people(uuid) to authenticated;

-- Archivos y comentarios auditados
drop trigger if exists trg_crfile_audit on public.custom_record_files;
create trigger trg_crfile_audit after insert or delete on public.custom_record_files for each row execute function private.audit_row();

-- Los registros de sistemas también se pueden «ocultar para / por»
drop policy if exists hide_custom_records on public.custom_records;
create policy hide_custom_records on public.custom_records as restrictive for select to anon, authenticated using (not private.hidden_for_me('custom_records', id, organization_id));
create or replace function public.hide_record(p_table text, p_id uuid, p_audience text[], p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_table not in ('announcements','calendar_events','library_items','job_postings','surveys','catalog_offerings','offices','resources',
                     'course_contents','course_units','class_materials','forum_threads','user_files','conference_sessions','products','media_assets',
                     'quizzes','assignments','benefits','custom_records') then
    raise exception 'Este tipo de registro no se puede ocultar' using errcode = '22023';
  end if;
  execute format('select organization_id from public.%I where id = $1', p_table) into v_org using p_id;
  if v_org is null then raise exception 'Registro no encontrado' using errcode = 'P0002'; end if;
  if not (private.is_owner(v_org) or private.has_permission(v_org, 'settings.admin')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_until is not null and p_until <= now() then raise exception 'La fecha debe ser futura' using errcode = '22023'; end if;
  insert into public.hidden_records (organization_id, table_name, record_id, audience, hidden_until, reason, hidden_by)
  values (v_org, p_table, p_id, p_audience, p_until, nullif(trim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (table_name, record_id) do update set audience = excluded.audience, hidden_until = excluded.hidden_until, reason = excluded.reason,
         hidden_by = excluded.hidden_by, created_at = now();
end $$;
revoke all on function public.hide_record(text, uuid, text[], timestamptz, text) from public, anon;
grant execute on function public.hide_record(text, uuid, text[], timestamptz, text) to authenticated;
