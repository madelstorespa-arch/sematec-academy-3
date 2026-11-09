-- =====================================================================
-- Deshacer / Rehacer, Papelera e Historial de versiones
--
-- Se apoya en la auditoría inmutable: cada cambio ya guarda la fila antes
-- (old_data) y después (new_data). Ahora además se guarda la transacción
-- (tx_id) para agrupar todo lo que hizo una misma acción del usuario.
--
-- Deshacer = aplicar el cambio inverso de una transacción (en orden inverso),
-- verificando que nadie haya modificado los registros después (si cambiaron,
-- no se deshace para no pisar el trabajo de otro). Rehacer = deshacer el
-- deshacer. Todo queda a su vez auditado.
--
-- Nunca se pueden deshacer por esta vía: pagos, cargos y cuotas, notas y
-- actas, certificados, intentos de prueba y entregas, archivos, incidentes
-- de seguridad ni la propia auditoría. Esos tienen su procedimiento formal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Agrupar la auditoría por transacción
-- ---------------------------------------------------------------------
alter table public.audit_events add column if not exists tx_id bigint;
create index if not exists audit_events_tx_idx on public.audit_events (tx_id) where tx_id is not null;
create index if not exists audit_events_actor_idx on public.audit_events (organization_id, actor_id, id desc);
create index if not exists audit_events_ops_idx on public.audit_events (organization_id, operation, id desc);

-- Clave de agrupación: la acción del usuario (encabezado x-sematec-action que envía
-- el servidor de la aplicación, una por solicitud) o, si no viene, la transacción.
-- Las claves de acción quedan en [2^62, 2^63) para no chocar con números de transacción.
create or replace function private.audit_group()
returns bigint language plpgsql stable set search_path = '' as $$
declare h text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json ->> 'x-sematec-action';
  exception when others then h := null;
  end;
  if h is null or h !~ '^[0-9a-fA-F-]{36}$' then return txid_current(); end if;
  return (hashtextextended(h, 0) & 4611686018427387903) | 4611686018427387904;
end $$;

create or replace function private.write_audit(
  p_org uuid, p_table text, p_record text, p_op text, p_action text,
  p_old jsonb, p_new jsonb, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prev text; v_seq bigint; v_at timestamptz := clock_timestamp();
  v_changed text[]; v_actor uuid := auth.uid();
begin
  perform pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(p_org::text, 'global'), 0));
  select a.hash, a.chain_seq into v_prev, v_seq
    from public.audit_events a
   where a.organization_id is not distinct from p_org
   order by a.chain_seq desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_seq  := coalesce(v_seq, 0) + 1;
  if p_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(p_new) k
     where (p_old -> k) is distinct from (p_new -> k) and k <> 'updated_at';
    if v_changed is null then return; end if;
  end if;
  insert into public.audit_events (occurred_at, organization_id, chain_seq, actor_id, table_name,
      record_id, operation, action, old_data, new_data, changed_fields, reason, prev_hash, hash, tx_id)
  values (v_at, p_org, v_seq, v_actor, p_table, p_record, p_op, p_action, p_old, p_new, v_changed,
      p_reason, v_prev,
      private.audit_hash(v_prev, p_org, v_seq, v_at, v_actor, p_table, p_record, p_op, p_action, p_old, p_new, p_reason),
      private.audit_group());
end $$;

-- Auditar también los módulos de contenido que aún no lo estaban (para poder deshacerlos)
do $$
declare t text;
begin
  foreach t in array array['offices','appointments','authorities','class_materials','course_contents',
                           'course_units','forum_threads','forum_posts','quiz_questions'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
       where g.tgrelid = ('public.' || t)::regclass and p.proname = 'audit_row') then
      execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function private.audit_row()', t, t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Registro de deshacer / rehacer / restaurar
