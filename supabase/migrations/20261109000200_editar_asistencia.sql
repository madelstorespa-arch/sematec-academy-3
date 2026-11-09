-- =====================================================================
-- 1) Editor universal del propietario: editar / eliminar cualquier entidad
-- 2) Asistencia completa: QR del estudiante, automática desde el aula
--    virtual, clases dictadas por profesores, reportes y alertas
-- 3) Actualizar el sistema desde la aplicación (lista de mejoras instaladas)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Editor universal
-- ---------------------------------------------------------------------
-- Entidades administrables por el propietario: columna de suspender/activar (si tiene)
create or replace function private.owner_tables()
returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "programs":             {"col":"status","off":"inactive","on":"active"},
    "courses":              {"col":"status","off":"inactive","on":"active"},
    "sections":             {"col":"status","off":"inactive","on":"active"},
    "campuses":             {"col":"status","off":"inactive","on":"active"},
    "departments":          {"col":"status","off":"inactive","on":"active"},
    "curricula":            {"col":"status","off":"inactive","on":"active"},
    "students":             {"col":"status","off":"suspended","on":"active"},
    "teachers":             {"col":"status","off":"suspended","on":"active"},
    "employees":            {"col":"status","off":"suspended","on":"active"},
    "catalog_offerings":    {"col":"is_published","off":"false","on":"true"},
    "job_postings":         {"col":"published","off":"false","on":"true"},
    "surveys":              {"col":"published","off":"false","on":"true"},
    "resources":            {"col":"status","off":"mantencion","on":"disponible"},
    "inventory_items":      {"col":"status","off":"de_baja","on":"operativo"},
    "rooms":                {"col":"status","off":"inactive","on":"active"},
    "conference_rooms":     {"col":"status","off":"inactive","on":"active"},
    "benefits":             {"col":"status","off":"inactive","on":"active"},
    "certificate_templates":{"col":"status","off":"inactive","on":"active"},
    "employment_contracts": {"col":"status","off":"inactive","on":"active"},
    "assessments":          {"col":"published","off":"false","on":"true"},
    "course_units":         {"col":"published","off":"false","on":"true"},
    "course_contents":      {"col":"published","off":"false","on":"true"},
    "assignments":          {"col":"published","off":"false","on":"true"},
    "quizzes":              {"col":"published","off":"false","on":"true"},
    "class_materials":      {"col":"published","off":"false","on":"true"},
    "library_items":        {},
    "announcements":        {},
    "calendar_events":      {},
    "academic_periods":     {},
    "offices":              {},
    "appointments":         {},
    "student_requests":     {},
    "guardian_links":       {},
    "fee_schedules":        {},
    "class_sessions":       {},
    "section_schedules":    {},
    "forum_threads":        {},
    "conference_sessions":  {},
    "reservations":         {},
    "leave_requests":       {},
    "support_tickets":      {},
    "authorities":          {},
    "staff_attendance":     {},
    "attendance_records":   {},
    "grade_scales":         {}
  }'::jsonb
$$;

-- Columnas que nunca se editan a mano (identidad, vínculos de cuentas, sellos, archivos)
create or replace function private.owner_locked_columns()
returns text[] language sql immutable set search_path = '' as $$
  select array['id','organization_id','created_at','updated_at','created_by','user_id','requester_id','author_id',
               'reserved_by','decided_by','decided_at','recorded_by','recorded_at','grades_closed_at','grades_closed_by',
               'livekit_room_name','number','file_id','image_asset_id','cover_asset_id','storage_path','rubric','layout',
               'during','time_slot','actual_start','actual_end','last_post_at','closed_at','checkin_code','checkin_expires_at',
               'teacher_checkin_at','teacher_checkout_at','available_copies']
$$;

