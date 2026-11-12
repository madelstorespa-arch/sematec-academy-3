-- =====================================================================
-- 1. Inscripción ampliada: curso o carrera, jornada, modalidad y tres formas de pago
--    · En línea (como antes)
--    · Transferencia: la persona sube el comprobante y la institución lo verifica
--    · Presencial: paga en la oficina; caja confirma el pago
-- 2. Registro de correos enviados (para saber si llegaron o por qué fallaron)
-- 3. «Ocultar para… / por…»: ocultar un registro a un público y por un tiempo
-- =====================================================================

-- ---------------------------------------------------------------- 1. Configuración
create or replace function private.registration_config(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
      'enabled', coalesce((v ->> 'enabled')::boolean, false),
      'fee', greatest(coalesce((v ->> 'fee')::numeric, 0), 0),
      'currency', coalesce(nullif(v ->> 'currency', ''), o.base_currency),
      'title', coalesce(nullif(v ->> 'title', ''), 'Inscripción'),
      'intro', coalesce(v ->> 'intro', ''),
      'ask_birth', coalesce((v ->> 'ask_birth')::boolean, true),
      'ask_address', coalesce((v ->> 'ask_address')::boolean, true),
      'ask_education', coalesce((v ->> 'ask_education')::boolean, true),
      'ask_guardian', coalesce((v ->> 'ask_guardian')::boolean, false),
      'ask_program', coalesce((v ->> 'ask_program')::boolean, true),
      'shifts', coalesce(case when jsonb_typeof(v -> 'shifts') = 'array' and jsonb_array_length(v -> 'shifts') > 0 then v -> 'shifts' end, '["Día","Noche"]'::jsonb),
      'modalities', coalesce(case when jsonb_typeof(v -> 'modalities') = 'array' and jsonb_array_length(v -> 'modalities') > 0 then v -> 'modalities' end, '["Presencial","En línea","Semipresencial"]'::jsonb),
      'pay_online', coalesce((v ->> 'pay_online')::boolean, true),
      'pay_transfer', coalesce((v ->> 'pay_transfer')::boolean, true),
      'pay_office', coalesce((v ->> 'pay_office')::boolean, true),
      'bank_info', coalesce(v ->> 'bank_info', ''),
      'office_info', coalesce(v ->> 'office_info', ''),
      'notify_email', coalesce(v ->> 'notify_email', ''),
      -- Carreras y cursos para elegir en el formulario
      'programs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'group', x.grp) order by x.grp, x.name) from (
          select p.id, p.name, 'Carreras y programas' grp from public.programs p where p.organization_id = o.id and p.status = 'active'
          union all
          select c.id, c.title, 'Cursos' from public.catalog_offerings c where c.organization_id = o.id and c.is_published) x), '[]'::jsonb))
  from public.organizations o
  left join lateral (select s.value v from public.organization_settings s where s.organization_id = o.id and s.key = 'inscripcion.general') x on true
  where o.id = p_org
$$;

create or replace function private.clean_registration_form(p_form jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, left(trim(p_form ->> k), 500)) filter (where nullif(trim(p_form ->> k), '') is not null), '{}'::jsonb)
  from unnest(array['birth_date','address','city','education','guardian_name','guardian_phone','how_found','notes','nationality',
                    'program_id','program','shift','modality','pay_method']) k
$$;

-- ---------------------------------------------------------------- 1. Solicitudes por verificar
create table if not exists public.registration_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tracking_code   text not null unique,
  method          text not null check (method in ('transfer','office')),
  name            text not null check (length(trim(name)) between 3 and 160),
  email           text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone           text,
  doc_country     char(2), doc_type text, doc_number text,
  form_data       jsonb not null default '{}'::jsonb,
  amount          numeric(14,2) not null check (amount >= 0),
  currency        char(3) not null,
  reference       text check (reference is null or length(reference) <= 120),
  receipt_path    text,
  receipt_name    text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_notes    text check (review_notes is null or length(review_notes) <= 500),
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  student_id      uuid,
  registration_id uuid references public.registrations(id),
  created_at      timestamptz not null default now()
);
create index if not exists registration_requests_org_idx on public.registration_requests (organization_id, status, created_at desc);
alter table public.registration_requests enable row level security;
drop policy if exists regreq_read on public.registration_requests;
create policy regreq_read on public.registration_requests for select to authenticated
  using (private.has_permission(organization_id, 'students.view') or private.has_permission(organization_id, 'finance.view'));
