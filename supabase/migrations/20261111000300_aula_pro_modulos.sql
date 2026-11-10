-- =====================================================================
-- Aula virtual profesional: sala de espera, bloquear sala, grupos.
-- Creador de módulos sin código y personalización del menú.
-- =====================================================================

-- ---------- Sala de espera y bloqueo ----------
alter table public.conference_sessions add column if not exists waiting_room boolean not null default false;
alter table public.conference_sessions add column if not exists locked boolean not null default false;

create table if not exists public.conference_waiting (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.conference_sessions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_id uuid references public.conference_guests(id) on delete cascade,
  name text not null,
  status text not null default 'pending' check (status in ('pending','admitted','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz, decided_by uuid,
  check ((user_id is null) <> (guest_id is null))
);
create unique index if not exists conf_wait_user_uq on public.conference_waiting (session_id, user_id) where user_id is not null;
create unique index if not exists conf_wait_guest_uq on public.conference_waiting (session_id, guest_id) where guest_id is not null;
alter table public.conference_waiting enable row level security;
revoke all on public.conference_waiting from anon;
grant select on public.conference_waiting to authenticated;
grant all on public.conference_waiting to service_role;
drop policy if exists cwait_read on public.conference_waiting;
create policy cwait_read on public.conference_waiting for select to authenticated using (user_id = auth.uid() or public.conference_is_moderator(session_id));

/** ¿Puede entrar ya? Bloqueo de sala y sala de espera (el anfitrión y moderadores siempre entran). */
create or replace function public.conference_entry_check(p_session uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions; w public.conference_waiting; v_name text;
begin
  if auth.uid() is null then return 'denied'; end if;
  select * into s from public.conference_sessions where id = p_session;
  if not found then return 'denied'; end if;
  if public.conference_is_moderator(p_session) then return 'ok'; end if;
  select * into w from public.conference_waiting where session_id = p_session and user_id = auth.uid();
  if w.status = 'admitted' then return 'ok'; end if;
  if s.locked then return 'locked'; end if;
  if w.status = 'rejected' then return 'rejected'; end if;
  if not s.waiting_room then return 'ok'; end if;
  if w.id is null then
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
    insert into public.conference_waiting (organization_id, session_id, user_id, name) values (s.organization_id, s.id, auth.uid(), left(v_name, 160))
    on conflict do nothing;
  end if;
  return 'waiting';
end $$;
grant execute on function public.conference_entry_check(uuid) to authenticated;

/** Lo mismo para un invitado externo (lo llama el servidor). */
create or replace function public.guest_entry_check(p_guest uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare g public.conference_guests; s public.conference_sessions; w public.conference_waiting;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into g from public.conference_guests where id = p_guest;
  if not found or g.removed then return 'denied'; end if;
  select * into s from public.conference_sessions where id = g.session_id;
  select * into w from public.conference_waiting where session_id = s.id and guest_id = g.id;
  if w.status = 'admitted' then return 'ok'; end if;
  if s.locked then return 'locked'; end if;
  if w.status = 'rejected' then return 'rejected'; end if;
  if not s.waiting_room then return 'ok'; end if;
  if w.id is null then
    insert into public.conference_waiting (organization_id, session_id, guest_id, name) values (s.organization_id, s.id, g.id, left(g.full_name || ' (invitado)', 160))
    on conflict do nothing;
  end if;
  return 'waiting';
end $$;
revoke all on function public.guest_entry_check(uuid) from public, anon, authenticated;
grant execute on function public.guest_entry_check(uuid) to service_role;

/** Lista de espera (anfitrión). */
create or replace function public.conference_waiting_list(p_session uuid)
returns table (id uuid, name text, requested_at timestamptz, is_guest boolean)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, w.requested_at, w.guest_id is not null from public.conference_waiting w
   where w.session_id = p_session and w.status = 'pending' and public.conference_is_moderator(p_session)
   order by w.requested_at
$$;

/** Admitir o rechazar (uno, varios o todos). */
create or replace function public.conference_admit(p_session uuid, p_ids uuid[], p_admit boolean)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión' using errcode = '42501'; end if;
  update public.conference_waiting set status = case when p_admit then 'admitted' else 'rejected' end, decided_at = now(), decided_by = auth.uid()
   where session_id = p_session and status = 'pending' and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

/** Sala de espera activada/desactivada y sala bloqueada (nadie más entra). */
create or replace function public.conference_set_controls(p_session uuid, p_waiting boolean default null, p_locked boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions;
begin
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión' using errcode = '42501'; end if;
  update public.conference_sessions set waiting_room = coalesce(p_waiting, waiting_room), locked = coalesce(p_locked, locked) where id = p_session returning * into s;
  -- Al desactivar la sala de espera, entran todos los que esperaban
  if p_waiting = false then
    update public.conference_waiting set status = 'admitted', decided_at = now(), decided_by = auth.uid() where session_id = p_session and status = 'pending';
  end if;
  return jsonb_build_object('waiting_room', s.waiting_room, 'locked', s.locked);
end $$;
grant execute on function public.conference_waiting_list(uuid), public.conference_admit(uuid, uuid[], boolean), public.conference_set_controls(uuid, boolean, boolean) to authenticated;

-- ---------- Creador de módulos (sin tocar el código) ----------
create table if not exists public.custom_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  icon text not null default '🧩' check (length(icon) <= 8),
  description text check (length(description) <= 500),
  code_prefix text not null default 'REGI' check (code_prefix ~ '^[A-Z]{4}$'),
  fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 40),
  view_roles text[] not null default '{}',
  edit_roles text[] not null default '{}',
  show_in_menu boolean not null default true,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
create table if not exists public.custom_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.custom_modules(id) on delete cascade,
  code text,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_records_mod_idx on public.custom_records (module_id, created_at desc);

create or replace function private.has_any_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
                  where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active' and r.code = any(p_roles))
$$;
create or replace function private.module_can(p_module uuid, p_edit boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.custom_modules m where m.id = p_module and private.is_member(m.organization_id) and (
    private.is_owner(m.organization_id)
    or (m.active and (case when p_edit then private.has_any_role(m.organization_id, m.edit_roles)
                          else cardinality(m.view_roles) = 0 or private.has_any_role(m.organization_id, m.view_roles || m.edit_roles) end))))
$$;

/** Valida los datos de un registro contra los campos del módulo y le asigna su código (4 letras + 6 números). */
create or replace function private.custom_record_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.custom_modules; f jsonb; v jsonb; k text; t text;
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
  if tg_op = 'INSERT' and new.code is null then
    new.code := m.code_prefix || lpad(private.next_number(m.organization_id, 'mod_' || m.id::text)::text, 6, '0');
  end if;
  if tg_op = 'UPDATE' then new.code := old.code; new.updated_by := auth.uid(); new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_custom_records_check on public.custom_records;
create trigger trg_custom_records_check before insert or update on public.custom_records for each row execute function private.custom_record_check();

alter table public.custom_modules enable row level security;
alter table public.custom_records enable row level security;
revoke all on public.custom_modules, public.custom_records from anon;
grant select, insert, update, delete on public.custom_modules, public.custom_records to authenticated;
grant all on public.custom_modules, public.custom_records to service_role;
drop policy if exists cmod_read on public.custom_modules;
create policy cmod_read on public.custom_modules for select to authenticated using (private.is_owner(organization_id) or private.module_can(id, false));
drop policy if exists cmod_write on public.custom_modules;
create policy cmod_write on public.custom_modules for all to authenticated using (private.is_owner(organization_id)) with check (private.is_owner(organization_id));
drop policy if exists crec_read on public.custom_records;
create policy crec_read on public.custom_records for select to authenticated using (private.module_can(module_id, false));
drop policy if exists crec_insert on public.custom_records;
create policy crec_insert on public.custom_records for insert to authenticated with check (private.module_can(module_id, true));
drop policy if exists crec_update on public.custom_records;
create policy crec_update on public.custom_records for update to authenticated using (private.module_can(module_id, true)) with check (private.module_can(module_id, true));
drop policy if exists crec_delete on public.custom_records;
create policy crec_delete on public.custom_records for delete to authenticated using (private.module_can(module_id, true));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_custom_modules') then
    create trigger audit_custom_modules after insert or update or delete on public.custom_modules for each row execute function private.audit_row();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_custom_records') then
    create trigger audit_custom_records after insert or update or delete on public.custom_records for each row execute function private.audit_row();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_custom_modules_updated') then
    create trigger trg_custom_modules_updated before update on public.custom_modules for each row execute function private.set_updated_at();
  end if;
end $$;

/** Módulos que el usuario actual puede ver (para el menú). */
create or replace function public.my_custom_modules(p_org uuid)
returns table (slug text, name text, icon text)
language sql stable security definer set search_path = '' as $$
  select m.slug, m.name, m.icon from public.custom_modules m
   where m.organization_id = p_org and m.active and m.show_in_menu and private.module_can(m.id, false)
   order by m.name
$$;
grant execute on function public.my_custom_modules(uuid) to authenticated;

-- Grupos (salas pequeñas) abiertos en este momento
alter table public.conference_sessions add column if not exists breakout_groups int not null default 0 check (breakout_groups between 0 and 50);
create or replace function public.conference_set_groups(p_session uuid, p_groups int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión' using errcode = '42501'; end if;
  update public.conference_sessions set breakout_groups = greatest(0, least(coalesce(p_groups, 0), 50)) where id = p_session;
end $$;
grant execute on function public.conference_set_groups(uuid, int) to authenticated;

/** ¿Qué puede hacer el usuario actual en un módulo? (para mostrar u ocultar botones) */
create or replace function public.custom_module_access(p_module uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('view', private.module_can(p_module, false), 'edit', private.module_can(p_module, true))
$$;
grant execute on function public.custom_module_access(uuid) to authenticated;

-- Nombres para la barra ↶ Deshacer
do $$ declare d text; begin
  d := pg_get_functiondef('private.undo_table_label(text)'::regprocedure);
  if position('custom_records' in d) = 0 then
    execute replace(d, 'select coalesce(''{', 'select coalesce(''{"custom_records":"registro de módulo","custom_modules":"módulo",');
  end if;
end $$;
