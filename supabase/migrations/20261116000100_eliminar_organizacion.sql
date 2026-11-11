-- =====================================================================
-- Eliminar una organización completa (solo el superadministrador).
--  · Solo organizaciones suspendidas, de las que él no es miembro, escribiendo su enlace.
--  · Borra todos sus datos; la auditoría de plataforma conserva el registro de la eliminación.
--  · Los registros protegidos (pagos, certificados, notas, último propietario) solo se
--    liberan dentro de esta operación, mediante una marca de la propia transacción.
-- =====================================================================

create or replace function private.org_deletion_active()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('sematec.borrar_org', true), '') <> ''
$$;

-- Registros inmutables: la auditoría jamás se borra; notas y versiones de documentos solo al eliminar la organización
create or replace function private.block_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tg_table_name <> 'audit_events' and private.org_deletion_active() then return old; end if;
  raise exception 'Registro inmutable (%): % no permitido', tg_table_name, tg_op using errcode = '42501';
end $$;

create or replace function private.block_finance_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and private.org_deletion_active() then return old; end if;
  raise exception 'Los registros financieros no se eliminan; use la anulación o el reverso' using errcode = '42501';
end $$;

create or replace function private.guard_certificate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and private.org_deletion_active() then return old; end if;
  if tg_op = 'DELETE' then raise exception 'Los certificados no se eliminan; se revocan' using errcode = '42501'; end if;
  if old.status = 'revoked' then raise exception 'Certificado revocado: inmutable' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['status','revoked_at','revoked_by','revoke_reason','pdf_storage_path'])
     is distinct from (to_jsonb(old) - array['status','revoked_at','revoked_by','revoke_reason','pdf_storage_path']) then
    raise exception 'El contenido de un certificado emitido no puede alterarse' using errcode = '42501';
  end if;
  if old.pdf_storage_path is not null and new.pdf_storage_path is distinct from old.pdf_storage_path then
    raise exception 'El PDF de un certificado no puede reemplazarse' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_left int;
begin
  if tg_op = 'DELETE' and private.org_deletion_active() then return old; end if;
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

create or replace function private.products_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- los movimientos de stock de una venta ya validaron la identidad; la eliminación de la organización tampoco la exige
  if coalesce(current_setting('sematec.stock_ok', true), '') <> '1' and not private.org_deletion_active() then perform private.require_identity(); end if;
  return coalesce(new, old);
end $$;

-- ---------- Resumen de lo que se borrará ----------
create or replace function public.organization_delete_preview(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'id', o.id, 'slug', o.slug, 'name', o.display_name, 'status', o.status, 'mode', o.platform_mode,
    'is_member', exists (select 1 from public.memberships m where m.organization_id = o.id and m.user_id = auth.uid()),
    'members', (select count(distinct user_id) from public.memberships m where m.organization_id = o.id),
    'rooms', (select count(*) from public.conference_rooms r where r.organization_id = o.id),
    'sessions', (select count(*) from public.conference_sessions s where s.organization_id = o.id),
    'recordings', (select count(*) from public.conference_recordings g where g.organization_id = o.id),
    'students', (select count(*) from public.students s where s.organization_id = o.id),
    'files', (select count(*) from public.user_files f where f.organization_id = o.id),
    'payments', (select count(*) from public.payments p where p.organization_id = o.id),
    'certificates', (select count(*) from public.certificates c where c.organization_id = o.id))
  into v from public.organizations o where o.id = p_org;
  if v is null then raise exception 'Organización no encontrada' using errcode = 'P0002'; end if;
  return v;
end $$;
revoke all on function public.organization_delete_preview(uuid) from public, anon;
grant execute on function public.organization_delete_preview(uuid) to authenticated;

-- ---------- Eliminar ----------
create or replace function public.delete_organization(p_org uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations; t record; n bigint; v_total bigint := 0;
  v_pending boolean; v_progress boolean; v_rounds int := 0; v_users uuid[]; v_last text;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el superadministrador con verificación en dos pasos puede eliminar organizaciones' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'Organización no encontrada' using errcode = 'P0002'; end if;
  if v_org.status = 'active' then
    raise exception 'Primero suspenda la organización; luego podrá eliminarla' using errcode = '22023';
  end if;
  if p_confirm is distinct from v_org.slug then
    raise exception 'Para confirmar escriba exactamente el enlace «%»', v_org.slug using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships m where m.organization_id = p_org and m.user_id = auth.uid()) then
    raise exception 'No puede eliminar una organización de la que usted es miembro' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m.user_id), '{}') into v_users from public.memberships m where m.organization_id = p_org;
  -- Queda constancia en la auditoría de la plataforma (que nunca se borra)
  perform private.write_audit(null, 'organizations', p_org::text, 'ACTION', 'organization.delete', to_jsonb(v_org), null,
    'Organización eliminada por el superadministrador');
  perform set_config('sematec.borrar_org', p_org::text, true);
  update public.org_signup_requests set organization_id = null where organization_id = p_org;
  -- Tablas de enlace sin columna de organización
  delete from public.curriculum_courses
   where curriculum_id in (select id from public.curricula where organization_id = p_org)
      or course_id in (select id from public.courses where organization_id = p_org);
  delete from public.course_prerequisites
   where course_id in (select id from public.courses where organization_id = p_org)
      or prerequisite_id in (select id from public.courses where organization_id = p_org);
  update public.profiles set avatar_asset_id = null
   where avatar_asset_id in (select id from public.media_assets where organization_id = p_org);

  -- Borra tabla por tabla; si una depende de otra, se reintenta en la siguiente vuelta
  loop
    v_rounds := v_rounds + 1; v_pending := false; v_progress := false;
    for t in
      select c.table_name from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'organization_id'
         and c.table_name not in ('organizations', 'audit_events', 'org_signup_requests')
       order by c.table_name
    loop
      begin
        execute format('delete from public.%I where organization_id = $1', t.table_name) using p_org;
        get diagnostics n = row_count;
        if n > 0 then v_progress := true; v_total := v_total + n; end if;
      exception when foreign_key_violation then
        v_pending := true; v_last := t.table_name || ': ' || sqlerrm;
      end;
    end loop;
    exit when not v_pending;
    if not v_progress or v_rounds > 40 then
      raise exception 'No se pudo eliminar por completo (%). No se borró nada.', v_last using errcode = '23503';
    end if;
  end loop;

  delete from public.organizations where id = p_org;
  perform set_config('sematec.borrar_org', '', true);
  return jsonb_build_object('rows', v_total, 'users', to_jsonb(v_users), 'slug', v_org.slug, 'name', v_org.display_name);
end $$;
revoke all on function public.delete_organization(uuid, text) from public, anon;
grant execute on function public.delete_organization(uuid, text) to authenticated;

-- Personas que quedaron sin ninguna organización (para borrar sus cuentas si el superadministrador lo pide)
create or replace function public.users_without_organization(p_users uuid[])
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u from unnest(p_users) u
   where private.is_platform_admin()
     and not exists (select 1 from public.memberships m where m.user_id = u)
     and not exists (select 1 from public.profiles p where p.id = u and p.is_platform_admin)
$$;
revoke all on function public.users_without_organization(uuid[]) from public, anon;
grant execute on function public.users_without_organization(uuid[]) to authenticated;