grant select on public.registration_requests to authenticated;
grant all on public.registration_requests to service_role;
drop trigger if exists trg_regreq_audit on public.registration_requests;
create trigger trg_regreq_audit after insert or update or delete on public.registration_requests for each row execute function private.audit_row();

-- Desde el sitio: inscripción con comprobante o con pago en la oficina
create or replace function public.create_registration_request(
  p_org uuid, p_method text, p_name text, p_email text, p_phone text,
  p_doc_country char(2), p_doc_type text, p_doc_number text, p_form jsonb, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := private.registration_config(p_org); v_id uuid; v_code text;
begin
  if cfg is null or not (cfg ->> 'enabled')::boolean then raise exception 'La inscripción en línea no está habilitada' using errcode = '42501'; end if;
  if p_method not in ('transfer','office') then raise exception 'Forma de pago inválida' using errcode = '22023'; end if;
  if (p_method = 'transfer' and not (cfg ->> 'pay_transfer')::boolean) or (p_method = 'office' and not (cfg ->> 'pay_office')::boolean) then
    raise exception 'Esa forma de pago no está disponible' using errcode = '22023';
  end if;
  if (cfg ->> 'fee')::numeric <= 0 then raise exception 'La inscripción no tiene costo: envíe el formulario sin pago' using errcode = '22023'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Escriba su nombre completo' using errcode = '22023'; end if;
  if private.rate_limited('regreq', lower(p_email), 5, interval '1 hour') then
    raise exception 'Demasiados intentos. Intente más tarde.' using errcode = '54000';
  end if;
  v_code := private.new_tracking_code();
  insert into public.registration_requests (organization_id, tracking_code, method, name, email, phone, doc_country, doc_type, doc_number, form_data, amount, currency, reference)
  values (p_org, v_code, p_method, trim(p_name), lower(trim(p_email)), nullif(trim(coalesce(p_phone, '')), ''), p_doc_country, p_doc_type,
          nullif(upper(trim(coalesce(p_doc_number, ''))), ''), private.clean_registration_form(coalesce(p_form, '{}'::jsonb) || jsonb_build_object('pay_method', p_method)),
          (cfg ->> 'fee')::numeric, cfg ->> 'currency', nullif(trim(coalesce(p_reference, '')), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'tracking_code', v_code, 'amount', (cfg ->> 'fee')::numeric, 'currency', cfg ->> 'currency');
end $$;
revoke all on function public.create_registration_request(uuid, text, text, text, text, char, text, text, jsonb, text) from public;
grant execute on function public.create_registration_request(uuid, text, text, text, text, char, text, text, jsonb, text) to anon, authenticated;

-- Aprobar: registra al estudiante con el pago (comprobante verificado o pagado en caja)
create or replace function public.approve_registration_request(p_id uuid, p_user uuid, p_amount numeric, p_method text, p_reference text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.registration_requests; r jsonb;
begin
  select * into q from public.registration_requests where id = p_id for update;
  if q.id is null then raise exception 'Solicitud no encontrada' using errcode = 'P0002'; end if;
  if not private.has_permission(q.organization_id, 'students.create') then raise exception 'No autorizado (students.create).' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) > 0 and not private.has_permission(q.organization_id, 'finance.create') then
    raise exception 'Para registrar el pago necesita el permiso de finanzas.' using errcode = '42501';
  end if;
  if q.status <> 'pending' then raise exception 'La solicitud ya fue revisada' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Monto inválido' using errcode = '22023'; end if;
  if p_method is not null and p_method not in ('cash','bank_transfer','card','payment_gateway','check','other') then raise exception 'Medio de pago inválido' using errcode = '22023'; end if;
  if p_user is not null and not exists (select 1 from public.profiles where id = p_user and lower(email) = q.email) then
    raise exception 'La cuenta no corresponde al correo de la solicitud' using errcode = '42501';
  end if;
  r := private.register_student(q.organization_id, p_user, q.name, null, null, q.email, q.phone, q.doc_country, q.doc_type, q.doc_number, q.form_data,
         'web', coalesce(p_amount, q.amount), q.currency, coalesce(p_method, case q.method when 'transfer' then 'bank_transfer' else 'cash' end), null,
         coalesce(nullif(trim(coalesce(p_reference, '')), ''), q.reference), null,
         coalesce(nullif(trim(coalesce(p_notes, '')), ''), case q.method when 'transfer' then 'Inscripción · comprobante verificado' else 'Inscripción · pagada en la oficina' end) || ' (' || q.tracking_code || ')',
         auth.uid());
  update public.registration_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(coalesce(p_notes, '')), ''),
         student_id = (r ->> 'student_id')::uuid, registration_id = (r ->> 'registration_id')::uuid where id = q.id;
  return r;
end $$;
revoke all on function public.approve_registration_request(uuid, uuid, numeric, text, text, text) from public, anon;
grant execute on function public.approve_registration_request(uuid, uuid, numeric, text, text, text) to authenticated;

create or replace function public.reject_registration_request(p_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.registration_requests;
begin
  select * into q from public.registration_requests where id = p_id for update;
  if q.id is null then raise exception 'Solicitud no encontrada' using errcode = 'P0002'; end if;
  if not private.has_permission(q.organization_id, 'students.create') then raise exception 'No autorizado (students.create).' using errcode = '42501'; end if;
  if q.status <> 'pending' then raise exception 'La solicitud ya fue revisada' using errcode = '22023'; end if;
  if length(trim(coalesce(p_notes, ''))) < 3 then raise exception 'Escriba el motivo para la persona' using errcode = '22023'; end if;
  update public.registration_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = left(trim(p_notes), 500) where id = p_id;
end $$;
revoke all on function public.reject_registration_request(uuid, text) from public, anon;
grant execute on function public.reject_registration_request(uuid, text) to authenticated;

-- Estado de la solicitud para la persona (código + correo)
create or replace function public.registration_request_status(p_code text, p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', q.status, 'method', q.method, 'amount', q.amount, 'currency', q.currency, 'notes', q.review_notes,
                            'program', q.form_data ->> 'program', 'shift', q.form_data ->> 'shift', 'modality', q.form_data ->> 'modality', 'has_receipt', q.receipt_path is not null)
  from public.registration_requests q where q.tracking_code = upper(trim(p_code)) and q.email = lower(trim(p_email))
$$;
grant execute on function public.registration_request_status(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 2. Registro de correos
create table if not exists public.mail_log (
  id              bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  to_email        text not null,
  subject         text not null,
  kind            text not null default 'general',
  status          text not null check (status in ('sent','failed','off')),
  error           text,
  sent_by         uuid,
  created_at      timestamptz not null default now()
);
create index if not exists mail_log_org_idx on public.mail_log (organization_id, created_at desc);
alter table public.mail_log enable row level security;
drop policy if exists mail_log_read on public.mail_log;
create policy mail_log_read on public.mail_log for select to authenticated
  using (private.is_owner(organization_id) or private.has_permission(organization_id, 'settings.admin') or private.is_platform_admin());
grant select on public.mail_log to authenticated;
grant all on public.mail_log to service_role;

-- ---------------------------------------------------------------- 3. Ocultar para… / por…
create table if not exists public.hidden_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_name      text not null check (table_name ~ '^[a-z_]{2,60}$'),
  record_id       uuid not null,
  audience        text[] not null check (audience <@ array['all','public','students','teachers','guardians','staff']::text[] and cardinality(audience) > 0),
  hidden_until    timestamptz,
  reason          text check (reason is null or length(reason) <= 200),
  hidden_by       uuid not null default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (table_name, record_id)
);
create index if not exists hidden_records_lookup on public.hidden_records (table_name, record_id);
alter table public.hidden_records enable row level security;
drop policy if exists hidden_read on public.hidden_records;
create policy hidden_read on public.hidden_records for select to authenticated using (private.is_member(organization_id));
grant select on public.hidden_records to authenticated;
grant all on public.hidden_records to service_role;
drop trigger if exists trg_hidden_audit on public.hidden_records;
create trigger trg_hidden_audit after insert or update or delete on public.hidden_records for each row execute function private.audit_row();

-- ¿Está oculto este registro para la persona actual? (quien administra siempre lo ve)
create or replace function private.hidden_for_me(p_table text, p_id uuid, p_org uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare h public.hidden_records; v_uid uuid := auth.uid();
begin
  select * into h from public.hidden_records where table_name = p_table and record_id = p_id;
  if h.id is null or (h.hidden_until is not null and h.hidden_until <= now()) then return false; end if;
  if v_uid is null then return h.audience && array['all','public']; end if;
  if h.hidden_by = v_uid or private.is_owner(h.organization_id) or private.has_permission(h.organization_id, 'settings.admin') then return false; end if;
  if 'all' = any(h.audience) then return true; end if;
  return ('students' = any(h.audience) and exists (select 1 from public.students s where s.user_id = v_uid and s.organization_id = h.organization_id))
      or ('teachers' = any(h.audience) and exists (select 1 from public.teachers t where t.user_id = v_uid and t.organization_id = h.organization_id))
      or ('guardians' = any(h.audience) and exists (select 1 from public.guardian_links g where g.guardian_id = v_uid and g.organization_id = h.organization_id and g.status = 'activo'))
      or ('staff' = any(h.audience) and private.is_staff(h.organization_id));
end $$;
grant execute on function private.hidden_for_me(text, uuid, uuid) to anon, authenticated;

-- Tablas de contenido que se pueden ocultar: política RESTRICTIVA (se suma a las que ya existen)
do $$
declare t text;
begin
  foreach t in array array['announcements','calendar_events','library_items','job_postings','surveys','catalog_offerings','offices','resources',
                           'course_contents','course_units','class_materials','forum_threads','user_files','conference_sessions','products','media_assets','quizzes','assignments','benefits'] loop
    if to_regclass('public.' || t) is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'organization_id') then
      execute format('drop policy if exists hide_%1$s on public.%1$I', t);
      execute format('create policy hide_%1$s on public.%1$I as restrictive for select to anon, authenticated using (not private.hidden_for_me(%2$L, id, organization_id))', t, t);
    end if;
  end loop;
end $$;

-- Ocultar / mostrar (quien puede editar el registro: propietario o administración)
create or replace function public.hide_record(p_table text, p_id uuid, p_audience text[], p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_table not in ('announcements','calendar_events','library_items','job_postings','surveys','catalog_offerings','offices','resources',
                     'course_contents','course_units','class_materials','forum_threads','user_files','conference_sessions','products','media_assets','quizzes','assignments','benefits') then
    raise exception 'Este tipo de registro no se puede ocultar' using errcode = '22023';
  end if;
  execute format('select organization_id from public.%I where id = $1', p_table) into v_org using p_id;
  if v_org is null then raise exception 'Registro no encontrado' using errcode = 'P0002'; end if;
  if not (private.is_owner(v_org) or private.has_permission(v_org, 'settings.admin')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_until is not null and p_until <= now() then raise exception 'La fecha debe ser futura' using errcode = '22023'; end if;
  insert into public.hidden_records (organization_id, table_name, record_id, audience, hidden_until, reason, hidden_by)
  values (v_org, p_table, p_id, p_audience, p_until, nullif(trim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (table_name, record_id) do update set audience = excluded.audience, hidden_until = excluded.hidden_until, reason = excluded.reason,
         hidden_by = excluded.hidden_by, created_at = now();
end $$;
revoke all on function public.hide_record(text, uuid, text[], timestamptz, text) from public, anon;
grant execute on function public.hide_record(text, uuid, text[], timestamptz, text) to authenticated;

create or replace function public.unhide_record(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.hidden_records;
begin
  select * into h from public.hidden_records where table_name = p_table and record_id = p_id;
  if h.id is null then return; end if;
  if not (private.is_owner(h.organization_id) or private.has_permission(h.organization_id, 'settings.admin')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  delete from public.hidden_records where id = h.id;
end $$;
revoke all on function public.unhide_record(text, uuid) from public, anon;
grant execute on function public.unhide_record(text, uuid) to authenticated;