-- ---------------------------------------------------------------------
create table if not exists public.undo_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid not null,
  root_tx         bigint not null,        -- acción original del usuario
  source_tx       bigint not null,        -- transacción que se invirtió
  applied_tx      bigint not null,        -- transacción que hizo la inversión
  kind            text not null check (kind in ('undo','redo','restore')),
  label           text,
  created_at      timestamptz not null default now()
);
create index if not exists undo_log_root_idx on public.undo_log (root_tx, id desc);
create index if not exists undo_log_applied_idx on public.undo_log (applied_tx);
create index if not exists undo_log_actor_idx on public.undo_log (organization_id, actor_id, id desc);
alter table public.undo_log enable row level security;
revoke all on public.undo_log from public, anon, authenticated;
-- (sin políticas: solo se usa a través de las funciones de abajo)

-- Tablas que JAMÁS se deshacen con el botón (tienen procedimiento formal con motivo)
create or replace function private.undo_blocked_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['audit_events','undo_log','organizations','payments','payment_allocations','charges','installments',
               'checkout_orders','student_accounts','certificates','grades','grade_history','academic_records',
               'quiz_attempts','submissions','conference_participants','conference_recordings','documents',
               'document_versions','enrollment_documents','security_incidents','staff_attendance',
               'library_files','lms_files','media_assets','profiles','exchange_rates']
$$;

-- Nombre legible de cada módulo
create or replace function private.undo_table_label(p_table text)
returns text language sql immutable set search_path = '' as $$
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
    "grade_scales":"escala de notas","alumni_profiles":"perfil de egresado"
  }'::jsonb ->> p_table, replace(p_table, '_', ' '))
$$;

-- Nombre del registro dentro de sus datos
create or replace function private.undo_record_name(p_data jsonb)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(coalesce(
    p_data ->> 'name', p_data ->> 'title', p_data ->> 'full_name',
    nullif(trim(concat_ws(' ', p_data ->> 'first_name', p_data ->> 'last_name')), ''),
    p_data ->> 'subject', p_data ->> 'display_name', p_data ->> 'code', p_data ->> 'permission_code', ''), 80), '')
$$;

-- Descripción corta de una transacción: «Eliminar carrera «Técnico en…» (+2 cambios)»
create or replace function private.undo_tx_label(p_tx bigint)
returns text language plpgsql stable security definer set search_path = '' as $$
declare e record; v_n int; v_verb text; v_name text; v_restored text;
begin
  select l.label into v_restored from public.undo_log l where l.applied_tx = p_tx and l.kind = 'restore' order by l.id desc limit 1;
  if v_restored is not null then
    return 'Restaurar ' || regexp_replace(v_restored, '^Eliminar ', '');
  end if;
  select count(*) into v_n from public.audit_events where tx_id = p_tx and operation <> 'ACTION';
  select * into e from public.audit_events where tx_id = p_tx and operation <> 'ACTION' order by id limit 1;
  if e is null then return 'Cambio'; end if;
  v_verb := case e.operation
    when 'INSERT' then 'Crear'
    when 'DELETE' then 'Eliminar'
    else case when e.changed_fields <@ array['status','is_published','published','active','is_active']
              then 'Cambiar estado de' else 'Editar' end end;
  v_name := private.undo_record_name(coalesce(e.new_data, e.old_data));
  return v_verb || ' ' || private.undo_table_label(e.table_name)
      || coalesce(' «' || v_name || '»', '')
      || case when v_n > 1 then ' (+' || (v_n - 1) || ' cambio' || case when v_n > 2 then 's' else '' end || ')' else '' end;
end $$;

-- ¿Se puede deshacer esta transacción en esta institución?
create or replace function private.undo_tx_check(p_tx bigint, p_org uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.audit_events where tx_id = p_tx and operation <> 'ACTION') then
    return 'No se encontró el cambio.';
  end if;
  if exists (select 1 from public.audit_events where tx_id = p_tx and organization_id is distinct from p_org) then
    return 'El cambio involucra datos de otra institución.';
  end if;
  if exists (select 1 from public.audit_events where tx_id = p_tx
              and (operation = 'ACTION' or table_name = any(private.undo_blocked_tables()))) then
    return 'Este cambio no se puede deshacer con el botón: pagos, notas, certificados y otros registros protegidos tienen su propio procedimiento (anular, rectificar) con motivo y auditoría.';
  end if;
  return null;