create or replace function public.owner_manage(p_table text, p_id uuid, p_op text)
returns text language plpgsql security definer set search_path = '' as $$
declare c jsonb; v_org uuid; v_col_type text;
begin
  c := private.owner_tables() -> p_table;
  if c is null then raise exception 'Módulo no administrable' using errcode = '22023'; end if;
  execute format('select organization_id from public.%I where id = $1', p_table) into v_org using p_id;
  if v_org is null then raise exception 'Registro no encontrado' using errcode = 'P0002'; end if;
  if not private.is_owner(v_org) then raise exception 'Solo el propietario institucional puede hacer esto' using errcode = '42501'; end if;
  if p_op = 'delete' then
    begin
      execute format('delete from public.%I where id = $1', p_table) using p_id;
    exception when foreign_key_violation then
      raise exception 'No se puede eliminar: tiene registros asociados (matrículas, notas, pagos u otros). Use «Suspender» para conservar el historial.' using errcode = '23503';
    end;
    return 'eliminado';
  elsif p_op in ('suspend','activate') then
    if c ->> 'col' is null then raise exception 'Este registro solo se puede editar o eliminar' using errcode = '22023'; end if;
    select format_type(a.atttypid, a.atttypmod) into v_col_type from pg_attribute a
     where a.attrelid = ('public.' || p_table)::regclass and a.attname = c ->> 'col';
    execute format('update public.%I set %I = $1::%s where id = $2', p_table, c ->> 'col', v_col_type)
      using (c ->> case when p_op = 'suspend' then 'off' else 'on' end), p_id;
    return case when p_op = 'suspend' then 'suspendido' else 'activado' end;
  end if;
  raise exception 'Operación inválida' using errcode = '22023';
end $$;

