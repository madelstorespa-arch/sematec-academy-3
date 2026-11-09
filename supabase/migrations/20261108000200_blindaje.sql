-- =====================================================================
-- Blindaje: freno por IP a ataques de fuerza bruta, protección del último
-- propietario y de la continuidad de la administración.
-- =====================================================================

-- Fuerza bruta desde una misma red (muchas cuentas distintas): 20 fallos en 15 minutos
create or replace function public.login_ip_blocked(p_ip inet)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_ip is not null and (
    select count(*) from public.system_events e
    where e.event_type = 'login_failed' and e.ip_address = p_ip and e.occurred_at > now() - interval '15 minutes') >= 20
$$;
revoke all on function public.login_ip_blocked(inet) from public, anon, authenticated;
grant execute on function public.login_ip_blocked(inet) to service_role;

-- Nadie puede dejar a una institución sin propietario activo (ni por error ni por ataque)
create or replace function private.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_left int;
begin
  select id into v_owner from public.roles where organization_id is null and code = 'propietario_institucional';
  if old.role_id <> v_owner or old.status <> 'active' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.status = 'active' and new.role_id = v_owner and (new.valid_until is null or new.valid_until > now()) then return new; end if;
  select count(*) into v_left from public.memberships m
   where m.organization_id = old.organization_id and m.role_id = v_owner and m.status = 'active' and m.id <> old.id
     and (m.valid_until is null or m.valid_until > now());
  if v_left = 0 then
    raise exception 'No se puede quitar al último propietario institucional. Primero asigne el rol a otra persona.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_protect_last_owner on public.memberships;
create trigger trg_protect_last_owner before update or delete on public.memberships
  for each row execute function private.protect_last_owner();

create or replace function private.protect_owner_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'active' and old.status = 'active' and exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id and r.code = 'propietario_institucional'
    where m.user_id = new.id and m.status = 'active'
      and not exists (select 1 from public.memberships m2 where m2.organization_id = m.organization_id and m2.role_id = m.role_id
                      and m2.status = 'active' and m2.user_id <> new.id))
  then
    -- Intentos fallidos contra el único propietario: NO se bloquea su cuenta (un atacante podría dejar
    -- a la institución sin administración); su cuenta ya exige MFA. Queda como alerta crítica.
    if coalesce(new.status_reason, '') like 'Bloqueo por intentos fallidos%' then
      insert into public.system_events (user_id, event_type, severity, details)
      values (new.id, 'owner_bruteforce', 'critical', jsonb_build_object('note', 'Intentos fallidos repetidos contra la cuenta del propietario'));
      new.status := old.status; new.status_reason := old.status_reason;
      return new;
    end if;
    raise exception 'No se puede bloquear ni suspender al único propietario institucional.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_owner_account on public.profiles;
create trigger trg_protect_owner_account before update of status on public.profiles
  for each row execute function private.protect_owner_account();
