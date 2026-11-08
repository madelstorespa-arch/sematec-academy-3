-- =====================================================================
-- Centro de Ciberseguridad SEMATEC: panorama de seguridad, alertas,
-- sesiones activas, bloqueo de cuentas e incidentes. Nunca expone
-- contraseñas, secretos MFA ni tokens.
-- =====================================================================

create or replace function private.can_secure(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin()
      or (private.has_permission(p_org, 'security.admin') and private.current_aal() = 'aal2')
$$;
create or replace function private.can_see_security(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_secure(p_org) or private.has_permission(p_org, 'audit.view')
$$;
grant execute on function private.can_secure(uuid), private.can_see_security(uuid) to authenticated;

-- Usuarios de la institución (para acotar todo a su propia organización)
create or replace function private.org_user_ids(p_org uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct user_id from public.memberships where organization_id = p_org
$$;

-- ---------------------------------------------------------------------
-- Panorama de seguridad
-- ---------------------------------------------------------------------
create or replace function public.security_overview(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.can_see_security(p_org) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'members', (select count(*) from private.org_user_ids(p_org)),
    'admins_without_mfa', coalesce((
      select jsonb_agg(distinct jsonb_build_object('user_id', p.id, 'name', p.full_name, 'email', p.email, 'role', r.name))
      from public.memberships m join public.roles r on r.id = m.role_id and r.requires_mfa
      join public.profiles p on p.id = m.user_id
      where m.organization_id = p_org and m.status = 'active'
        and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')), '[]'::jsonb),
    'privileged', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.full_name, 'email', p.email, 'role', r.name, 'status', p.status,
               'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
               'last_sign_in', (select u.last_sign_in_at from auth.users u where u.id = p.id)) order by r.name)
      from public.memberships m join public.roles r on r.id = m.role_id and r.requires_mfa
      join public.profiles p on p.id = m.user_id
      where m.organization_id = p_org and m.status = 'active'), '[]'::jsonb),
    'locked_list', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'status_reason', p.status_reason))
                      from public.profiles p where p.id in (select private.org_user_ids(p_org)) and p.status = 'locked'), '[]'::jsonb),
    'locked', (select count(*) from public.profiles where id in (select private.org_user_ids(p_org)) and status = 'locked'),
    'suspended', (select count(*) from public.profiles where id in (select private.org_user_ids(p_org)) and status not in ('active','locked')),
    'failed_logins_24h', (select count(*) from public.system_events e where e.event_type = 'login_failed' and e.occurred_at > now() - interval '24 hours'
                          and (e.user_id in (select private.org_user_ids(p_org)) or e.organization_id = p_org)),
    'unknown_email_failures_24h', (select count(*) from public.system_events e where e.event_type = 'login_failed' and e.user_id is null
                          and e.occurred_at > now() - interval '24 hours'),
    'active_sessions', (select count(*) from auth.sessions s where s.user_id in (select private.org_user_ids(p_org))
                          and (s.not_after is null or s.not_after > now()) and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '7 days'),
    'critical_7d', (select count(*) from public.system_events e where e.severity = 'critical' and e.occurred_at > now() - interval '7 days'
                    and (e.organization_id = p_org or e.user_id in (select private.org_user_ids(p_org)))),
    'grade_changes_7d', (select count(*) from public.audit_events a where a.organization_id = p_org and a.table_name = 'grades'
                         and a.operation in ('UPDATE','DELETE') and a.occurred_at > now() - interval '7 days'),
    'certificates_tampered', (select count(*) from public.certificates c where c.organization_id = p_org
                         and c.content_hash <> encode(extensions.digest(c.verification_code || '|' || c.payload::text, 'sha256'), 'hex')),
    'open_incidents', (select count(*) from public.security_incidents i where i.organization_id = p_org and i.status <> 'cerrado'),
    'role_changes_7d', (select count(*) from public.audit_events a where a.organization_id = p_org and a.table_name in ('memberships','role_permissions')
                        and a.occurred_at > now() - interval '7 days')
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Alertas (eventos de seguridad de la institución y de sus usuarios)
-- ---------------------------------------------------------------------
create or replace function public.security_alerts(p_org uuid, p_days int default 7)
returns table (id bigint, occurred_at timestamptz, event_type text, severity text, email text, full_name text, ip text, user_agent text, details jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id, e.occurred_at, e.event_type, e.severity, coalesce(p.email, e.details ->> 'email'), p.full_name,
         host(e.ip_address), left(e.user_agent, 120), e.details - 'secret' - 'token' - 'password'
  from public.system_events e left join public.profiles p on p.id = e.user_id
  where private.can_see_security(p_org)
    and e.occurred_at > now() - make_interval(days => least(greatest(p_days, 1), 90))
    and (e.organization_id = p_org or e.user_id in (select private.org_user_ids(p_org)))
  order by e.occurred_at desc limit 500
$$;

-- ---------------------------------------------------------------------
-- Sesiones activas y respuesta: cerrar sesiones, bloquear / desbloquear
-- ---------------------------------------------------------------------
create or replace function public.security_sessions(p_org uuid)
returns table (session_id uuid, user_id uuid, full_name text, email text, created_at timestamptz, last_active timestamptz, aal text, ip text, user_agent text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, p.full_name, p.email, s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at),
         s.aal::text, host(s.ip), left(s.user_agent, 160)
  from auth.sessions s join public.profiles p on p.id = s.user_id
  where private.can_secure(p_org) and s.user_id in (select private.org_user_ids(p_org))
    and (s.not_after is null or s.not_after > now())
    and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '7 days'
  order by 6 desc limit 500
$$;

create or replace function public.security_revoke_sessions(p_org uuid, p_user uuid, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.can_secure(p_org) then raise exception 'No autorizado (requiere permiso de seguridad y MFA)' using errcode = '42501'; end if;
  if p_user not in (select private.org_user_ids(p_org)) then raise exception 'Usuario fuera de la institución' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = p_user and is_platform_admin) and not private.is_platform_admin() then
    raise exception 'No puede cerrar sesiones de un superadministrador' using errcode = '42501';
  end if;
  update auth.refresh_tokens set revoked = true where user_id = p_user::text and not coalesce(revoked, false);
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  insert into public.system_events (organization_id, user_id, event_type, severity, details)
  values (p_org, p_user, 'sessions_revoked', 'warning', jsonb_build_object('by', auth.uid(), 'sessions', n, 'reason', left(p_reason, 300)));
  return n;
end $$;

create or replace function public.security_set_account(p_org uuid, p_user uuid, p_lock boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_secure(p_org) then raise exception 'No autorizado (requiere permiso de seguridad y MFA)' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'No puede bloquear su propia cuenta' using errcode = '22023'; end if;
  if p_user not in (select private.org_user_ids(p_org)) then raise exception 'Usuario fuera de la institución' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = p_user and is_platform_admin) and not private.is_platform_admin() then
    raise exception 'No puede bloquear a un superadministrador' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 4 then raise exception 'Indique el motivo' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  if p_lock then
    update public.profiles set status = 'locked', status_reason = left('Bloqueo de seguridad: ' || p_reason, 300) where id = p_user;
    update auth.refresh_tokens set revoked = true where user_id = p_user::text and not coalesce(revoked, false);
    delete from auth.sessions where user_id = p_user;
  else
    update public.profiles set status = 'active', status_reason = null where id = p_user and status = 'locked';
  end if;
  insert into public.system_events (organization_id, user_id, event_type, severity, details)
  values (p_org, p_user, case when p_lock then 'account_locked' else 'account_unlocked' end, case when p_lock then 'critical' else 'info' end,
          jsonb_build_object('by', auth.uid(), 'reason', left(p_reason, 300)));
end $$;

-- ---------------------------------------------------------------------
-- Gestión de incidentes
-- ---------------------------------------------------------------------
create table public.security_incidents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  number          bigint not null,
  title           text not null check (length(title) between 4 and 200),
  severity        text not null default 'media' check (severity in ('baja','media','alta','critica')),
  category        text not null default 'otro' check (category in ('acceso_indebido','fraude','fuga_datos','malware_phishing','disponibilidad','alteracion_datos','otro')),
  status          text not null default 'abierto' check (status in ('abierto','investigando','contenido','cerrado')),
  description     text check (length(description) <= 8000),
  affected_user   uuid references public.profiles(id),
  log             jsonb not null default '[]'::jsonb,
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz,
  unique (organization_id, number)
);
create trigger trg_inc_updated before update on public.security_incidents for each row execute function private.set_updated_at();
create trigger audit_incidents after insert or update or delete on public.security_incidents for each row execute function private.audit_row();
alter table public.security_incidents enable row level security;
create policy inc_select on public.security_incidents for select to authenticated using (private.can_see_security(organization_id));
grant select on public.security_incidents to authenticated;
grant all on public.security_incidents to service_role;

