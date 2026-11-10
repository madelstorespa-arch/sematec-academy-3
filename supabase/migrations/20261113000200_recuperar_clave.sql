-- =====================================================================
-- 🔑 Recuperar contraseña para TODOS los usuarios:
--  · por correo o por RUT (como al entrar);
--  · si la persona no tiene correo o no le llega, envía una solicitud a la
--    administración, que le da una contraseña temporal o le reenvía el enlace.
-- =====================================================================

/** Cuenta a partir del correo o del RUT/documento (solo el servidor). */
create or replace function public.find_account(p_identifier text)
returns table (user_id uuid, email text, full_name text, status text, organization_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_identifier, ''));
begin
  if v = '' then return; end if;
  return query
  select p.id, p.email, p.full_name, p.status::text,
         (select m.organization_id from public.memberships m where m.user_id = p.id and m.status = 'active' order by m.created_at limit 1)
    from public.profiles p
   where (position('@' in v) > 0 and lower(p.email) = lower(v))
      or (position('@' in v) = 0 and length(regexp_replace(v, '[^0-9Kk]', '', 'g')) >= 5
          and upper(regexp_replace(p.id_document_number, '[^0-9Kk]', '', 'g')) = upper(regexp_replace(v, '[^0-9Kk]', '', 'g')))
   limit 1;
end $$;
revoke all on function public.find_account(text) from public, anon, authenticated;
grant execute on function public.find_account(text) to service_role;

create table if not exists public.password_help_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete cascade,
  identifier      text not null check (length(identifier) between 3 and 254),
  full_name       text not null check (length(btrim(full_name)) between 3 and 160),
  contact         text not null check (length(btrim(contact)) between 5 and 160),
  message         text check (length(message) <= 1000),
  reason          text not null default 'sin_correo' check (reason in ('sin_correo','no_llega','mfa','otro')),
  status          text not null default 'pendiente' check (status in ('pendiente','resuelta','descartada')),
  ip              inet,
  created_at      timestamptz not null default now(),
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  resolution      text check (length(resolution) <= 300)
);
create index if not exists pwhelp_org_idx on public.password_help_requests (organization_id, status, created_at desc);
alter table public.password_help_requests enable row level security;
revoke all on public.password_help_requests from anon, authenticated;
grant select, update on public.password_help_requests to authenticated;
grant all on public.password_help_requests to service_role;
drop policy if exists pwhelp_admin on public.password_help_requests;
create policy pwhelp_admin on public.password_help_requests for all to authenticated
  using (organization_id is not null and (private.is_owner(organization_id) or private.has_permission(organization_id, 'security.admin') or private.has_permission(organization_id, 'users.admin')))
  with check (organization_id is not null and (private.is_owner(organization_id) or private.has_permission(organization_id, 'security.admin') or private.has_permission(organization_id, 'users.admin')));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_password_help_requests') then
    create trigger audit_password_help_requests after insert or update or delete on public.password_help_requests for each row execute function private.audit_row();
  end if;
end $$;

/** Límite: 3 solicitudes de ayuda por hora por IP o por identificador. */
create or replace function public.password_help_limited(p_ip inet, p_identifier text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.password_help_requests where created_at > now() - interval '1 hour'
           and (ip = p_ip or lower(identifier) = lower(btrim(p_identifier)))) >= 3
$$;
revoke all on function public.password_help_limited(inet, text) from public, anon, authenticated;
grant execute on function public.password_help_limited(inet, text) to service_role;
