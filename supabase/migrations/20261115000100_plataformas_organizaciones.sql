-- =====================================================================
-- Plataformas para otras organizaciones dentro del aula virtual:
--  · cada organización es un espacio aislado (usuarios, salas, grabaciones, marca)
--  · tipo de plataforma: «aula» (solo aula virtual) o «completo» (todo el sistema)
--  · solicitudes de registro públicas que el dueño de la plataforma aprueba
--  · directorio de plataformas independientes (con su propia base de datos)
-- =====================================================================

-- ---------- Tipo de plataforma de cada organización ----------
alter table public.organizations add column if not exists platform_mode text not null default 'completo'
  check (platform_mode in ('completo', 'aula'));
alter table public.organizations add column if not exists org_kind text not null default 'institucion'
  check (org_kind in ('institucion', 'instituto', 'colegio', 'universidad', 'asociacion', 'organizacion', 'empresa', 'fundacion', 'iglesia', 'otro'));

-- Las organizaciones suspendidas desaparecen para sus miembros (el superadministrador las sigue viendo)
create or replace function public.my_organizations()
returns table (organization_id uuid, display_name text, slug text, roles text[], requires_mfa boolean)
language sql stable security definer set search_path = '' as $$
  select o.id, o.display_name, o.slug, array_agg(distinct r.name order by r.name), bool_or(r.requires_mfa)
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.status = 'active'
     and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
     and private.current_user_active()
     and (o.status = 'active' or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin))
   group by o.id, o.display_name, o.slug
   order by o.display_name
$$;

-- ---------- Crear organización (con tipo de plataforma y marca inicial) ----------
drop function if exists public.create_organization(text, text, text, char, text, text, uuid, text);
create or replace function public.create_organization(
  p_slug text, p_legal_name text, p_display_name text, p_country char(2), p_currency text,
  p_timezone text, p_owner uuid, p_tax_id text default null, p_mode text default 'completo', p_kind text default 'institucion')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_role uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el superadministrador puede crear instituciones' using errcode = '42501';
  end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'El enlace solo admite minúsculas, números y guiones (2 a 63 caracteres)' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations where slug = p_slug) then
    raise exception 'Ya existe una organización con el enlace «%»', p_slug using errcode = '23505';
  end if;
  insert into public.organizations (slug, legal_name, display_name, country_code, base_currency, timezone, tax_id, platform_mode, org_kind)
  values (p_slug, p_legal_name, p_display_name, p_country, p_currency, p_timezone, nullif(btrim(p_tax_id), ''),
          coalesce(p_mode, 'completo'), coalesce(p_kind, 'institucion'))
  returning id into v_org;
  select id into v_role from public.roles where organization_id is null and code = 'propietario_institucional';
  insert into public.memberships (user_id, organization_id, role_id, granted_by) values (p_owner, v_org, v_role, auth.uid());
  -- Marca propia desde el primer día (el propietario la cambia en «Sitio web y marca»)
  insert into public.site_settings (organization_id, site_name) values (v_org, p_display_name) on conflict do nothing;
  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text, char, text, text, uuid, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, char, text, text, uuid, text, text, text) to authenticated;

