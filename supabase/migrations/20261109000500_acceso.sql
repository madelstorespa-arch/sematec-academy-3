-- =====================================================================
-- Acceso: bloqueo TEMPORAL por intentos fallidos (15 min, antes quedaba
-- bloqueada hasta que un administrador la desbloqueara), desbloqueo al
-- recuperar la contraseña por correo y diagnóstico «¿por qué no puede entrar?»
-- =====================================================================
alter table public.profiles add column if not exists locked_until timestamptz;

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
    update public.profiles set status = 'locked', status_reason = 'Bloqueo por intentos fallidos', locked_until = now() + v_window
     where id = v_user and status = 'active';
    if found then
      insert into public.system_events (user_id, event_type, severity, ip_address, details)
      values (v_user, 'account_locked', 'critical', p_ip, jsonb_build_object('failures', v_fails, 'until', now() + v_window));
    end if;
  end if;
  return jsonb_build_object('failures_in_window', v_fails, 'locked', v_user is not null and v_fails >= v_limit);
end $$;

-- Estado de acceso de un correo antes de entrar (lo usa el servidor): desbloquea si ya pasó el tiempo
create or replace function public.login_precheck(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where lower(email) = lower(trim(p_email));
  if p.id is null then return jsonb_build_object('exists', false); end if;
  if p.status = 'locked' and coalesce(p.status_reason, '') like 'Bloqueo por intentos fallidos%'
     and coalesce(p.locked_until, now() - interval '1 second') <= now() then
    update public.profiles set status = 'active', status_reason = null, locked_until = null where id = p.id;
    insert into public.system_events (user_id, event_type, severity, details)
    values (p.id, 'account_unlocked', 'info', jsonb_build_object('by', 'tiempo cumplido'));
    return jsonb_build_object('exists', true, 'status', 'active');
  end if;
  return jsonb_build_object('exists', true, 'status', p.status, 'reason', p.status_reason, 'until', p.locked_until,
    'by_failures', coalesce(p.status_reason, '') like 'Bloqueo por intentos fallidos%');
end $$;

-- Recuperó la contraseña por correo (demostró ser el dueño): se quita el bloqueo por intentos fallidos
create or replace function public.unlock_after_password_reset(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set status = 'active', status_reason = null, locked_until = null
   where id = p_user and status = 'locked' and coalesce(status_reason, '') like 'Bloqueo por intentos fallidos%';
  if found then
    insert into public.system_events (user_id, event_type, severity, details)
    values (p_user, 'account_unlocked', 'info', jsonb_build_object('by', 'recuperación de contraseña'));
  end if;
end $$;

revoke all on function public.login_precheck(text), public.unlock_after_password_reset(uuid) from public, anon, authenticated;
grant execute on function public.login_precheck(text), public.unlock_after_password_reset(uuid) to service_role;

-- 🔎 ¿Por qué no puede entrar? (propietario o seguridad): revisa cuenta, bloqueo, roles, MFA e intentos
create or replace function public.access_diagnosis(p_org uuid, p_email text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles; u record; v_roles jsonb; v_fails int; v_mfa boolean; v_needs_mfa boolean; v_person text;
begin
  if not (private.is_owner(p_org) or private.can_secure(p_org) or private.has_permission(p_org, 'users.view')) then
    raise exception 'Sin permiso para revisar accesos' using errcode = '42501';
  end if;
  select * into p from public.profiles where lower(email) = lower(trim(p_email));
  -- Fichas sin cuenta (estudiante, profesor o funcionario con ese correo)
  select coalesce(
    (select 'estudiante «' || first_names || ' ' || last_names || '»' from public.students where organization_id = p_org and lower(email) = lower(trim(p_email)) limit 1),
    (select 'profesor «' || first_names || ' ' || last_names || '»' from public.teachers where organization_id = p_org and lower(email) = lower(trim(p_email)) limit 1),
    (select 'funcionario «' || first_names || ' ' || last_names || '»' from public.employees where organization_id = p_org and lower(email) = lower(trim(p_email)) limit 1))
  into v_person;
  if p.id is null then
    return jsonb_build_object('exists', false, 'person', v_person);
  end if;
  if p.id not in (select private.org_user_ids(p_org)) and v_person is null then
    return jsonb_build_object('exists', true, 'other_org', true);
  end if;
  select u2.last_sign_in_at, u2.email_confirmed_at, u2.banned_until, u2.encrypted_password is not null and u2.encrypted_password <> '' as has_password
    into u from auth.users u2 where u2.id = p.id;
  select coalesce(jsonb_agg(jsonb_build_object('role', r.name, 'status', m.status, 'until', m.valid_until, 'mfa', r.requires_mfa)), '[]'::jsonb)
    into v_roles from public.memberships m join public.roles r on r.id = m.role_id where m.user_id = p.id and m.organization_id = p_org;
  select exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') into v_mfa;
  select exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
                  where m.user_id = p.id and m.organization_id = p_org and m.status = 'active' and r.requires_mfa)
      or p.is_platform_admin into v_needs_mfa;
  select count(*) into v_fails from public.system_events
   where event_type = 'login_failed' and details ->> 'email' = lower(p.email) and occurred_at > now() - interval '24 hours';
  return jsonb_build_object('exists', true, 'user_id', p.id, 'name', p.full_name, 'status', p.status, 'reason', p.status_reason,
    'locked_until', p.locked_until, 'last_sign_in', u.last_sign_in_at, 'confirmed', u.email_confirmed_at is not null,
    'banned_until', u.banned_until, 'has_password', u.has_password, 'roles', v_roles, 'mfa_enrolled', v_mfa,
    'needs_mfa', v_needs_mfa, 'fails_24h', v_fails, 'person', v_person, 'platform_admin', p.is_platform_admin);
end $$;
revoke all on function public.access_diagnosis(uuid, text) from public, anon;
grant execute on function public.access_diagnosis(uuid, text) to authenticated;