create or replace function public.security_open_incident(p_org uuid, p_title text, p_severity text, p_category text, p_description text, p_user uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_num bigint;
begin
  if not private.can_secure(p_org) then raise exception 'No autorizado (requiere permiso de seguridad y MFA)' using errcode = '42501'; end if;
  v_num := private.next_number(p_org, 'security_incident');
  insert into public.security_incidents (organization_id, number, title, severity, category, description, affected_user, log)
  values (p_org, v_num, trim(p_title), p_severity, p_category, nullif(trim(p_description), ''), p_user,
          jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'status', 'abierto', 'note', 'Incidente registrado')));
  insert into public.system_events (organization_id, user_id, event_type, severity, details)
  values (p_org, auth.uid(), 'incident_opened', case when p_severity in ('alta','critica') then 'critical' else 'warning' end,
          jsonb_build_object('number', v_num, 'title', left(p_title, 120)));
  return v_num;
end $$;

create or replace function public.security_update_incident(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.security_incidents;
begin
  select * into i from public.security_incidents where id = p_id for update;
  if not found or not private.can_secure(i.organization_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_status not in ('abierto','investigando','contenido','cerrado') then raise exception 'Estado inválido' using errcode = '22023'; end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Escriba qué se hizo (bitácora)' using errcode = '22023'; end if;
  update public.security_incidents
     set status = p_status, closed_at = case when p_status = 'cerrado' then now() else null end,
         log = log || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(), 'status', p_status, 'note', left(trim(p_note), 2000)))
   where id = p_id;
end $$;

revoke all on function public.security_overview(uuid), public.security_alerts(uuid, int), public.security_sessions(uuid),
  public.security_revoke_sessions(uuid, uuid, text), public.security_set_account(uuid, uuid, boolean, text),
  public.security_open_incident(uuid, text, text, text, text, uuid), public.security_update_incident(uuid, text, text) from public, anon;
grant execute on function public.security_overview(uuid), public.security_alerts(uuid, int), public.security_sessions(uuid),
  public.security_revoke_sessions(uuid, uuid, text), public.security_set_account(uuid, uuid, boolean, text),
  public.security_open_incident(uuid, text, text, text, text, uuid), public.security_update_incident(uuid, text, text) to authenticated;
