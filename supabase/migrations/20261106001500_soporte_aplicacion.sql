-- =====================================================================
-- Migración 015 · Funciones de apoyo para la aplicación SEMATEC ACADEMY
-- =====================================================================

-- Instituciones del usuario con indicador de si alguno de sus roles exige MFA
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
   group by o.id, o.display_name, o.slug
   order by o.display_name
$$;

-- Permisos efectivos del usuario en una institución (considera MFA y vigencia)
create or replace function public.my_permissions(p_org uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  select distinct rp.permission_code
    from public.memberships m
    join public.roles r on r.id = m.role_id
    join public.role_permissions rp on rp.role_id = r.id
   where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
     and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
     and (not r.requires_mfa or private.current_aal() = 'aal2')
     and private.current_user_active()
$$;

-- Búsqueda de usuario por correo para el administrador institucional
create or replace function public.find_profile_by_email(p_org uuid, p_email text)
returns table (id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_permission(p_org, 'security.admin') or private.is_platform_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query select p.id, p.full_name, p.email from public.profiles p where lower(p.email) = lower(trim(p_email));
end $$;

revoke all on function public.my_organizations(), public.my_permissions(uuid), public.find_profile_by_email(uuid, text) from public, anon;
grant execute on function public.my_organizations(), public.my_permissions(uuid), public.find_profile_by_email(uuid, text) to authenticated;

-- Acceso al portal: vincula la ficha con la cuenta y otorga el rol base.
-- Requiere permiso de edición sobre la ficha (no requiere security.admin
-- porque los roles 'estudiante' y 'profesor' no otorgan permisos administrativos).
create or replace function public.link_person_account(p_kind text, p_person uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_campus uuid; v_role uuid; v_role_code text;
begin
  if p_kind = 'student' then
    select organization_id, campus_id into v_org, v_campus from public.students where id = p_person;
    if v_org is null or not private.has_permission(v_org, 'students.edit', v_campus) then
      raise exception 'No autorizado' using errcode = '42501';
    end if;
    update public.students set user_id = p_user where id = p_person;
    v_role_code := 'estudiante';
  elsif p_kind = 'teacher' then
    select organization_id, campus_id into v_org, v_campus from public.teachers where id = p_person;
    if v_org is null or not private.has_permission(v_org, 'teachers.edit', v_campus) then
      raise exception 'No autorizado' using errcode = '42501';
    end if;
    update public.teachers set user_id = p_user where id = p_person;
    v_role_code := 'profesor';
  else
    raise exception 'Tipo inválido' using errcode = '22023';
  end if;
  select id into v_role from public.roles where organization_id is null and code = v_role_code;
  insert into public.memberships (user_id, organization_id, role_id, granted_by)
  values (p_user, v_org, v_role, auth.uid())
  on conflict (user_id, organization_id, role_id, campus_id) do update set status = 'active', revoked_at = null;
end $$;
revoke all on function public.link_person_account(text, uuid, uuid) from public, anon;
grant execute on function public.link_person_account(text, uuid, uuid) to authenticated;

-- Invitar a una conferencia por correo (las validaciones están en add_conference_participant)
create or replace function public.add_conference_participant_by_email(p_session uuid, p_email text, p_role public.conference_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.can_moderate(p_session) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'No existe un usuario con ese correo' using errcode = 'P0002'; end if;
  perform public.add_conference_participant(p_session, v_user, p_role);
end $$;
revoke all on function public.add_conference_participant_by_email(uuid, text, public.conference_role) from public, anon;
grant execute on function public.add_conference_participant_by_email(uuid, text, public.conference_role) to authenticated;

-- Los estudiantes ven el nombre de los profesores de las secciones en que están inscritos
create policy teachers_read_my_students on public.teachers for select to authenticated
  using (exists (select 1 from public.sections s where s.teacher_id = teachers.id and private.enrolled_in_section(s.id)));