-- Valores permitidos de una columna (enum o CHECK col = ANY(ARRAY[...]) / col IN (...))
create or replace function private.column_choices(p_table text, p_col text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_typ oid; v_def text; v_vals text[];
begin
  select a.atttypid into v_typ from pg_attribute a
   where a.attrelid = ('public.' || p_table)::regclass and a.attname = p_col and not a.attisdropped;
  if exists (select 1 from pg_type t where t.oid = v_typ and t.typtype = 'e') then
    return array(select e.enumlabel::text from pg_enum e where e.enumtypid = v_typ order by e.enumsortorder);
  end if;
  for v_def in select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conrelid = ('public.' || p_table)::regclass and c.contype = 'c' loop
    if v_def ~ ('\m' || p_col || '\M[^A-Za-z_]*(= ANY|IN)') and v_def !~ ' AND | OR ' then
      select array_agg(m[1]) into v_vals from regexp_matches(v_def, '''([^'']*)''', 'g') m;
      if v_vals is not null then return v_vals; end if;
    end if;
  end loop;
  return null;
end $$;

-- Estructura editable de una entidad (para dibujar el formulario)
create or replace function public.entity_schema(p_table text, p_org uuid)
returns table (col text, data_type text, nullable boolean, choices text[], ref_table text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.owner_tables() -> p_table is null then raise exception 'Módulo no administrable' using errcode = '22023'; end if;
  if not private.is_owner(p_org) then
    raise exception 'Solo el propietario institucional puede editar' using errcode = '42501';
  end if;
  return query
  select a.attname::text,
         case when t.typtype = 'e' then 'enum' when t.typcategory = 'A' then 'array' else format_type(a.atttypid, a.atttypmod) end,
         not a.attnotnull,
         private.column_choices(p_table, a.attname::text),
         (select cf.confrelid::regclass::text from pg_constraint cf
           where cf.conrelid = a.attrelid and cf.contype = 'f' and a.attnum = any(cf.conkey)
             and cf.confrelid <> 'public.organizations'::regclass
           order by array_length(cf.conkey, 1) limit 1)
    from pg_attribute a join pg_type t on t.oid = a.atttypid
   where a.attrelid = ('public.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.attname::text <> all(private.owner_locked_columns())
   order by a.attnum;
end $$;

-- Opciones de una lista relacionada (p. ej., profesor de una sección) de la institución
create or replace function public.entity_ref_options(p_ref text, p_org uuid)
returns table (id text, label text)
language plpgsql stable security definer set search_path = '' as $$
declare v_tbl text := regexp_replace(p_ref, '^public\.', '');
begin
  if not private.is_owner(p_org) then raise exception 'Solo el propietario institucional puede editar' using errcode = '42501'; end if;
  if to_regclass('public.' || v_tbl) is null or v_tbl !~ '^[a-z_]+$' then return; end if;
  if not exists (select 1 from pg_attribute where attrelid = ('public.' || v_tbl)::regclass and attname = 'organization_id') then
    if v_tbl = 'profiles' then
      return query select p.id::text, coalesce(p.full_name, 'Usuario') from public.profiles p
        where exists (select 1 from public.memberships m where m.user_id = p.id and m.organization_id = p_org)
        order by 2 limit 1000;
    end if;
    return;
  end if;
  return query execute format(
    'select t.id::text, left(concat_ws('' · '', to_jsonb(t) ->> ''code'', coalesce(to_jsonb(t) ->> ''name'', to_jsonb(t) ->> ''title'',
        nullif(trim(concat_ws('' '', to_jsonb(t) ->> ''first_names'', to_jsonb(t) ->> ''last_names'')), ''''),
        to_jsonb(t) ->> ''topic'', to_jsonb(t) ->> ''version'', to_jsonb(t) ->> ''starts_at'')), 120)
       from public.%I t where t.organization_id = $1 order by 2 limit 1000', v_tbl) using p_org;
end $$;

-- ✏️ Guardar la edición (solo propietario; columnas protegidas nunca se tocan)
create or replace function public.owner_update(p_table text, p_id uuid, p_data jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_cols text[]; v_list text; v_rlist text; v_clean jsonb := '{}'::jsonb; k text; v jsonb; v_type text;
begin
  if private.owner_tables() -> p_table is null then raise exception 'Módulo no administrable' using errcode = '22023'; end if;
  execute format('select organization_id from public.%I where id = $1', p_table) into v_org using p_id;
  if v_org is null then raise exception 'Registro no encontrado' using errcode = 'P0002'; end if;
  if not private.is_owner(v_org) then raise exception 'Solo el propietario institucional puede editar' using errcode = '42501'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Datos inválidos' using errcode = '22023'; end if;
  -- Normaliza: '' → null en columnas que no son de texto
  for k, v in select * from jsonb_each(p_data) loop
    select format_type(a.atttypid, a.atttypmod) into v_type from pg_attribute a
     where a.attrelid = ('public.' || p_table)::regclass and a.attname = k and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    continue when v_type is null or k = any(private.owner_locked_columns());
    if v = '""'::jsonb and v_type not in ('text') then v := 'null'::jsonb; end if;
    v_clean := v_clean || jsonb_build_object(k, v);
  end loop;
  select array_agg(x) into v_cols from jsonb_object_keys(v_clean) x;
  if v_cols is null then raise exception 'No hay cambios para guardar' using errcode = '22023'; end if;
  select string_agg(format('%I', c), ', '), string_agg(format('r.%I', c), ', ') into v_list, v_rlist from unnest(v_cols) c;
  perform set_config('sematec.audit_reason', 'Edición del propietario', true);
  begin
    if cardinality(v_cols) = 1 then
      execute format('update public.%I t set %I = (select r.%I from jsonb_populate_record(null::public.%I, $1) r) where t.id = $2',
                     p_table, v_cols[1], v_cols[1], p_table) using v_clean, p_id;
    else
      execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.id = $2',
                     p_table, v_list, v_rlist, p_table) using v_clean, p_id;
    end if;
  exception
    when unique_violation then raise exception 'Ya existe otro registro con ese código o nombre.' using errcode = '23505';
    when not_null_violation then raise exception 'Falta completar un campo obligatorio.' using errcode = '23502';
    when check_violation then raise exception 'Algún valor no es válido (revise fechas, montos y porcentajes).' using errcode = '23514';
    when foreign_key_violation then raise exception 'Una de las opciones elegidas ya no existe.' using errcode = '23503';
    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range or invalid_datetime_format then
      raise exception 'Algún valor tiene un formato inválido (números, fechas u horas).' using errcode = '22P02';
  end;
  perform set_config('sematec.audit_reason', '', true);
  return 'guardado';
end $$;

-- Auditar las entidades editables que aún no lo estaban (para Deshacer, Papelera e Historial)
do $$
declare t text;
begin
  for t in select jsonb_object_keys(private.owner_tables()) loop
    if to_regclass('public.' || t) is not null
       and exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'organization_id')
       and exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'id')
       and not exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                        where g.tgrelid = ('public.' || t)::regclass and p.proname = 'audit_row') then
      execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function private.audit_row()', t, t);
    end if;
  end loop;
end $$;

revoke all on function public.entity_schema(text, uuid), public.entity_ref_options(text, uuid), public.owner_update(text, uuid, jsonb) from public, anon;
grant execute on function public.entity_schema(text, uuid), public.entity_ref_options(text, uuid), public.owner_update(text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Asistencia
-- ---------------------------------------------------------------------
alter table public.class_sessions
  add column if not exists checkin_code text,
  add column if not exists checkin_expires_at timestamptz,
  add column if not exists teacher_id uuid references public.teachers(id) on delete set null,
  add column if not exists teacher_status text not null default 'pending'
    check (teacher_status in ('pending','held','cancelled','rescheduled')),
  add column if not exists teacher_checkin_at timestamptz,
  add column if not exists teacher_checkout_at timestamptz;
create unique index if not exists class_sessions_checkin_code_idx on public.class_sessions (checkin_code) where checkin_code is not null;
alter table public.attendance_records add column if not exists source text not null default 'teacher'
  check (source in ('teacher','qr','virtual','admin'));

-- ¿Puede esta persona tomar asistencia de la sección?
create or replace function private.can_take_attendance(p_section uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.teaches_section(p_section)
      or exists (select 1 from public.sections s where s.id = p_section
                  and (private.has_permission(s.organization_id, 'attendance.create', s.campus_id)
                       or private.is_owner(s.organization_id)))
$$;

-- 📱 El profesor abre el código QR de asistencia de una clase (válido N minutos)
create or replace function public.open_checkin(p_session uuid, p_minutes int default 15)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sec uuid; v_code text; v_exp timestamptz; i int := 0;
begin
  select section_id into v_sec from public.class_sessions where id = p_session;
  if v_sec is null then raise exception 'Clase no encontrada' using errcode = 'P0002'; end if;
  if not private.can_take_attendance(v_sec) then raise exception 'Solo el profesor de la sección puede abrir la asistencia' using errcode = '42501'; end if;
  if exists (select 1 from public.sections where id = v_sec and grades_closed_at is not null) then
    raise exception 'El acta de esta sección está cerrada' using errcode = '22023';
  end if;
  v_exp := now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 15), 240)));
  loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    begin
      update public.class_sessions set checkin_code = v_code, checkin_expires_at = v_exp where id = p_session;
      exit;
    exception when unique_violation then
      i := i + 1; if i > 10 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

create or replace function public.close_checkin(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sec uuid;
begin
  select section_id into v_sec from public.class_sessions where id = p_session;
  if v_sec is null or not private.can_take_attendance(v_sec) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update public.class_sessions set checkin_code = null, checkin_expires_at = null where id = p_session;
end $$;

-- ✅ El estudiante marca su asistencia con el código (o escaneando el QR)
create or replace function public.checkin_attendance(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare cs public.class_sessions; v_stu uuid; v_status public.attendance_status; v_prev public.attendance_status; v_course text;
begin
  if auth.uid() is null then raise exception 'Inicie sesión para marcar asistencia' using errcode = '42501'; end if;
  if private.rate_limited('checkin', auth.uid()::text, 12, interval '10 minutes') then
    raise exception 'Demasiados intentos. Espere unos minutos.' using errcode = '54000';
  end if;
  select * into cs from public.class_sessions
   where checkin_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and checkin_expires_at > now();
  if cs.id is null then raise exception 'Código inválido o vencido. Pida al profesor que lo muestre de nuevo.' using errcode = 'P0002'; end if;
  select se.student_id into v_stu from public.section_enrollments se
   where se.section_id = cs.section_id and se.status <> 'dropped'
     and se.student_id in (select private.my_student_ids()) limit 1;
  if v_stu is null then raise exception 'No está inscrito en esta asignatura.' using errcode = '42501'; end if;
  v_status := case when now() > cs.starts_at + interval '15 minutes' then 'late' else 'present' end;
  select status into v_prev from public.attendance_records where class_session_id = cs.id and student_id = v_stu;
  if v_prev in ('present','late','excused') then
    v_status := v_prev;
  else
    insert into public.attendance_records (organization_id, class_session_id, student_id, status, notes, recorded_by, source)
    values (cs.organization_id, cs.id, v_stu, v_status, 'Marcó con código QR', auth.uid(), 'qr')
    on conflict (class_session_id, student_id) do update
      set status = excluded.status, notes = excluded.notes, recorded_by = excluded.recorded_by, recorded_at = now(), source = 'qr';
  end if;
  select c.name into v_course from public.sections s join public.courses c on c.id = s.course_id where s.id = cs.section_id;
  return coalesce(v_course, 'Clase') || ': ' || case v_status when 'late' then 'atraso registrado' when 'excused' then 'justificado' else 'presente' end;
end $$;

-- 🎥 Asistencia automática desde el aula virtual (presente si entró a la sala)
create or replace function public.attendance_from_conference(p_session uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare cs public.class_sessions; v_conf uuid; n int;
begin
  select * into cs from public.class_sessions where id = p_session;
  if cs.id is null then raise exception 'Clase no encontrada' using errcode = 'P0002'; end if;
  if not private.can_take_attendance(cs.section_id) then raise exception 'Sin permiso para tomar asistencia' using errcode = '42501'; end if;
  select id into v_conf from public.conference_sessions
   where class_session_id = cs.id or id = cs.conference_session_id order by scheduled_start desc limit 1;
  if v_conf is null then raise exception 'Esta clase no tiene una sesión del aula virtual asociada.' using errcode = 'P0002'; end if;
  insert into public.attendance_records as ar (organization_id, class_session_id, student_id, status, notes, recorded_by, source)
  select cs.organization_id, cs.id, se.student_id,
         case when exists (select 1 from public.conference_attendance ca where ca.session_id = v_conf and ca.user_id = st.user_id)
              then case when (select min(ca.joined_at) from public.conference_attendance ca where ca.session_id = v_conf and ca.user_id = st.user_id)
                             > greatest(cs.starts_at, coalesce((select actual_start from public.conference_sessions where id = v_conf), cs.starts_at)) + interval '15 minutes'
                        then 'late' else 'present' end
              else 'absent' end::public.attendance_status,
         'Aula virtual', auth.uid(), 'virtual'
    from public.section_enrollments se join public.students st on st.id = se.student_id
   where se.section_id = cs.section_id and se.status <> 'dropped'
  on conflict (class_session_id, student_id) do update
    set status = excluded.status, notes = excluded.notes, recorded_by = excluded.recorded_by, recorded_at = now(), source = 'virtual'
    where ar.source = 'virtual' or (ar.status = 'absent' and excluded.status <> 'absent');
  get diagnostics n = row_count;
  return n;
end $$;

-- 👨‍🏫 El profesor registra inicio / término / suspensión de su clase
create or replace function public.teacher_class_mark(p_session uuid, p_action text)
returns text language plpgsql security definer set search_path = '' as $$
declare cs public.class_sessions; v_teacher uuid;
begin
  select * into cs from public.class_sessions where id = p_session;
  if cs.id is null then raise exception 'Clase no encontrada' using errcode = 'P0002'; end if;
  if not private.can_take_attendance(cs.section_id) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select t.id into v_teacher from public.teachers t where t.user_id = auth.uid() and t.organization_id = cs.organization_id limit 1;
  v_teacher := coalesce(v_teacher, cs.teacher_id, (select teacher_id from public.sections where id = cs.section_id));
  if p_action = 'start' then
    update public.class_sessions set teacher_checkin_at = coalesce(teacher_checkin_at, now()), teacher_status = 'held', teacher_id = v_teacher where id = p_session;
    return 'Inicio de clase registrado';
  elsif p_action = 'end' then
    update public.class_sessions set teacher_checkin_at = coalesce(teacher_checkin_at, starts_at), teacher_checkout_at = now(),
           teacher_status = 'held', teacher_id = v_teacher, checkin_code = null, checkin_expires_at = null where id = p_session;
    return 'Término de clase registrado';
  elsif p_action = 'cancel' then
    update public.class_sessions set teacher_status = 'cancelled', teacher_id = v_teacher, checkin_code = null where id = p_session;
    return 'Clase marcada como suspendida';
  elsif p_action = 'held' then
    update public.class_sessions set teacher_status = 'held', teacher_id = v_teacher where id = p_session;
    return 'Clase marcada como dictada';
  end if;
  raise exception 'Acción inválida' using errcode = '22023';
end $$;

-- Las clases nuevas quedan asignadas al profesor de la sección
create or replace function private.class_session_teacher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.teacher_id is null then select s.teacher_id into new.teacher_id from public.sections s where s.id = new.section_id; end if;
  return new;
end $$;
drop trigger if exists class_session_teacher on public.class_sessions;
create trigger class_session_teacher before insert on public.class_sessions for each row execute function private.class_session_teacher();
update public.class_sessions cs set teacher_id = s.teacher_id from public.sections s where s.id = cs.section_id and cs.teacher_id is null;
update public.class_sessions cs set teacher_status = 'held'
 where cs.teacher_status = 'pending' and exists (select 1 from public.attendance_records a where a.class_session_id = cs.id);

-- ¿Quién ve los reportes? (asistencia/reportes; el profesor solo sus secciones)
create or replace function private.attendance_scope(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when private.is_owner(p_org) or private.has_permission(p_org, 'attendance.view', null)
                or private.has_permission(p_org, 'reports.view', null) then 'all'
              when exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = p_org) then 'teacher'
              else 'none' end
$$;

-- 📊 Asistencia de estudiantes por sección (con alerta bajo el mínimo)
create or replace function public.attendance_student_report(p_org uuid, p_from date default null, p_to date default null, p_section uuid default null)
returns table (section_id uuid, section_label text, student_id uuid, student_name text, student_code text,
               sessions int, present int, late int, absent int, excused int, pct numeric, min_pct numeric, below boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_scope text := private.attendance_scope(p_org);
begin
  if v_scope = 'none' then raise exception 'Sin permiso para ver la asistencia' using errcode = '42501'; end if;
  return query
  with ses as (
    select cs.id, cs.section_id from public.class_sessions cs
     where cs.organization_id = p_org and cs.teacher_status <> 'cancelled'
       and (p_from is null or cs.starts_at >= p_from) and (p_to is null or cs.starts_at < p_to + 1)
       and (p_section is null or cs.section_id = p_section)
       and (v_scope = 'all' or private.teaches_section(cs.section_id))
  ), agg as (
    select s.section_id, a.student_id,
           count(*) filter (where a.status = 'present')::int pr, count(*) filter (where a.status = 'late')::int la,
           count(*) filter (where a.status = 'absent')::int ab, count(*) filter (where a.status = 'excused')::int ex
      from ses s join public.attendance_records a on a.class_session_id = s.id
     group by s.section_id, a.student_id
  ), tot as (select s.section_id, count(*)::int n from ses s group by s.section_id)
  select se.section_id, c.code || ' · ' || c.name || ' (' || sc.code || ')', st.id,
         st.first_names || ' ' || st.last_names, st.student_code, t.n,
         coalesce(g.pr, 0), coalesce(g.la, 0), coalesce(g.ab, 0), coalesce(g.ex, 0),
         case when t.n - coalesce(g.ex, 0) > 0 then round(100.0 * (coalesce(g.pr, 0) + coalesce(g.la, 0)) / (t.n - coalesce(g.ex, 0)), 1) end,
         sc.min_attendance_pct,
         coalesce(t.n - coalesce(g.ex, 0) > 0 and 100.0 * (coalesce(g.pr, 0) + coalesce(g.la, 0)) / (t.n - coalesce(g.ex, 0)) < sc.min_attendance_pct, false)
    from tot t
    join public.sections sc on sc.id = t.section_id
    join public.courses c on c.id = sc.course_id
    join public.section_enrollments se on se.section_id = t.section_id and se.status <> 'dropped'
    join public.students st on st.id = se.student_id
    left join agg g on g.section_id = t.section_id and g.student_id = st.id
   order by 2, 4;
end $$;

-- 👨‍🏫 Clases dictadas por profesor
create or replace function public.attendance_teacher_report(p_org uuid, p_from date default null, p_to date default null)
returns table (teacher_id uuid, teacher_name text, scheduled int, held int, cancelled int, pending int, hours numeric, last_class timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_scope text := private.attendance_scope(p_org);
begin
  if v_scope = 'none' then raise exception 'Sin permiso para ver la asistencia' using errcode = '42501'; end if;
  return query
  select t.id, t.first_names || ' ' || t.last_names,
         count(cs.id)::int,
         count(cs.id) filter (where cs.teacher_status = 'held')::int,
         count(cs.id) filter (where cs.teacher_status = 'cancelled')::int,
         count(cs.id) filter (where cs.teacher_status in ('pending','rescheduled'))::int,
         round(coalesce(sum(extract(epoch from coalesce(cs.teacher_checkout_at, cs.ends_at) - coalesce(cs.teacher_checkin_at, cs.starts_at)) / 3600)
                    filter (where cs.teacher_status = 'held'), 0)::numeric, 1),
         max(cs.starts_at) filter (where cs.teacher_status = 'held')
    from public.class_sessions cs join public.teachers t on t.id = cs.teacher_id
   where cs.organization_id = p_org
     and (p_from is null or cs.starts_at >= p_from) and (p_to is null or cs.starts_at < p_to + 1)
     and (v_scope = 'all' or t.user_id = auth.uid())
   group by t.id, t.first_names, t.last_names
   order by 2;
end $$;

-- 🧑‍💼 Asistencia del personal (días y horas)
create or replace function public.attendance_staff_report(p_org uuid, p_from date default null, p_to date default null)
returns table (employee_id uuid, employee_name text, job_title text, days int, open_days int, hours numeric, first_in timestamptz, last_out timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_owner(p_org) or private.has_permission(p_org, 'employees.view', null) or private.has_permission(p_org, 'attendance.view', null)) then
    raise exception 'Sin permiso para ver la asistencia del personal' using errcode = '42501';
  end if;
  return query
  select e.id, e.first_names || ' ' || e.last_names, e.position,
         count(sa.id)::int, count(sa.id) filter (where sa.check_out is null and sa.work_date < current_date)::int,
         round(coalesce(sum(extract(epoch from sa.check_out - sa.check_in) / 3600) filter (where sa.check_out is not null), 0)::numeric, 1),
         min(sa.check_in), max(sa.check_out)
    from public.employees e
    left join public.staff_attendance sa on sa.employee_id = e.id
     and (p_from is null or sa.work_date >= p_from) and (p_to is null or sa.work_date <= p_to)
   where e.organization_id = p_org and e.status = 'active'
   group by e.id, e.first_names, e.last_names, e.position
   order by 2;
end $$;

-- Mis clases (para «Mi asistencia» del estudiante)
create or replace function public.my_attendance()
returns table (section_label text, starts_at timestamptz, topic text, status text, source text)
language sql stable security definer set search_path = '' as $$
  select c.code || ' · ' || c.name, cs.starts_at, cs.topic, a.status::text, a.source
    from public.attendance_records a
    join public.class_sessions cs on cs.id = a.class_session_id
    join public.sections s on s.id = cs.section_id join public.courses c on c.id = s.course_id
   where a.student_id in (select private.my_student_ids())
   order by cs.starts_at desc limit 200
$$;

revoke all on function public.open_checkin(uuid, int), public.close_checkin(uuid), public.checkin_attendance(text),
  public.attendance_from_conference(uuid), public.teacher_class_mark(uuid, text),
  public.attendance_student_report(uuid, date, date, uuid), public.attendance_teacher_report(uuid, date, date),
  public.attendance_staff_report(uuid, date, date), public.my_attendance() from public, anon;
grant execute on function public.open_checkin(uuid, int), public.close_checkin(uuid), public.checkin_attendance(text),
  public.attendance_from_conference(uuid), public.teacher_class_mark(uuid, text),
  public.attendance_student_report(uuid, date, date, uuid), public.attendance_teacher_report(uuid, date, date),
  public.attendance_staff_report(uuid, date, date), public.my_attendance() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Actualizar el sistema: qué mejoras ya están instaladas
-- ---------------------------------------------------------------------
create or replace function public.installed_migrations()
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Solo el superadministrador' using errcode = '42501'; end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then return '{}'; end if;
  return array(select version from supabase_migrations.schema_migrations order by version);
end $$;
revoke all on function public.installed_migrations() from public, anon;
grant execute on function public.installed_migrations() to authenticated;