-- ---------- Cambiar tipo o suspender (solo superadministrador) ----------
create or replace function public.set_organization_platform(p_org uuid, p_mode text default null, p_status public.record_status default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_mode is not null and p_mode not in ('completo', 'aula') then raise exception 'Tipo de plataforma inválido' using errcode = '22023'; end if;
  update public.organizations set platform_mode = coalesce(p_mode, platform_mode), status = coalesce(p_status, status), updated_at = now()
   where id = p_org;
  if not found then raise exception 'Organización no encontrada' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_organization_platform(uuid, text, public.record_status) from public, anon;
grant execute on function public.set_organization_platform(uuid, text, public.record_status) to authenticated;

-- ---------- Resumen de todas las organizaciones (solo superadministrador) ----------
create or replace function public.platform_overview()
returns table (id uuid, slug text, display_name text, legal_name text, platform_mode text, org_kind text, status public.record_status,
               country_code char(2), created_at timestamptz, members bigint, rooms bigint, sessions bigint, recordings bigint, owner_names text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select o.id, o.slug, o.display_name, o.legal_name, o.platform_mode, o.org_kind, o.status, o.country_code, o.created_at,
         (select count(distinct m.user_id) from public.memberships m where m.organization_id = o.id and m.status = 'active'),
         (select count(*) from public.conference_rooms r where r.organization_id = o.id),
         (select count(*) from public.conference_sessions s where s.organization_id = o.id),
         (select count(*) from public.conference_recordings g where g.organization_id = o.id),
         (select string_agg(distinct p.full_name, ', ') from public.memberships m
            join public.roles r on r.id = m.role_id and r.code = 'propietario_institucional'
            join public.profiles p on p.id = m.user_id
           where m.organization_id = o.id and m.status = 'active')
    from public.organizations o
   order by o.created_at;
end $$;
revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

-- ---------- Solicitudes de registro de organizaciones ----------
create table if not exists public.org_signup_requests (
  id              uuid primary key default gen_random_uuid(),
  org_name        text not null check (length(btrim(org_name)) between 2 and 200),
  org_kind        text not null default 'organizacion'
                  check (org_kind in ('institucion', 'instituto', 'colegio', 'universidad', 'asociacion', 'organizacion', 'empresa', 'fundacion', 'iglesia', 'otro')),
  wants           text not null default 'aula' check (wants in ('aula', 'completo', 'independiente')),
  contact_name    text not null check (length(btrim(contact_name)) between 2 and 120),
  contact_email   text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254),
  phone           text check (phone is null or length(phone) <= 40),
  country_code    char(2) not null default 'CL' references public.countries(code),
  members_estimate int check (members_estimate is null or members_estimate between 1 and 1000000),
  message         text check (message is null or length(message) <= 2000),
  status          text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  organization_id uuid references public.organizations(id),
  decision_note   text check (decision_note is null or length(decision_note) <= 1000),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  ip              inet,
  created_at      timestamptz not null default now()
);
create index if not exists org_signup_status_idx on public.org_signup_requests (status, created_at desc);
alter table public.org_signup_requests enable row level security;
-- Solo el superadministrador las ve; se crean desde el servidor (formulario público con límite)
create policy orgreq_admin_read on public.org_signup_requests for select to authenticated using (private.is_platform_admin());
revoke all on public.org_signup_requests from anon, authenticated;
grant select on public.org_signup_requests to authenticated;
grant all on public.org_signup_requests to service_role;

-- Límite anti-abuso: 3 por hora por IP o correo, 60 por hora en total
create or replace function public.org_signup_limited(p_ip inet, p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.org_signup_requests where created_at > now() - interval '1 hour'
           and (ip = p_ip or lower(contact_email) = lower(btrim(p_email)))) >= 3
      or (select count(*) from public.org_signup_requests where created_at > now() - interval '1 hour') >= 60
$$;
revoke all on function public.org_signup_limited(inet, text) from public, anon, authenticated;
grant execute on function public.org_signup_limited(inet, text) to service_role;

create or replace function public.decide_org_request(p_request uuid, p_approve boolean, p_org uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.org_signup_requests
     set status = case when p_approve then 'aprobada' else 'rechazada' end,
         organization_id = p_org, decision_note = nullif(btrim(p_note), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_request and status = 'pendiente';
  if not found then raise exception 'La solicitud ya fue resuelta o no existe' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.decide_org_request(uuid, boolean, uuid, text) from public, anon;
grant execute on function public.decide_org_request(uuid, boolean, uuid, text) to authenticated;

-- ---------- Directorio de plataformas independientes (otra base de datos, otro despliegue) ----------
create table if not exists public.external_platforms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 200),
  url           text not null check (url ~ '^https://[a-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$' and length(url) <= 300),
  contact_name  text check (contact_name is null or length(contact_name) <= 120),
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes         text check (notes is null or length(notes) <= 2000),
  status        text not null default 'activa' check (status in ('activa', 'en_instalacion', 'suspendida')),
  request_id    uuid references public.org_signup_requests(id),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
alter table public.external_platforms enable row level security;
create policy extp_admin on public.external_platforms for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
grant select, insert, update, delete on public.external_platforms to authenticated;
grant all on public.external_platforms to service_role;

create trigger audit_org_signup after update on public.org_signup_requests for each row execute function private.audit_row('none');
create trigger audit_ext_platforms after insert or update or delete on public.external_platforms for each row execute function private.audit_row('none');

-- ---------- Página pública de cada organización (/o/<enlace>) ----------
create or replace function public.org_landing(p_slug text)
returns table (id uuid, display_name text, platform_mode text, site_name text, tagline text, logo_asset_id uuid, primary_color text, accent_color text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.display_name, o.platform_mode, s.site_name, s.tagline, s.logo_asset_id, s.primary_color, s.accent_color
    from public.organizations o left join public.site_settings s on s.organization_id = o.id
   where o.slug = lower(btrim(p_slug)) and o.status = 'active'
$$;
revoke all on function public.org_landing(text) from public;
grant execute on function public.org_landing(text) to anon, authenticated;
