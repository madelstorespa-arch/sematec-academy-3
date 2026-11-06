-- =====================================================================
-- Migración 003 · Identidad, roles, permisos y auditoría protegida
-- Sistemas 46 (identidad y acceso) y 49 (seguridad operacional)
-- SEG-003 a SEG-010 · RF-056
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfiles (1:1 con auth.users de Supabase)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete restrict,
  email             text not null,
  full_name         text not null default '',
  phone             text,
  preferred_locale  text not null default 'es',          -- INT-001
  timezone          text not null default 'America/Santiago',
  status            public.profile_status not null default 'active',
  is_platform_admin boolean not null default false,      -- superadministrador
  status_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles for each row execute function private.set_updated_at();

-- Crea el perfil automáticamente al registrarse un usuario en Supabase Auth
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Permisos, roles y membresías
-- ---------------------------------------------------------------------
create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.(view|create|edit|approve|void|export|admin)$'),
  module      text not null,
  action      text not null,
  description text not null default ''
);

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict, -- null = plantilla del sistema
  code            text not null check (code ~ '^[a-z_]{2,50}$'),
  name            text not null,
  description     text not null default '',
  is_system       boolean not null default false,
  requires_mfa    boolean not null default false,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, code)
);

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete restrict,
  primary key (role_id, permission_code)
);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role_id         uuid not null references public.roles(id) on delete restrict,
  campus_id       uuid,                                  -- null = todas las sedes
  status          public.membership_status not null default 'active',
  valid_from      timestamptz not null default now(),
  valid_until     timestamptz,
  granted_by      uuid references public.profiles(id),
  revoked_by      uuid references public.profiles(id),
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (user_id, organization_id, role_id, campus_id),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id),
  check (valid_until is null or valid_until > valid_from)
);
create index on public.memberships (user_id, organization_id) where status = 'active';

-- El rol debe ser plantilla del sistema o pertenecer a la misma institución
create or replace function private.check_membership_role()
returns trigger language plpgsql set search_path = '' as $$
declare v_role_org uuid;
begin
  select organization_id into v_role_org from public.roles where id = new.role_id;
  if v_role_org is not null and v_role_org <> new.organization_id then
    raise exception 'El rol pertenece a otra institución' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_memberships_role before insert or update on public.memberships
  for each row execute function private.check_membership_role();

-- ---------------------------------------------------------------------
-- Funciones de autorización (usadas por todas las políticas RLS)
-- SECURITY DEFINER + search_path vacío para evitar secuestro de funciones.
-- ---------------------------------------------------------------------
create or replace function private.current_aal()
returns text language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

-- Llamada del backend con la clave service_role (Edge Functions, webhooks)
create or replace function private.is_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

create or replace function private.current_user_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
$$;

-- Superadministrador: requiere MFA (aal2) además de la marca en su perfil
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.is_platform_admin
  ) and private.current_aal() = 'aal2'
$$;

create or replace function private.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_user_active() and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
      and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
  )
$$;

-- Permiso por institución, sede, módulo y acción (SEG-004/005/006).
-- Si el rol exige MFA, la sesión debe ser aal2 (SEG-003).
create or replace function private.has_permission(p_org uuid, p_perm text, p_campus uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_user_active() and exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    join public.role_permissions rp on rp.role_id = r.id
    where m.user_id = auth.uid()
      and m.organization_id = p_org
      and m.status = 'active'
      and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
      and rp.permission_code = p_perm
      and (m.campus_id is null or p_campus is null or m.campus_id = p_campus)
      and (not r.requires_mfa or private.current_aal() = 'aal2')
  )
$$;

-- El usuario actual puede ver datos personales de otro usuario si comparten
-- una institución donde el actual tiene users.view
create or replace function private.can_view_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user and m.status = 'active'
      and private.has_permission(m.organization_id, 'users.view')
  )
$$;

-- ---------------------------------------------------------------------
-- Auditoría protegida: solo inserción, encadenada por hash por institución
-- ---------------------------------------------------------------------
create table public.audit_events (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default clock_timestamp(),
  organization_id uuid,                   -- null = cadena global de plataforma
  chain_seq       bigint not null,
  actor_id        uuid,
  actor_db_role   text not null default current_user,
  table_name      text not null,
  record_id       text,
  operation       text not null check (operation in ('INSERT','UPDATE','DELETE','ACTION')),
  action          text,                   -- acción de negocio, p.ej. payment.void
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[],
  reason          text,
  prev_hash       text not null,
  hash            text not null,
  unique nulls not distinct (organization_id, chain_seq)
);
create index on public.audit_events (organization_id, occurred_at desc);
create index on public.audit_events (table_name, record_id);

