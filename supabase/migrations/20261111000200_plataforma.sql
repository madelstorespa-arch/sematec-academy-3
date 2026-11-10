-- =====================================================================
-- Plataforma: deshacer/rehacer de verdad (24 horas, ventas completas), libros privados
-- y administración de usuarios por el propietario.
-- =====================================================================

-- ---------- Deshacer / rehacer ----------
-- Las ventas, compras y movimientos de stock quedan registrados para deshacerse completos
do $$ declare t text; begin
  foreach t in array array['sales','sale_items','stock_movements','product_lots','purchases','purchase_items'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function private.audit_row()', t);
    end if;
  end loop;
end $$;

-- El stock solo cambia con movimientos… o al deshacer/rehacer uno
create or replace function private.products_guard_stock() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('sematec.stock_ok', true), '') = '1' or coalesce(current_setting('sematec.audit_reason', true), '') <> '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.stock is distinct from old.stock then new.stock := old.stock;
  elsif tg_op = 'INSERT' then new.stock := 0; end if;
  return new;
end $$;

create or replace function private.undo_table_label(p_table text) returns text language sql immutable set search_path = '' as $f$
select coalesce('{
    "programs":"carrera","courses":"asignatura","sections":"sección","campuses":"sede","departments":"departamento",
    "curricula":"malla curricular","students":"estudiante","teachers":"profesor","employees":"funcionario",
    "catalog_offerings":"curso o carrera del catálogo","job_postings":"oferta laboral","surveys":"encuesta",
    "resources":"recurso","inventory_items":"artículo de inventario","library_items":"libro","announcements":"anuncio",
    "calendar_events":"evento","academic_periods":"periodo académico","offices":"oficina","appointments":"cita",
    "student_requests":"solicitud","guardian_links":"vínculo de apoderado","fee_schedules":"arancel",
    "memberships":"rol de usuario","roles":"rol","role_permissions":"permiso de rol","certificate_templates":"plantilla de certificado",
    "site_settings":"sitio web","organization_settings":"configuración","rooms":"sala","attendance_records":"asistencia",
    "assessments":"evaluación","assignments":"tarea","quizzes":"prueba","quiz_questions":"pregunta","course_units":"unidad",
    "course_contents":"contenido","class_materials":"material de clase","forum_threads":"tema del foro","forum_posts":"mensaje del foro",
    "authorities":"autoridad","enrollments":"matrícula","section_enrollments":"inscripción en sección",
    "section_schedules":"horario","class_sessions":"clase","reservations":"reserva","contacts":"contacto",
    "applications":"postulación","benefits":"beneficio","leave_requests":"solicitud de permiso",
    "employment_contracts":"contrato","support_tickets":"ticket de soporte","conference_rooms":"sala virtual",
    "conference_sessions":"sesión virtual","library_loans":"préstamo","document_permissions":"permiso de documento",
    "sales":"venta","sale_items":"detalle de venta","stock_movements":"movimiento de stock","product_lots":"lote de producto",
    "purchases":"compra de mercadería","purchase_items":"detalle de compra","products":"producto","store_promotions":"oferta",
    "store_coupons":"cupón","expenses":"gasto","conference_invites":"enlace de invitados","custom_modules":"módulo","custom_records":"registro",
    "grade_scales":"escala de notas","alumni_profiles":"perfil de egresado"
  }'::jsonb ->> p_table, replace(p_table, '_', ' '))
$f$;

-- Ventana para deshacer: 24 horas
create or replace function private.undo_my_groups(p_org uuid)
returns table (tx_id bigint, last_id bigint, at timestamptz) language sql stable security definer set search_path = '' as $$
  select e.tx_id, max(e.id), max(e.occurred_at)
    from public.audit_events e
   where e.organization_id = p_org and e.actor_id = auth.uid() and e.tx_id is not null
     and e.occurred_at > now() - interval '24 hours'
     and not exists (select 1 from public.undo_log u where u.applied_tx = e.tx_id and u.kind <> 'restore')
   group by e.tx_id
  having bool_and(e.operation <> 'ACTION' and e.table_name <> all(private.undo_blocked_tables()))
   order by max(e.id) desc
   limit 50