end $$;

-- Condición «columnas clave = valores del json $1» de una tabla
create or replace function private.undo_key_where(p_table text)
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(format('t.%I = ($1->>%L)::%s', a.attname, a.attname, format_type(a.atttypid, a.atttypmod)), ' and ' order by a.attnum)
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = ('public.' || p_table)::regclass and i.indisprimary
$$;

-- Columnas que se pueden escribir (no generadas ni eliminadas) y que vienen en el json
create or replace function private.undo_columns(p_table text, p_data jsonb, p_only text[] default null)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
    from pg_attribute a
   where a.attrelid = ('public.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and p_data ? a.attname::text
     and (p_only is null or a.attname::text = any(p_only))
$$;

-- ¿La fila actual coincide con lo esperado? (compara con tipos reales, ignora updated_at)
create or replace function private.undo_row_matches(p_table text, p_current jsonb, p_expected jsonb, p_only text[] default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_cols text[]; v_sql text; v_ok boolean;
begin
  select coalesce(array_agg(c), '{}') into v_cols
    from unnest(private.undo_columns(p_table, p_expected, p_only)) c
   where c <> 'updated_at' and p_current ? c;
  if cardinality(v_cols) = 0 then return true; end if;
  select string_agg(format('a.%1$I::text is not distinct from b.%1$I::text', c), ' and ') into v_sql from unnest(v_cols) c;
  execute format('select %s from jsonb_populate_record(null::public.%I, $1) a, jsonb_populate_record(null::public.%I, $2) b',
                 v_sql, p_table, p_table) into v_ok using p_current, p_expected;
  return coalesce(v_ok, false);
end $$;

-- Escribe en una fila el estado «p_target» (inserta si no existe)
create or replace function private.undo_put_row(p_table text, p_target jsonb, p_only text[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_where text := private.undo_key_where(p_table); v_exists boolean; v_cols text[]; v_list text; v_rlist text;
begin
  execute format('select exists (select 1 from public.%I t where %s)', p_table, v_where) into v_exists using p_target;
  if v_exists then
    select coalesce(array_agg(c), '{}') into v_cols from unnest(private.undo_columns(p_table, p_target, p_only)) c
     where c not in ('created_at','updated_at');
    if cardinality(v_cols) = 0 then return; end if;
    if cardinality(v_cols) = 1 then
      execute format('update public.%I t set %I = (select r.%I from jsonb_populate_record(null::public.%I, $1) r) where %s',
                     p_table, v_cols[1], v_cols[1], p_table, v_where) using p_target;
    else
      select string_agg(format('%I', c), ', '), string_agg(format('r.%I', c), ', ') into v_list, v_rlist from unnest(v_cols) c;
      execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where %s',
                     p_table, v_list, v_rlist, p_table, v_where) using p_target;
    end if;
  else
    v_cols := private.undo_columns(p_table, p_target);
    select string_agg(format('%I', c), ', ') into v_list from unnest(v_cols) c;
    execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_record(null::public.%I, $1)',
                   p_table, v_list, v_list, p_table) using p_target;
  end if;
end $$;

-- Invierte UN evento de auditoría (con control de conflictos)
create or replace function private.undo_invert_event(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.audit_events; v_cur jsonb; v_where text; v_what text;
begin
  select * into e from public.audit_events where id = p_id;
  if to_regclass('public.' || e.table_name) is null then
    raise exception 'El módulo «%» ya no existe.', e.table_name using errcode = '22023';
  end if;
  v_where := private.undo_key_where(e.table_name);
  if v_where is null then raise exception 'El módulo «%» no admite deshacer.', e.table_name using errcode = '22023'; end if;
  v_what := private.undo_table_label(e.table_name) || coalesce(' «' || private.undo_record_name(coalesce(e.new_data, e.old_data)) || '»', '');
  execute format('select to_jsonb(t) from public.%I t where %s', e.table_name, v_where)
    into v_cur using coalesce(e.new_data, e.old_data);

  if e.operation = 'INSERT' then
    if v_cur is null then return; end if;  -- ya no existe: nada que deshacer
    if not private.undo_row_matches(e.table_name, v_cur, e.new_data) then
      raise exception 'No se puede deshacer: % cambió después por otra acción.', v_what using errcode = '40001';
    end if;
    execute format('delete from public.%I t where %s', e.table_name, v_where) using e.new_data;
  elsif e.operation = 'DELETE' then
    if v_cur is not null then
      if private.undo_row_matches(e.table_name, v_cur, e.old_data) then return; end if;  -- ya restaurado
      raise exception 'No se puede restaurar: ya existe otro registro igual (%).', v_what using errcode = '23505';
    end if;
    perform private.undo_put_row(e.table_name, e.old_data);
  elsif e.operation = 'UPDATE' then
    if v_cur is null then
      raise exception 'No se puede deshacer: % se eliminó después.', v_what using errcode = '40001';
    end if;
    if not private.undo_row_matches(e.table_name, v_cur, e.new_data, e.changed_fields) then
      raise exception 'No se puede deshacer: % cambió después por otra acción.', v_what using errcode = '40001';
    end if;
    perform private.undo_put_row(e.table_name, e.old_data, e.changed_fields);
  end if;
end $$;

-- Invierte una transacción completa (orden inverso; reintenta por dependencias)
create or replace function private.undo_apply(p_tx bigint, p_org uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_pending bigint[]; v_next bigint[]; v_id bigint; v_progress boolean; v_err text; v_done int := 0; v_msg text;
begin
  v_msg := private.undo_tx_check(p_tx, p_org);
  if v_msg is not null then raise exception '%', v_msg using errcode = '22023'; end if;
  if exists (select 1 from public.audit_events where tx_id = p_tx
              and table_name in ('memberships','roles','role_permissions'))
     and private.current_aal() <> 'aal2' and not private.is_platform_admin() then
    raise exception 'Para deshacer cambios de roles y permisos debe iniciar sesión con verificación en dos pasos (MFA).' using errcode = '42501';
  end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  select array_agg(id order by id desc) into v_pending
    from public.audit_events where tx_id = p_tx and operation in ('INSERT','UPDATE','DELETE');
  loop
    v_progress := false; v_next := '{}';
    foreach v_id in array v_pending loop
      begin
        perform private.undo_invert_event(v_id);
        v_progress := true; v_done := v_done + 1;
      exception when foreign_key_violation then
        v_next := v_next || v_id; v_err := sqlerrm;
      end;
    end loop;
    exit when cardinality(v_next) = 0;
    if not v_progress then
      raise exception 'No se puede deshacer: hay registros relacionados que ya no existen o cambiaron.' using errcode = '23503', detail = v_err;
    end if;
    v_pending := v_next;
  end loop;
  perform set_config('sematec.audit_reason', '', true);
  return v_done;
end $$;

-- Transacción que corresponde invertir para un grupo (la última de su cadena)
create or replace function private.undo_chain_head(p_root bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select applied_tx from public.undo_log where root_tx = p_root order by id desc limit 1), p_root)
$$;
-- ¿Está deshecho? (cantidad impar de inversiones)
create or replace function private.undo_is_undone(p_root bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.undo_log where root_tx = p_root) % 2 = 1
$$;

-- Verificación previa (sin modificar nada) de lo que pasaría al invertir una transacción:
--   'conflict' = algún registro cambió después por otra acción (no se debe deshacer)
--   'noop'     = ya no hay nada que revertir (p. ej., lo creado ya fue eliminado)
--   'ok'       = se puede deshacer
create or replace function private.undo_tx_state(p_tx bigint)
returns text language plpgsql stable security definer set search_path = '' as $$
declare e record; v_cur jsonb; v_where text; v_changes boolean := false;
begin
  for e in select distinct on (a.table_name, a.record_id) a.*
             from public.audit_events a
            where a.tx_id = p_tx and a.operation in ('INSERT','UPDATE','DELETE')
            order by a.table_name, a.record_id, a.id desc loop
    if to_regclass('public.' || e.table_name) is null then return 'conflict'; end if;
    v_where := private.undo_key_where(e.table_name);
    if v_where is null then return 'conflict'; end if;
    execute format('select to_jsonb(t) from public.%I t where %s', e.table_name, v_where)
      into v_cur using coalesce(e.new_data, e.old_data);
    if e.operation = 'DELETE' then
      if v_cur is null then v_changes := true;
      elsif not private.undo_row_matches(e.table_name, v_cur, e.old_data) then return 'conflict'; end if;
    elsif e.operation = 'INSERT' then
      if v_cur is not null then
        if not private.undo_row_matches(e.table_name, v_cur, e.new_data) then return 'conflict'; end if;
        v_changes := true;
      end if;
    elsif v_cur is null or not private.undo_row_matches(e.table_name, v_cur, e.new_data, e.changed_fields) then
      return 'conflict';
    else
      v_changes := true;
    end if;
  end loop;
  return case when v_changes then 'ok' else 'noop' end;
end $$;

-- Mis acciones recientes (última hora) que se pueden deshacer, más reciente primero
create or replace function private.undo_my_groups(p_org uuid)
returns table (tx_id bigint, last_id bigint, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.tx_id, max(e.id), max(e.occurred_at)
    from public.audit_events e
   where e.organization_id = p_org and e.actor_id = auth.uid() and e.tx_id is not null
     and e.occurred_at > now() - interval '60 minutes'
     and not exists (select 1 from public.undo_log u where u.applied_tx = e.tx_id and u.kind <> 'restore')
   group by e.tx_id
  having bool_and(e.operation <> 'ACTION' and e.table_name <> all(private.undo_blocked_tables()))
   order by max(e.id) desc
   limit 50
$$;

-- ---------------------------------------------------------------------
-- 3. Funciones para la aplicación
-- ---------------------------------------------------------------------
-- Estado de la barra ↶ ↷ del usuario
create or replace function public.undo_status(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g record; u record; v_undo bigint; v_undo_at timestamptz; v_redo bigint; v_redo_at timestamptz;
        v_last_action timestamptz; v_n int := 0;
begin
  if auth.uid() is null or not private.is_member(p_org) then return jsonb_build_object('undo', null, 'redo', null); end if;
  -- Deshacer: la acción más reciente que siga intacta (si otra persona la modificó, se salta)
  for g in select x.tx_id, x.at from private.undo_my_groups(p_org) x where not private.undo_is_undone(x.tx_id) order by x.last_id desc loop
    v_last_action := greatest(v_last_action, g.at);
    v_n := v_n + 1;
    if v_undo is null and v_n <= 15 and private.undo_tx_state(private.undo_chain_head(g.tx_id)) = 'ok' then
      v_undo := g.tx_id; v_undo_at := g.at;
    end if;
  end loop;
  -- Rehacer: lo último que deshizo, si no hizo otra acción después
  for u in select l.root_tx, l.created_at from public.undo_log l
            where l.organization_id = p_org and l.actor_id = auth.uid() and l.kind = 'undo'
              and l.created_at > now() - interval '60 minutes'
              and l.id = (select max(x.id) from public.undo_log x where x.root_tx = l.root_tx)
              and (v_last_action is null or l.created_at > v_last_action)
            order by l.id desc limit 5 loop
    if private.undo_tx_state(private.undo_chain_head(u.root_tx)) = 'ok' then
      v_redo := u.root_tx; v_redo_at := u.created_at; exit;
    end if;
  end loop;
  return jsonb_build_object(
    'undo', case when v_undo is not null then jsonb_build_object('tx', v_undo::text, 'label', private.undo_tx_label(v_undo), 'at', v_undo_at) end,
    'redo', case when v_redo is not null then jsonb_build_object('tx', v_redo::text, 'label', private.undo_tx_label(v_redo), 'at', v_redo_at) end);
end $$;

-- ↶ Deshacer mi última acción
create or replace function public.undo_last(p_org uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_st jsonb; v_root bigint; v_label text;
begin
  if auth.uid() is null or not private.is_member(p_org) then raise exception 'No tiene acceso a esta institución' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('undo:' || auth.uid()::text, 0));
  v_st := public.undo_status(p_org);
  if v_st -> 'undo' = 'null'::jsonb or v_st -> 'undo' is null then
    raise exception 'No hay cambios recientes suyos para deshacer (se puede deshacer lo hecho en la última hora).' using errcode = 'P0002';
  end if;
  v_root := (v_st -> 'undo' ->> 'tx')::bigint; v_label := v_st -> 'undo' ->> 'label';
  if exists (select 1 from public.audit_events where tx_id = private.undo_chain_head(v_root) and actor_id is distinct from auth.uid()) then
    raise exception 'Ese cambio incluye acciones de otra persona: solo el propietario puede revertirlo desde el Historial.' using errcode = '42501';
  end if;
  perform private.undo_apply(private.undo_chain_head(v_root), p_org, 'Deshacer: ' || v_label);
  insert into public.undo_log (organization_id, actor_id, root_tx, source_tx, applied_tx, kind, label)
  values (p_org, auth.uid(), v_root, private.undo_chain_head(v_root), private.audit_group(), 'undo', v_label);
  return v_label;
end $$;

-- ↷ Rehacer lo último que deshice
create or replace function public.redo_last(p_org uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_st jsonb; v_root bigint; v_label text;
begin
  if auth.uid() is null or not private.is_member(p_org) then raise exception 'No tiene acceso a esta institución' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('undo:' || auth.uid()::text, 0));
  v_st := public.undo_status(p_org);
  if v_st -> 'redo' = 'null'::jsonb or v_st -> 'redo' is null then
    raise exception 'No hay nada para rehacer.' using errcode = 'P0002';
  end if;
  v_root := (v_st -> 'redo' ->> 'tx')::bigint; v_label := v_st -> 'redo' ->> 'label';
  if exists (select 1 from public.audit_events where tx_id = private.undo_chain_head(v_root) and actor_id is distinct from auth.uid()) then
    raise exception 'Ese cambio incluye acciones de otra persona: solo el propietario puede revertirlo desde el Historial.' using errcode = '42501';
  end if;
  perform private.undo_apply(private.undo_chain_head(v_root), p_org, 'Rehacer: ' || v_label);
  insert into public.undo_log (organization_id, actor_id, root_tx, source_tx, applied_tx, kind, label)
  values (p_org, auth.uid(), v_root, private.undo_chain_head(v_root), private.audit_group(), 'redo', v_label);
  return v_label;
end $$;

-- 🗑 Papelera: lo eliminado en los últimos 30 días (solo propietario)
create or replace function public.trash_list(p_org uuid)
returns table (tx_id text, deleted_at timestamptz, actor_name text, label text, items integer, table_name text, record_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner(p_org) then raise exception 'Solo el propietario institucional puede ver la papelera' using errcode = '42501'; end if;
  return query
  select g.tx_id::text, g.at, coalesce(p.full_name, 'Sistema'), private.undo_tx_label(g.tx_id), g.n::int, g.tbl, g.rec
    from (
      select e.tx_id, max(e.occurred_at) at, min(e.actor_id::text)::uuid actor, count(*) n,
             (array_agg(e.table_name order by e.id))[1] tbl, (array_agg(e.record_id order by e.id))[1] rec
        from public.audit_events e
       where e.organization_id = p_org and e.tx_id is not null and e.occurred_at > now() - interval '30 days'
         and not exists (select 1 from public.undo_log u where u.applied_tx = e.tx_id)
       group by e.tx_id
      having bool_or(e.operation = 'DELETE') and bool_and(e.operation <> 'INSERT')
         and bool_and(e.operation <> 'ACTION' and e.table_name <> all(private.undo_blocked_tables()))
    ) g
    left join public.profiles p on p.id = g.actor
   where private.undo_tx_state(g.tx_id) = 'ok'
   order by g.at desc
   limit 200;
end $$;

-- ♻ Restaurar desde la papelera (o deshacer cualquier cambio como propietario)
create or replace function public.restore_change(p_org uuid, p_tx bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare v_label text;
begin
  if not private.is_owner(p_org) then raise exception 'Solo el propietario institucional puede restaurar' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('undo-root:' || p_tx::text, 0));
  if exists (select 1 from public.undo_log where applied_tx = p_tx and kind <> 'restore') then
    raise exception 'Ese cambio es un deshacer; use el Historial del registro.' using errcode = '22023';
  end if;
  if private.undo_tx_state(p_tx) <> 'ok' then
    raise exception 'No se puede restaurar: ya fue restaurado o el registro cambió después.' using errcode = '23505';
  end if;
  v_label := private.undo_tx_label(p_tx);
  perform private.undo_apply(p_tx, p_org, 'Restaurar: ' || v_label);
  insert into public.undo_log (organization_id, actor_id, root_tx, source_tx, applied_tx, kind, label)
  values (p_org, auth.uid(), p_tx, p_tx, private.audit_group(), 'restore', v_label);
  return regexp_replace(v_label, '^Eliminar ', '');
end $$;

-- 🕘 Historial de versiones de un registro (solo propietario)
create or replace function public.record_history(p_table text, p_id text)
returns table (event_id text, occurred_at timestamptz, actor_name text, operation text, changed_fields text[],
               old_data jsonb, new_data jsonb, reason text, restorable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  select e.organization_id into v_org from public.audit_events e
   where e.table_name = p_table and e.record_id = p_id order by e.id desc limit 1;
  if v_org is null or not private.is_owner(v_org) then
    raise exception 'Solo el propietario institucional puede ver el historial de este registro' using errcode = '42501';
  end if;
  return query
  select e.id::text, e.occurred_at, coalesce(p.full_name, 'Sistema'), e.operation, e.changed_fields,
         private.undo_safe_json(e.old_data), private.undo_safe_json(e.new_data), e.reason,
         (p_table <> all(private.undo_blocked_tables()) and e.operation in ('INSERT','UPDATE','DELETE'))
    from public.audit_events e
    left join public.profiles p on p.id = e.actor_id
   where e.table_name = p_table and e.record_id = p_id and e.organization_id = v_org
   order by e.id desc
   limit 200;
end $$;

-- Oculta campos que nunca deben mostrarse (claves, tokens, binarios)
create or replace function private.undo_safe_json(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p is null then null else coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(p) as x(k, v)
     where k !~* '(password|secret|token|hash|bytes|private|api_key)'), '{}'::jsonb) end
$$;

-- ↺ Volver a una versión: deja el registro como quedó tras ese cambio
--    (o como estaba justo antes, si el cambio fue una eliminación)
create or replace function public.restore_version(p_event bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare e public.audit_events; v_target jsonb;
begin
  select * into e from public.audit_events where id = p_event;
  if e.id is null then raise exception 'Versión no encontrada' using errcode = 'P0002'; end if;
  if e.organization_id is null or not private.is_owner(e.organization_id) then
    raise exception 'Solo el propietario institucional puede restaurar versiones' using errcode = '42501';
  end if;
  if e.table_name = any(private.undo_blocked_tables()) or e.operation not in ('INSERT','UPDATE','DELETE') then
    raise exception 'Este registro está protegido: use su procedimiento formal (anular o rectificar).' using errcode = '22023';
  end if;
  v_target := case when e.operation = 'DELETE' then e.old_data else e.new_data end;
  perform set_config('sematec.audit_reason', 'Restaurar versión del ' || to_char(e.occurred_at at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI'), true);
  perform private.undo_put_row(e.table_name, v_target);
  perform set_config('sematec.audit_reason', '', true);
  return private.undo_table_label(e.table_name) || coalesce(' «' || private.undo_record_name(v_target) || '»', '');
end $$;

revoke all on function public.undo_status(uuid), public.undo_last(uuid), public.redo_last(uuid), public.trash_list(uuid),
  public.restore_change(uuid, bigint), public.record_history(text, text), public.restore_version(bigint) from public, anon;
grant execute on function public.undo_status(uuid), public.undo_last(uuid), public.redo_last(uuid), public.trash_list(uuid),
  public.restore_change(uuid, bigint), public.record_history(text, text), public.restore_version(bigint) to authenticated;