create or replace function private.audit_hash(
  p_prev text, p_org uuid, p_seq bigint, p_at timestamptz, p_actor uuid, p_table text,
  p_record text, p_op text, p_action text, p_old jsonb, p_new jsonb, p_reason text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(
    concat_ws('|', p_prev, coalesce(p_org::text,'-'), p_seq::text,
              to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
              coalesce(p_actor::text,'-'), p_table, coalesce(p_record,'-'), p_op,
              coalesce(p_action,'-'), coalesce(p_old::text,'-'), coalesce(p_new::text,'-'),
              coalesce(p_reason,'-')), 'sha256'), 'hex')
$$;

create or replace function private.write_audit(
  p_org uuid, p_table text, p_record text, p_op text, p_action text,
  p_old jsonb, p_new jsonb, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prev text; v_seq bigint; v_at timestamptz := clock_timestamp();
  v_changed text[]; v_actor uuid := auth.uid();
begin
  -- serializa la cadena de cada institución
  perform pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(p_org::text, 'global'), 0));
  select a.hash, a.chain_seq into v_prev, v_seq
    from public.audit_events a
   where a.organization_id is not distinct from p_org
   order by a.chain_seq desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_seq  := coalesce(v_seq, 0) + 1;
  if p_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(p_new) k
     where (p_old -> k) is distinct from (p_new -> k) and k <> 'updated_at';
    if v_changed is null then return; end if;   -- actualización sin cambios reales
  end if;
  insert into public.audit_events (occurred_at, organization_id, chain_seq, actor_id, table_name,
      record_id, operation, action, old_data, new_data, changed_fields, reason, prev_hash, hash)
  values (v_at, p_org, v_seq, v_actor, p_table, p_record, p_op, p_action, p_old, p_new, v_changed,
      p_reason, v_prev,
      private.audit_hash(v_prev, p_org, v_seq, v_at, v_actor, p_table, p_record, p_op, p_action, p_old, p_new, p_reason));
end $$;

-- Disparador genérico. TG_ARGV[0] = columna que contiene la institución.
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_col text := coalesce(tg_argv[0], 'organization_id');
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  perform private.write_audit(
    nullif(v_row ->> v_col, '')::uuid, tg_table_name, v_row ->> 'id', tg_op, null, v_old, v_new,
    nullif(current_setting('sematec.audit_reason', true), ''));
  return null;
end $$;

-- Las filas de auditoría no pueden modificarse ni borrarse (ni por superusuario
-- mientras el disparador esté activo; desactivarlo queda en el log del servidor).
create or replace function private.block_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Registro inmutable (%): % no permitido', tg_table_name, tg_op using errcode = '42501';
end $$;
create trigger trg_audit_immutable before update or delete on public.audit_events
  for each row execute function private.block_audit_mutation();
create trigger trg_audit_no_truncate before truncate on public.audit_events
  for each statement execute function private.block_audit_mutation();