$$;
do $$ declare def text; begin
  select pg_get_functiondef('public.undo_status'::regproc) into def;
  if def like '%60 minutes%' then execute replace(def, '60 minutes', '24 hours'); end if;
end $$;

-- ---------- Libros y documentos: ocultarlos a quien no deba verlos ----------
alter table public.library_items add column if not exists visible_roles text[] not null default '{}';
alter table public.library_items add column if not exists hidden_users uuid[] not null default '{}';

/** ¿El usuario actual puede ver este libro? (vacío = todos; la biblioteca siempre lo ve) */
create or replace function private.library_visible(p_org uuid, p_roles text[], p_hidden uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(p_org) and (
    private.has_permission(p_org, 'library.edit') or private.is_owner(p_org)
    or (not (auth.uid() = any(coalesce(p_hidden, '{}')))
        and (cardinality(coalesce(p_roles, '{}')) = 0
             or exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
                         where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active' and r.code = any(p_roles)))))
$$;
drop policy if exists lib_select on public.library_items;
create policy lib_select on public.library_items for select to authenticated using (private.library_visible(organization_id, visible_roles, hidden_users));
-- El archivo del libro sigue la misma regla
drop policy if exists libf_select on public.library_files;
create policy libf_select on public.library_files for select to authenticated using (
  private.is_member(organization_id) and (
    private.has_permission(organization_id, 'library.edit') or private.is_owner(organization_id)
    or exists (select 1 from public.library_items i where i.file_id = library_files.id and private.library_visible(i.organization_id, i.visible_roles, i.hidden_users))
    or not exists (select 1 from public.library_items i where i.file_id = library_files.id)));

-- ---------- El propietario edita o elimina usuarios según su rol ----------
create or replace function private.can_manage_member(p_org uuid, p_user uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_platform_admin() or ((private.is_owner(p_org) or private.has_permission(p_org, 'security.admin')) and private.current_aal() = 'aal2')) then
    raise exception 'Solo el propietario (o seguridad) con verificación en dos pasos puede editar o eliminar usuarios' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships where user_id = p_user and organization_id = p_org) then
    raise exception 'La persona no pertenece a esta institución' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user and is_platform_admin) and not private.is_platform_admin() then
    raise exception 'No se puede modificar al administrador de la plataforma' using errcode = '42501';
  end if;
end $$;

/** ✏ Edita los datos de un usuario (nombre, documento, teléfono). */
create or replace function public.admin_update_member(p_org uuid, p_user uuid, p_full_name text, p_doc_type text, p_doc_number text, p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.can_manage_member(p_org, p_user);
  if length(btrim(coalesce(p_full_name, ''))) < 3 then raise exception 'Escriba el nombre completo' using errcode = '22023'; end if;
  begin
    update public.profiles set full_name = left(btrim(p_full_name), 160), id_document_type = nullif(left(coalesce(p_doc_type, ''), 20), ''),
           id_document_number = nullif(left(upper(btrim(coalesce(p_doc_number, ''))), 30), ''), phone = nullif(left(btrim(coalesce(p_phone, '')), 40), '')
     where id = p_user;
  exception when unique_violation then raise exception 'Ese RUT ya está registrado en otra cuenta' using errcode = '23505';
  end;
end $$;

/** Cambia el rol (y la sede) de una asignación. */
create or replace function public.change_membership_role(p_membership uuid, p_role_code text, p_campus uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.memberships; r public.roles;
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found then raise exception 'Asignación inexistente' using errcode = 'P0002'; end if;
  perform private.can_manage_member(m.organization_id, m.user_id);
  select * into r from public.roles where code = p_role_code and (organization_id is null or organization_id = m.organization_id) order by organization_id nulls last limit 1;
  if not found then raise exception 'Rol inexistente' using errcode = '22023'; end if;
  if r.code = 'propietario_institucional' and not (private.is_owner(m.organization_id) or private.is_platform_admin()) then
    raise exception 'Solo el propietario puede nombrar a otro propietario' using errcode = '42501'; end if;
  if m.user_id = auth.uid() and r.code <> 'propietario_institucional' and (select code from public.roles where id = m.role_id) = 'propietario_institucional' then
    raise exception 'No puede quitarse a sí mismo el rol de propietario' using errcode = '42501'; end if;
  if p_campus is not null and not exists (select 1 from public.campuses where id = p_campus and organization_id = m.organization_id) then
    raise exception 'Sede inválida' using errcode = '22023'; end if;
  update public.memberships set role_id = r.id, campus_id = p_campus, status = 'active', revoked_at = null, revoked_by = null where id = m.id;
end $$;

/** 🗑 Quita a la persona de la institución: revoca todos sus roles y, si no tiene otra institución, suspende su cuenta. Su historial se conserva. */
create or replace function public.remove_member(p_org uuid, p_user uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_suspended boolean := false;
begin
  perform private.can_manage_member(p_org, p_user);
  if p_user = auth.uid() then raise exception 'No puede eliminarse a sí mismo' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Indique el motivo' using errcode = '22023'; end if;
  if exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id where m.user_id = p_user and m.organization_id = p_org and r.code = 'propietario_institucional' and m.status = 'active')
     and not exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id where m.organization_id = p_org and r.code = 'propietario_institucional' and m.status = 'active' and m.user_id <> p_user) then
    raise exception 'No se puede eliminar al único propietario de la institución' using errcode = '42501';
  end if;
  perform set_config('sematec.audit_reason', 'Eliminado del sistema: ' || btrim(p_reason), true);
  update public.memberships set status = 'revoked', revoked_at = now(), revoked_by = auth.uid() where user_id = p_user and organization_id = p_org and status <> 'revoked';
  if not exists (select 1 from public.memberships where user_id = p_user and status = 'active') then
    update public.profiles set status = 'suspended', status_reason = left('Eliminado del sistema: ' || btrim(p_reason), 300) where id = p_user;
    v_suspended := true;
  end if;
  perform set_config('sematec.audit_reason', '', true);
  return jsonb_build_object('suspended', v_suspended);
end $$;
grant execute on function public.admin_update_member(uuid, uuid, text, text, text, text), public.change_membership_role(uuid, text, uuid), public.remove_member(uuid, uuid, text) to authenticated;

-- «Mis libros virtuales» también respeta a quién se ocultó cada libro
create or replace function public.my_virtual_books(p_org uuid)
returns setof public.library_items language sql stable security definer set search_path = '' as $$
  select li.* from public.library_items li
  where li.organization_id = p_org and private.is_member(p_org)
    and (li.file_id is not null or li.url is not null)
    and private.library_visible(li.organization_id, li.visible_roles, li.hidden_users)
    and (
      li.section_id in (select se.section_id from public.section_enrollments se where se.student_id in (select private.my_student_ids()) and se.status <> 'dropped')
      or li.section_id in (select s.id from public.sections s join public.teachers t on t.id = s.teacher_id where t.user_id = auth.uid())
      or li.course_id in (select s.course_id from public.section_enrollments se join public.sections s on s.id = se.section_id
                          where se.student_id in (select private.my_student_ids()) and se.status <> 'dropped')
      or li.course_id in (select s.course_id from public.sections s join public.teachers t on t.id = s.teacher_id where t.user_id = auth.uid())
      or li.program_id in (select e.program_id from public.enrollments e where e.student_id in (select private.my_student_ids()))
    )
  order by li.title
$$;
