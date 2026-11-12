-- =====================================================================
-- Recuperar contraseña con CUALQUIER correo registrado de una cuenta activa
-- Busca la cuenta por:
--   · correo del perfil o correo de inicio de sesión (auth)
--   · correo registrado en la ficha de estudiante, profesor o funcionario vinculada a la cuenta
--   · RUT o documento de identidad (perfil o fichas)
-- Devuelve también a qué correo enviar el enlace: el mismo que escribió la persona
-- (si está registrado para esa cuenta) o el correo principal de la cuenta.
-- =====================================================================
drop function if exists public.find_account(text);
create function public.find_account(p_identifier text)
returns table (user_id uuid, email text, full_name text, status text, organization_id uuid, login_email text, send_to text)
language plpgsql stable security definer set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_identifier, ''))); d text; uid uuid;
begin
  if v = '' then return; end if;
  if position('@' in v) > 0 then
    select x.uid into uid from (
      select p.id uid, 1 o from public.profiles p where lower(btrim(p.email)) = v
      union all select u.id, 2 from auth.users u where lower(u.email) = v
      union all select s.user_id, 3 from public.students s where s.user_id is not null and lower(btrim(s.email)) = v
      union all select t.user_id, 4 from public.teachers t where t.user_id is not null and lower(btrim(t.email)) = v
      union all select e.user_id, 5 from public.employees e where e.user_id is not null and lower(btrim(e.email)) = v
    ) x join public.profiles p on p.id = x.uid order by x.o limit 1;
  else
    d := upper(regexp_replace(v, '[^0-9Kk]', '', 'g'));
    if length(d) < 5 then return; end if;
    select x.uid into uid from (
      select p.id uid, 1 o from public.profiles p where upper(regexp_replace(coalesce(p.id_document_number, ''), '[^0-9Kk]', '', 'g')) = d
      union all select s.user_id, 2 from public.students s where s.user_id is not null and upper(regexp_replace(coalesce(s.id_document_number, ''), '[^0-9Kk]', '', 'g')) = d
      union all select t.user_id, 3 from public.teachers t where t.user_id is not null and upper(regexp_replace(coalesce(t.id_document_number, ''), '[^0-9Kk]', '', 'g')) = d
    ) x join public.profiles p on p.id = x.uid order by x.o limit 1;
  end if;
  if uid is null then return; end if;
  return query
  select p.id, p.email, p.full_name, p.status::text,
         (select m.organization_id from public.memberships m where m.user_id = p.id and m.status = 'active' order by m.created_at limit 1),
         u.email::text,
         case when position('@' in v) > 0 then v else coalesce(nullif(lower(btrim(p.email)), ''), lower(u.email)) end
    from public.profiles p join auth.users u on u.id = p.id
   where p.id = uid;
end $$;
revoke all on function public.find_account(text) from public, anon, authenticated;
grant execute on function public.find_account(text) to service_role;