-- Verificación de integridad de la cadena (detecta alteraciones o huecos)
create or replace function public.verify_audit_chain(p_org uuid)
returns table (ok boolean, checked bigint, first_broken_seq bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record; v_prev text := repeat('0', 64); v_expected bigint := 1; v_n bigint := 0;
begin
  if p_org is null then
    if not (private.is_platform_admin() or private.is_service()) then
      raise exception 'No autorizado' using errcode = '42501';
    end if;
  elsif not (private.has_permission(p_org, 'audit.view') or private.is_service()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  for r in select * from public.audit_events a where a.organization_id is not distinct from p_org order by a.chain_seq loop
    v_n := v_n + 1;
    if r.chain_seq <> v_expected or r.prev_hash <> v_prev or r.hash <> private.audit_hash(
         r.prev_hash, r.organization_id, r.chain_seq, r.occurred_at, r.actor_id, r.table_name,
         r.record_id, r.operation, r.action, r.old_data, r.new_data, r.reason) then
      return query select false, v_n, r.chain_seq; return;
    end if;
    v_prev := r.hash; v_expected := v_expected + 1;
  end loop;
  return query select true, v_n, null::bigint;
end $$;

-- ---------------------------------------------------------------------
-- Eventos de seguridad y de integración (sistema 49, VID-016)
-- ---------------------------------------------------------------------
create table public.system_events (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  organization_id uuid references public.organizations(id),
  user_id         uuid,
  event_type      text not null,            -- login_failed, mfa_enrolled, session_revoked, suspicious_login...
  severity        text not null default 'info' check (severity in ('info','warning','critical')),
  ip_address      inet,
  user_agent      text,
  details         jsonb not null default '{}'::jsonb
);
create index on public.system_events (event_type, occurred_at desc);
create index on public.system_events (user_id, occurred_at desc);

create table public.integration_events (
  id              bigint generated always as identity primary key,
  received_at     timestamptz not null default now(),
  organization_id uuid references public.organizations(id),
  provider        text not null,            -- livekit, payment_gateway, email...
  event_type      text not null,
  idempotency_key text not null,
  payload         jsonb not null,
  processed_at    timestamptz,
  error           text,
  unique (provider, idempotency_key)        -- evita procesar dos veces un webhook
);

-- Suspensión automática ante intentos abusivos (SEG-010).
-- Lo invoca el backend (service_role) al registrar un fallo de inicio de sesión.
create or replace function public.record_login_failure(p_email text, p_ip inet, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid; v_fails int; v_limit int := 5; v_window interval := interval '15 minutes';
begin
  select id into v_user from public.profiles where lower(email) = lower(p_email);
  insert into public.system_events (user_id, event_type, severity, ip_address, user_agent, details)
  values (v_user, 'login_failed', 'warning', p_ip, p_user_agent, jsonb_build_object('email', lower(p_email)));
  select count(*) into v_fails from public.system_events
   where event_type = 'login_failed' and details ->> 'email' = lower(p_email)
     and occurred_at > now() - v_window;
  if v_user is not null and v_fails >= v_limit then
    update public.profiles set status = 'locked', status_reason = 'Bloqueo por intentos fallidos'
     where id = v_user and status = 'active';
    if found then
      insert into public.system_events (user_id, event_type, severity, ip_address, details)
      values (v_user, 'account_locked', 'critical', p_ip, jsonb_build_object('failures', v_fails));
    end if;
  end if;
  return jsonb_build_object('failures_in_window', v_fails, 'locked', v_user is not null and v_fails >= v_limit);
end $$;

-- ---------------------------------------------------------------------
-- Administración de roles y membresías (solo mediante funciones)
-- Anti-escalamiento: quien otorga debe poseer todos los permisos del rol.
-- ---------------------------------------------------------------------
create or replace function private.can_grant_role(p_org uuid, p_role uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or (
    private.has_permission(p_org, 'security.admin') and private.current_aal() = 'aal2'
    and not exists (
      select 1 from public.role_permissions rp
      where rp.role_id = p_role and not private.has_permission(p_org, rp.permission_code)
    )
  )
$$;

create or replace function public.grant_membership(
  p_user uuid, p_org uuid, p_role_code text, p_campus uuid default null, p_valid_until timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role uuid; v_id uuid;
begin
  select id into v_role from public.roles
   where code = p_role_code and (organization_id = p_org or organization_id is null)
   order by organization_id nulls last limit 1;
  if v_role is null then raise exception 'Rol % no existe', p_role_code using errcode = 'P0002'; end if;
  if not private.can_grant_role(p_org, v_role) then
    raise exception 'No autorizado para otorgar el rol %', p_role_code using errcode = '42501';
  end if;
  if p_user = auth.uid() and not private.is_platform_admin() then
    raise exception 'No puede otorgarse roles a sí mismo' using errcode = '42501';
  end if;
  insert into public.memberships (user_id, organization_id, role_id, campus_id, valid_until, granted_by)
  values (p_user, p_org, v_role, p_campus, p_valid_until, auth.uid())
  on conflict (user_id, organization_id, role_id, campus_id)
  do update set status = 'active', valid_until = excluded.valid_until, granted_by = excluded.granted_by,
                revoked_at = null, revoked_by = null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_membership(p_membership uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found then raise exception 'Membresía inexistente' using errcode = 'P0002'; end if;
  if not (private.is_platform_admin() or (private.has_permission(m.organization_id, 'security.admin') and private.current_aal() = 'aal2')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Debe indicar un motivo' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.memberships set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where id = p_membership;
end $$;

create or replace function public.create_custom_role(
  p_org uuid, p_code text, p_name text, p_permissions text[], p_requires_mfa boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_perm text;
begin
  if not (private.is_platform_admin() or (private.has_permission(p_org, 'security.admin') and private.current_aal() = 'aal2')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  foreach v_perm in array p_permissions loop
    if not private.is_platform_admin() and not private.has_permission(p_org, v_perm) then
      raise exception 'No puede delegar el permiso % que no posee', v_perm using errcode = '42501';
    end if;
  end loop;
  insert into public.roles (organization_id, code, name, requires_mfa) values (p_org, p_code, p_name, p_requires_mfa)
  returning id into v_id;
  insert into public.role_permissions (role_id, permission_code) select v_id, unnest(p_permissions);
  return v_id;
end $$;

-- Suspensión de cuentas comprometidas (sistema 49)
create or replace function public.set_profile_status(p_user uuid, p_status public.profile_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() and not exists (
      select 1 from public.memberships m where m.user_id = p_user and m.status = 'active'
        and private.has_permission(m.organization_id, 'security.admin') and private.current_aal() = 'aal2') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Debe indicar un motivo' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.profiles set status = p_status, status_reason = p_reason where id = p_user;
  insert into public.system_events (user_id, event_type, severity, details)
  values (p_user, 'account_status_changed', 'warning', jsonb_build_object('status', p_status, 'by', auth.uid()));
end $$;

-- Creación de institución con su primer propietario (transacción única)
create or replace function public.create_organization(
  p_slug text, p_legal_name text, p_display_name text, p_country char(2), p_currency text,
  p_timezone text, p_owner uuid, p_tax_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_role uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el superadministrador puede crear instituciones' using errcode = '42501';
  end if;
  insert into public.organizations (slug, legal_name, display_name, country_code, base_currency, timezone, tax_id)
  values (p_slug, p_legal_name, p_display_name, p_country, p_currency, p_timezone, p_tax_id)
  returning id into v_org;
  select id into v_role from public.roles where organization_id is null and code = 'propietario_institucional';
  insert into public.memberships (user_id, organization_id, role_id, granted_by) values (p_owner, v_org, v_role, auth.uid());
  return v_org;
end $$;

-- ---------------------------------------------------------------------
-- Auditoría de tablas de esta migración y la anterior
-- ---------------------------------------------------------------------
create trigger audit_organizations after insert or update or delete on public.organizations for each row execute function private.audit_row('id');
create trigger audit_campuses      after insert or update or delete on public.campuses      for each row execute function private.audit_row();
create trigger audit_departments   after insert or update or delete on public.departments   for each row execute function private.audit_row();
create trigger audit_rooms         after insert or update or delete on public.rooms         for each row execute function private.audit_row();
create trigger audit_org_settings  after insert or update or delete on public.organization_settings for each row execute function private.audit_row();
create trigger audit_exchange      after insert or update or delete on public.exchange_rates for each row execute function private.audit_row('none');
create trigger audit_profiles      after update or delete on public.profiles for each row execute function private.audit_row('none');
create trigger audit_roles         after insert or update or delete on public.roles for each row execute function private.audit_row();
create trigger audit_memberships   after insert or update or delete on public.memberships for each row execute function private.audit_row();

-- Los permisos de un rol se auditan con la institución del rol
create or replace function private.audit_role_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.role_permissions := coalesce(new, old); v_org uuid;
begin
  select organization_id into v_org from public.roles where id = v_row.role_id;
  perform private.write_audit(v_org, 'role_permissions', v_row.role_id::text || ':' || v_row.permission_code,
    tg_op, null, case when tg_op = 'DELETE' then to_jsonb(old) end, case when tg_op = 'INSERT' then to_jsonb(new) end);
  return null;
end $$;
create trigger audit_role_permissions after insert or delete on public.role_permissions
  for each row execute function private.audit_role_permissions();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.countries             enable row level security;
alter table public.currencies            enable row level security;
alter table public.exchange_rates        enable row level security;
alter table public.regional_settings     enable row level security;
alter table public.organizations         enable row level security;
alter table public.campuses              enable row level security;
alter table public.departments           enable row level security;
alter table public.rooms                 enable row level security;
alter table public.organization_settings enable row level security;
alter table public.authorities           enable row level security;
alter table public.profiles              enable row level security;
alter table public.permissions           enable row level security;
alter table public.roles                 enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.memberships           enable row level security;
alter table public.audit_events          enable row level security;
alter table public.system_events         enable row level security;
alter table public.integration_events    enable row level security;

-- Catálogos globales: lectura para usuarios autenticados, escritura superadmin
create policy countries_read  on public.countries  for select to authenticated using (true);
create policy countries_write on public.countries  for all    to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy currencies_read  on public.currencies for select to authenticated using (true);
create policy currencies_write on public.currencies for all    to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy regional_read  on public.regional_settings for select to authenticated using (true);
create policy regional_write on public.regional_settings for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy fx_read   on public.exchange_rates for select to authenticated using (true);
create policy fx_insert on public.exchange_rates for insert to authenticated
  with check (private.is_platform_admin() or exists (
    select 1 from public.memberships m where m.user_id = (select auth.uid()) and private.has_permission(m.organization_id, 'finance.admin')));

-- Instituciones
create policy org_read on public.organizations for select to authenticated
  using (private.is_member(id) or private.is_platform_admin());
create policy org_update on public.organizations for update to authenticated
  using (private.has_permission(id, 'organization.admin') or private.is_platform_admin())
  with check (private.has_permission(id, 'organization.admin') or private.is_platform_admin());

-- Estructura institucional (sedes, departamentos, salas, autoridades)
create policy campus_read  on public.campuses for select to authenticated using (private.is_member(organization_id));
create policy campus_ins   on public.campuses for insert to authenticated with check (private.has_permission(organization_id, 'organization.admin'));
create policy campus_upd   on public.campuses for update to authenticated
  using (private.has_permission(organization_id, 'organization.admin', id)) with check (private.has_permission(organization_id, 'organization.admin', id));

create policy dept_read on public.departments for select to authenticated using (private.is_member(organization_id));
create policy dept_ins  on public.departments for insert to authenticated with check (private.has_permission(organization_id, 'organization.admin', campus_id));
create policy dept_upd  on public.departments for update to authenticated
  using (private.has_permission(organization_id, 'organization.admin', campus_id)) with check (private.has_permission(organization_id, 'organization.admin', campus_id));

create policy rooms_read on public.rooms for select to authenticated using (private.is_member(organization_id));
create policy rooms_ins  on public.rooms for insert to authenticated with check (private.has_permission(organization_id, 'organization.admin', campus_id));
create policy rooms_upd  on public.rooms for update to authenticated
  using (private.has_permission(organization_id, 'organization.admin', campus_id)) with check (private.has_permission(organization_id, 'organization.admin', campus_id));

create policy auth_read on public.authorities for select to authenticated using (private.is_member(organization_id));
create policy auth_ins  on public.authorities for insert to authenticated with check (private.has_permission(organization_id, 'organization.admin'));
create policy auth_upd  on public.authorities for update to authenticated
  using (private.has_permission(organization_id, 'organization.admin')) with check (private.has_permission(organization_id, 'organization.admin'));

create policy settings_read  on public.organization_settings for select to authenticated using (private.is_member(organization_id));
create policy settings_write on public.organization_settings for insert to authenticated with check (private.has_permission(organization_id, 'settings.admin'));
create policy settings_upd   on public.organization_settings for update to authenticated
  using (private.has_permission(organization_id, 'settings.admin')) with check (private.has_permission(organization_id, 'settings.admin'));

-- Perfiles: el propio, o usuarios de instituciones donde se tiene users.view
create policy profiles_self on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.can_view_user(id) or private.is_platform_admin());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Seguridad
create policy perms_read on public.permissions for select to authenticated using (true);
create policy roles_read on public.roles for select to authenticated
  using (organization_id is null or private.is_member(organization_id));
create policy role_perms_read on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and (r.organization_id is null or private.is_member(r.organization_id))));
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission(organization_id, 'users.view') or private.is_platform_admin());

-- Auditoría y eventos: solo lectura para auditores / seguridad
create policy audit_read on public.audit_events for select to authenticated
  using (private.has_permission(organization_id, 'audit.view') or private.is_platform_admin());
create policy sysev_read on public.system_events for select to authenticated
  using (user_id = (select auth.uid())
         or (organization_id is not null and private.has_permission(organization_id, 'audit.view'))
         or private.is_platform_admin());
create policy integ_read on public.integration_events for select to authenticated
  using (private.is_platform_admin() or (organization_id is not null and private.has_permission(organization_id, 'audit.view')));
