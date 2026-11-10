-- =====================================================================
-- 🛡 Autorizaciones por usuario (sin tocar código): además de lo que da su
-- rol, a una persona se le puede PERMITIR algo extra o QUITAR un permiso,
-- en todas las sedes o en una, de forma permanente o hasta una fecha.
-- Se aplica en la base de datos (RLS), no solo en las pantallas.
-- =====================================================================

create table if not exists public.user_permissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  effect          text not null check (effect in ('allow','deny')),
  campus_id       uuid references public.campuses(id) on delete cascade,
  valid_until     timestamptz,
  reason          text check (length(reason) <= 300),
  granted_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (organization_id, user_id, permission_code, campus_id)
);
create index if not exists user_permissions_user_idx on public.user_permissions (user_id, organization_id);
alter table public.user_permissions enable row level security;
revoke all on public.user_permissions from anon, authenticated;
grant select on public.user_permissions to authenticated;
grant all on public.user_permissions to service_role;
drop policy if exists uperm_read on public.user_permissions;
create policy uperm_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or private.is_owner(organization_id) or private.has_permission(organization_id, 'security.admin') or private.has_permission(organization_id, 'users.view'));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_user_permissions') then
    create trigger audit_user_permissions after insert or update or delete on public.user_permissions for each row execute function private.audit_row();
  end if;
end $$;

/** Permisos delicados: dados uno a uno, exigen verificación en dos pasos (igual que los roles administrativos). */
create or replace function private.permission_needs_mfa(p_code text) returns boolean
language sql immutable set search_path = '' as $$
  select split_part(p_code, '.', 2) = 'admin' or split_part(p_code, '.', 1) in ('security','users','organization','audit','settings')
$$;

-- Permiso efectivo = (lo da su rol  O  se le autorizó a él)  Y  no se le quitó.
create or replace function private.has_permission(p_org uuid, p_perm text, p_campus uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_user_active()
    and not exists (
      select 1 from public.user_permissions u
       where u.user_id = auth.uid() and u.organization_id = p_org and u.permission_code = p_perm and u.effect = 'deny'
         and (u.valid_until is null or u.valid_until > now())
         and (u.campus_id is null or u.campus_id = p_campus))
    and (
      exists (
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
          and (not r.requires_mfa or private.current_aal() = 'aal2'))
      or exists (
        select 1 from public.user_permissions u
         where u.user_id = auth.uid() and u.organization_id = p_org and u.permission_code = p_perm and u.effect = 'allow'
           and (u.valid_until is null or u.valid_until > now())
           and (u.campus_id is null or p_campus is null or u.campus_id = p_campus)
           and (not private.permission_needs_mfa(p_perm) or private.current_aal() = 'aal2')
           and exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
                        and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())))
    )
$$;

create or replace function public.my_permissions(p_org uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  select code from (
    select rp.permission_code as code
      from public.memberships m
      join public.roles r on r.id = m.role_id
      join public.role_permissions rp on rp.role_id = r.id
     where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
       and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
       and (not r.requires_mfa or private.current_aal() = 'aal2')
    union
    select u.permission_code from public.user_permissions u
     where u.user_id = auth.uid() and u.organization_id = p_org and u.effect = 'allow'
       and (u.valid_until is null or u.valid_until > now())
       and (not private.permission_needs_mfa(u.permission_code) or private.current_aal() = 'aal2')
       and private.is_member(p_org)
  ) x
  where private.current_user_active()
    and not exists (select 1 from public.user_permissions d where d.user_id = auth.uid() and d.organization_id = p_org
                     and d.permission_code = x.code and d.effect = 'deny' and d.campus_id is null
                     and (d.valid_until is null or d.valid_until > now()))
$$;

/**
 * Guarda TODAS las autorizaciones individuales de una persona (reemplaza las anteriores).
 * p_items: [{ "code": "store.edit", "effect": "allow"|"deny" }], con sede, vencimiento y motivo comunes.
 * Reglas: solo el propietario o el encargado de seguridad (con MFA); nadie se autoriza a sí mismo;
 * no se tocan los permisos del propietario; solo se puede dar lo que uno mismo tiene.
 */
create or replace function public.set_user_permissions(p_org uuid, p_user uuid, p_items jsonb,
  p_campus uuid default null, p_valid_until timestamptz default null, p_reason text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare it jsonb; v_code text; v_eff text; n int := 0;
begin
  if not (private.is_owner(p_org) or (private.has_permission(p_org, 'security.admin') and private.current_aal() = 'aal2')) then
    raise exception 'Solo el propietario o el encargado de seguridad (con verificación en dos pasos) pueden dar autorizaciones' using errcode = '42501';
  end if;
  if p_user = auth.uid() and not private.is_platform_admin() then
    raise exception 'No puede cambiar sus propias autorizaciones' using errcode = '42501'; end if;
  if not exists (select 1 from public.memberships m where m.user_id = p_user and m.organization_id = p_org) then
    raise exception 'La persona no pertenece a su institución' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
              where m.user_id = p_user and m.organization_id = p_org and m.status = 'active' and r.code = 'propietario_institucional')
     and not private.is_platform_admin() then
    raise exception 'El propietario ya tiene todos los permisos: no se pueden cambiar' using errcode = '42501'; end if;
  if p_campus is not null and not exists (select 1 from public.campuses c where c.id = p_campus and c.organization_id = p_org) then
    raise exception 'Sede inválida' using errcode = '22023'; end if;
  if p_valid_until is not null and p_valid_until <= now() then
    raise exception 'La fecha de término debe ser futura' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 300 then
    raise exception 'Lista de permisos inválida' using errcode = '22023'; end if;

  delete from public.user_permissions where organization_id = p_org and user_id = p_user;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_code := it ->> 'code'; v_eff := it ->> 'effect';
    if v_eff not in ('allow','deny') or not exists (select 1 from public.permissions p where p.code = v_code) then
      raise exception 'Permiso inválido: %', v_code using errcode = '22023'; end if;
    if v_eff = 'allow' and not private.is_owner(p_org) and not private.has_permission(p_org, v_code) then
      raise exception 'No puede dar un permiso que usted no tiene (%)', v_code using errcode = '42501'; end if;
    insert into public.user_permissions (organization_id, user_id, permission_code, effect, campus_id, valid_until, reason)
    values (p_org, p_user, v_code, v_eff, p_campus, p_valid_until, left(nullif(btrim(p_reason), ''), 300));
    n := n + 1;
  end loop;
  insert into public.system_events (organization_id, user_id, event_type, severity, details)
  values (p_org, p_user, 'user_permissions_changed', 'warning', jsonb_build_object('by', auth.uid(), 'count', n));
  return n;
end $$;
grant execute on function public.set_user_permissions(uuid, uuid, jsonb, uuid, timestamptz, text) to authenticated;
