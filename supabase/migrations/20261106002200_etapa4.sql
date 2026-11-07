-- =====================================================================
-- Etapa 4: documento opcional, precios con descuento y catálogo de
-- cursos/carreras, biblioteca virtual por carrera/asignatura/curso,
-- Punto estudiantil, oficinas por rol (mesa de discusión y citas) y
-- administración total del propietario.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. N° de documento opcional (no se pide a los usuarios)
-- ---------------------------------------------------------------------
alter table public.students  alter column id_document_country drop not null, alter column id_document_type drop not null, alter column id_document_number drop not null;
alter table public.teachers  alter column id_document_country drop not null, alter column id_document_type drop not null, alter column id_document_number drop not null;
alter table public.employees alter column id_document_country drop not null, alter column id_document_type drop not null, alter column id_document_number drop not null;
alter table public.checkout_orders alter column buyer_doc_type drop not null, alter column buyer_doc_number drop not null;

-- ---------------------------------------------------------------------
-- 2. Catálogo: cursos y carreras disponibles, precio normal y descuento
-- ---------------------------------------------------------------------
alter table public.catalog_offerings
  add column if not exists kind text not null default 'curso' check (kind in ('curso','carrera','diplomado','taller')),
  add column if not exists regular_price numeric(14,2) check (regular_price is null or regular_price >= 0),
  add column if not exists discount_pct numeric(5,2) check (discount_pct is null or discount_pct between 0 and 100),
  add column if not exists discount_ends_on date;

-- Precio que se cobra hoy: con descuento vigente = price; vencido el descuento = precio normal
create or replace function private.offering_price(o public.catalog_offerings)
returns numeric language sql stable set search_path = '' as $$
  select case
    when o.regular_price is not null and o.regular_price > o.price
         and o.discount_ends_on is not null and o.discount_ends_on < current_date then o.regular_price
    else o.price end
$$;
grant execute on function private.offering_price(public.catalog_offerings) to anon, authenticated;

-- Vista pública de precios (para el sitio): precio actual, normal y ahorro
create or replace function public.offering_prices(p_org uuid)
returns table (id uuid, current_price numeric, regular_price numeric, saving numeric, discount_pct numeric, discount_ends_on date)
language sql stable security definer set search_path = '' as $$
  select o.id, private.offering_price(o),
         coalesce(o.regular_price, o.price),
         greatest(coalesce(o.regular_price, o.price) - private.offering_price(o), 0),
         case when coalesce(o.regular_price, 0) > private.offering_price(o)
              then round(100 * (o.regular_price - private.offering_price(o)) / o.regular_price, 0) end,
         case when coalesce(o.regular_price, 0) > private.offering_price(o) then o.discount_ends_on end
  from public.catalog_offerings o
  where o.organization_id = p_org and (o.is_published or private.is_member(o.organization_id))
$$;
grant execute on function public.offering_prices(uuid) to anon, authenticated;


-- El pago usa el precio vigente (con o sin descuento) y no exige documento
create or replace function public.create_checkout_order(
  p_offering uuid, p_provider text, p_name text, p_email text, p_phone text,
  p_doc_country char(2), p_doc_type text, p_doc_number text, p_tracking_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare off public.catalog_offerings; a public.applications; v_code text; v_id uuid; v_num bigint; v_taken int;
begin
  select * into off from public.catalog_offerings where id = p_offering and is_published;
  if not found then raise exception 'Curso no disponible' using errcode = 'P0002'; end if;
  if off.admission_mode = 'application' then
    select * into a from public.applications
     where tracking_code = upper(trim(coalesce(p_tracking_code, ''))) and applicant_email = lower(trim(p_email)) and offering_id = off.id;
    if a.id is null or a.status <> 'approved' then
      raise exception 'Este curso requiere una postulación aprobada antes del pago' using errcode = '42501';
    end if;
    if exists (select 1 from public.checkout_orders where application_id = a.id and status = 'paid') then
      raise exception 'Esta postulación ya fue pagada' using errcode = '23505';
    end if;
    v_code := a.tracking_code;
  else
    v_code := private.new_tracking_code();
  end if;
  if off.capacity is not null then
    select count(*) into v_taken from public.checkout_orders where offering_id = off.id and status = 'paid';
    if v_taken >= off.capacity then raise exception 'No quedan cupos disponibles' using errcode = '23514'; end if;
  end if;
  if private.rate_limited('order', lower(p_email), 10, interval '1 hour') then
    raise exception 'Demasiados intentos de pago. Intente más tarde.' using errcode = '54000';
  end if;
  v_num := private.next_number(off.organization_id, 'order');
  insert into public.checkout_orders (organization_id, order_number, offering_id, application_id, buyer_name, buyer_email, buyer_phone,
      buyer_doc_country, buyer_doc_type, buyer_doc_number, amount, currency, provider, tracking_code)
  values (off.organization_id, v_num, off.id, a.id,
      coalesce(a.applicant_name, trim(p_name)), lower(trim(p_email)), nullif(trim(coalesce(p_phone, a.form_data ->> 'phone', '')), ''),
      coalesce(a.form_data ->> 'doc_country', p_doc_country), coalesce(a.form_data ->> 'doc_type', p_doc_type),
      nullif(upper(trim(coalesce(a.form_data ->> 'doc_number', p_doc_number, ''))), ''), private.offering_price(off), off.currency, p_provider, v_code)
  returning id into v_id;
  return jsonb_build_object('order_id', v_id, 'order_number', v_num, 'amount', private.offering_price(off), 'currency', off.currency,
                            'title', off.title, 'tracking_code', v_code);
end $$;

-- ---------------------------------------------------------------------
-- 3. Biblioteca virtual: libros digitales por carrera, asignatura y curso
-- ---------------------------------------------------------------------
create table public.library_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  filename        text not null check (length(filename) between 1 and 200),
  mime_type       text not null,
  size_bytes      int not null check (size_bytes between 1 and 4194304),
  sha256          text not null,
  bytes           bytea not null,
  uploaded_by     uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now()
);
alter table public.library_files enable row level security;
create policy libf_select on public.library_files for select to authenticated using (private.is_member(organization_id));
create policy libf_insert on public.library_files for insert to authenticated with check (private.has_permission(organization_id, 'library.create'));

alter table public.library_items
  add column if not exists program_id uuid references public.programs(id) on delete set null,
  add column if not exists section_id uuid references public.sections(id) on delete set null,
  add column if not exists file_id uuid references public.library_files(id) on delete set null,
  add column if not exists cover_asset_id uuid references public.media_assets(id) on delete set null;
create index if not exists library_items_program on public.library_items (program_id);
create index if not exists library_items_course on public.library_items (course_id);
create index if not exists library_items_section on public.library_items (section_id);
create policy lib_delete on public.library_items for delete to authenticated using (private.has_permission(organization_id, 'library.admin'));
grant delete on public.library_items to authenticated;
grant select, insert on public.library_files to authenticated;
grant all on public.library_files to service_role;

-- Libros virtuales que corresponden al usuario (por su carrera, asignaturas y cursos)
create or replace function public.my_virtual_books(p_org uuid)
returns setof public.library_items language sql stable security definer set search_path = '' as $$
  select li.* from public.library_items li
  where li.organization_id = p_org and private.is_member(p_org)
    and (li.file_id is not null or li.url is not null)
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
grant execute on function public.my_virtual_books(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Punto estudiantil: trámites y solicitudes con seguimiento
-- ---------------------------------------------------------------------
create table public.student_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  number          bigint not null,
  student_id      uuid not null references public.students(id) on delete cascade,
  requester_id    uuid not null default auth.uid() references public.profiles(id),
  kind            text not null check (kind in ('cert_alumno_regular','cert_notas','cert_titulo','justificacion','cambio_seccion',
                                                 'congelamiento','retiro','beca','reclamo','otro')),
  subject         text not null check (length(subject) between 3 and 200),
  details         text check (length(details) <= 4000),
  status          text not null default 'recibida' check (status in ('recibida','en_proceso','resuelta','rechazada')),
  response        text check (length(response) <= 4000),
  handled_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, number)
);
create trigger trg_sreq_updated before update on public.student_requests for each row execute function private.set_updated_at();
create trigger audit_sreq after insert or update or delete on public.student_requests for each row execute function private.audit_row();
alter table public.student_requests enable row level security;
create policy sreq_select on public.student_requests for select to authenticated using (
  student_id in (select private.my_student_ids()) or private.has_permission(organization_id, 'students.view'));
grant select on public.student_requests to authenticated;
grant all on public.student_requests to service_role;

create or replace function public.create_student_request(p_kind text, p_subject text, p_details text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_student uuid; v_org uuid; v_num bigint;
begin
  select id, organization_id into v_student, v_org from public.students where user_id = auth.uid() order by created_at limit 1;
  if v_student is null then raise exception 'Solo estudiantes pueden ingresar trámites' using errcode = '42501'; end if;
  if private.rate_limited('sreq', auth.uid()::text, 20, interval '1 day') then
    raise exception 'Demasiadas solicitudes hoy. Intente mañana.' using errcode = '54000';
  end if;
  v_num := private.next_number(v_org, 'student_request');
  insert into public.student_requests (organization_id, number, student_id, kind, subject, details)
  values (v_org, v_num, v_student, p_kind, trim(p_subject), nullif(trim(p_details), ''));
  return v_num;
end $$;

create or replace function public.answer_student_request(p_id uuid, p_status text, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.student_requests;
begin
  select * into r from public.student_requests where id = p_id for update;
  if not found or not private.has_permission(r.organization_id, 'students.edit') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_status not in ('recibida','en_proceso','resuelta','rechazada') then raise exception 'Estado inválido' using errcode = '22023'; end if;
  update public.student_requests set status = p_status, response = coalesce(nullif(trim(p_response), ''), response), handled_by = auth.uid() where id = p_id;
  insert into public.notifications (user_id, organization_id, category, title, body, data)
  select s.user_id, r.organization_id, 'student_request', 'Punto estudiantil: solicitud N° ' || r.number,
         'Estado: ' || replace(p_status, '_', ' ') || coalesce(' · ' || left(nullif(trim(p_response), ''), 140), ''),
         jsonb_build_object('link', '/app/punto-estudiantil', 'request_id', r.id)
  from public.students s where s.id = r.student_id and s.user_id is not null;
end $$;
revoke all on function public.create_student_request(text, text, text), public.answer_student_request(uuid, text, text) from public, anon;
grant execute on function public.create_student_request(text, text, text), public.answer_student_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Oficinas por rol: mesa de discusión y agenda de citas
-- ---------------------------------------------------------------------
create table public.offices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            text not null,
  name            text not null,
  description     text,
  icon            text not null default '🏢',
  role_codes      text[] not null default '{}',
  accepts_appointments boolean not null default true,
  attention_hours text,
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create table public.office_posts (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references public.offices(id) on delete cascade,
  parent_id       uuid references public.office_posts(id) on delete cascade,
  author_id       uuid not null default auth.uid() references public.profiles(id),
  author_name     text,
  title           text check (title is null or length(title) between 3 and 200),
  body            text not null check (length(body) between 1 and 8000),
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  check ((parent_id is null) = (title is not null))
);
create index on public.office_posts (office_id, parent_id, created_at);
create table public.appointments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  office_id       uuid not null references public.offices(id) on delete cascade,
  requester_id    uuid not null default auth.uid() references public.profiles(id),
  requester_name  text,
  topic           text not null check (length(topic) between 3 and 300),
  details         text check (length(details) <= 2000),
  mode            text not null default 'presencial' check (mode in ('presencial','videollamada','telefono')),
  starts_at       timestamptz not null,
  duration_min    int not null default 30 check (duration_min between 10 and 240),
  status          text not null default 'solicitada' check (status in ('solicitada','confirmada','cancelada','realizada')),
  staff_id        uuid references public.profiles(id),
  staff_note      text check (length(staff_note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.appointments (office_id, starts_at);
create trigger trg_appt_updated before update on public.appointments for each row execute function private.set_updated_at();

-- Integrante de la oficina: tiene uno de sus roles (el propietario integra todas)
create or replace function private.office_member(p_office uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.offices o
    join public.memberships m on m.organization_id = o.organization_id and m.user_id = auth.uid() and m.status = 'active'
      and (m.valid_until is null or m.valid_until > now())
    join public.roles r on r.id = m.role_id
    where o.id = p_office and (r.code = any(o.role_codes) or r.code = 'propietario_institucional'))
  or exists (select 1 from public.offices o where o.id = p_office and private.is_platform_admin())
$$;
grant execute on function private.office_member(uuid) to authenticated;

create or replace function private.fill_author_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'office_posts' then
    select full_name into new.author_name from public.profiles where id = new.author_id;
  else
    select full_name into new.requester_name from public.profiles where id = new.requester_id;
  end if;
  return new;
end $$;
create trigger trg_post_name before insert on public.office_posts for each row execute function private.fill_author_name();
create trigger trg_appt_name before insert on public.appointments for each row execute function private.fill_author_name();

alter table public.offices enable row level security;
alter table public.office_posts enable row level security;
alter table public.appointments enable row level security;
create policy off_select on public.offices for select to authenticated using (private.is_member(organization_id));
create policy off_write on public.offices for all to authenticated
  using (private.has_permission(organization_id, 'security.admin')) with check (private.has_permission(organization_id, 'security.admin'));
create policy op_select on public.office_posts for select to authenticated using (private.office_member(office_id));
create policy op_insert on public.office_posts for insert to authenticated with check (author_id = auth.uid() and private.office_member(office_id));
create policy op_delete on public.office_posts for delete to authenticated using (
  author_id = auth.uid() or exists (select 1 from public.offices o where o.id = office_id and private.has_permission(o.organization_id, 'security.admin')));
create policy ap_select on public.appointments for select to authenticated using (requester_id = auth.uid() or private.office_member(office_id));
create policy ap_insert on public.appointments for insert to authenticated with check (
  requester_id = auth.uid() and private.is_member(organization_id) and status = 'solicitada'
  and exists (select 1 from public.offices o where o.id = office_id and o.organization_id = appointments.organization_id and o.accepts_appointments)
  and starts_at > now());
grant select, insert, update, delete on public.offices to authenticated;
grant select, insert, delete on public.office_posts to authenticated;
grant select, insert on public.appointments to authenticated;
grant all on public.offices, public.office_posts, public.appointments to service_role;

-- Gestionar citas: la oficina confirma, reprograma, marca realizada; quien la pidió puede cancelar
create or replace function public.update_appointment(p_id uuid, p_status text, p_starts timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v_staff boolean; v_title text;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'Cita no encontrada' using errcode = 'P0002'; end if;
  v_staff := private.office_member(a.office_id);
  if not v_staff and not (a.requester_id = auth.uid() and p_status = 'cancelada') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_status not in ('solicitada','confirmada','cancelada','realizada') then raise exception 'Estado inválido' using errcode = '22023'; end if;
  update public.appointments set status = p_status, starts_at = coalesce(p_starts, starts_at),
         staff_id = case when v_staff then auth.uid() else staff_id end,
         staff_note = case when v_staff then coalesce(nullif(trim(p_note), ''), staff_note) else staff_note end
   where id = p_id;
  select name into v_title from public.offices where id = a.office_id;
  insert into public.notifications (organization_id, user_id, category, title, body, data)
  select a.organization_id, case when v_staff then a.requester_id else a.staff_id end, 'appointment',
         'Cita con ' || v_title || ': ' || p_status,
         left(a.topic, 140) || ' · ' || to_char(coalesce(p_starts, a.starts_at) at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI'),
         jsonb_build_object('link', '/app/oficinas', 'appointment_id', a.id)
  where (case when v_staff then a.requester_id else a.staff_id end) is not null
    and (case when v_staff then a.requester_id else a.staff_id end) <> auth.uid();
end $$;
revoke all on function public.update_appointment(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.update_appointment(uuid, text, timestamptz, text) to authenticated;

-- Oficinas predeterminadas de cada institución
create or replace function private.seed_offices(p_org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.offices (organization_id, code, name, description, icon, role_codes, accepts_appointments)
  values
    (p_org, 'direccion', 'Dirección', 'Rectoría y dirección general y académica', '🏛', array['propietario_institucional','rector','director_general','director_academico','director_financiero','administrador_sede'], true),
    (p_org, 'secretaria', 'Secretaría académica', 'Matrículas, certificados, admisión y registro', '🗂', array['secretaria','matriculas','admision','coordinador'], true),
    (p_org, 'docentes', 'Sala de profesores', 'Coordinación académica y docentes', '👩‍🏫', array['profesor','tutor','coordinador','director_academico'], true),
    (p_org, 'finanzas', 'Finanzas y tesorería', 'Pagos, aranceles, becas y convenios', '💰', array['tesoreria','contabilidad','director_financiero'], true),
    (p_org, 'rrhh', 'Recursos humanos', 'Personal, contratos y permisos', '🧑‍💼', array['recursos_humanos'], true),
    (p_org, 'biblioteca', 'Biblioteca', 'Préstamos, biblioteca virtual y salas de estudio', '📚', array['bibliotecario'], true),
    (p_org, 'soporte', 'Soporte técnico', 'Cuentas, plataforma y equipos', '🛠', array['soporte_tecnico'], true),
    (p_org, 'estudiantes', 'Centro de estudiantes', 'Espacio de los estudiantes', '🎒', array['estudiante'], false),
    (p_org, 'egresados', 'Red de egresados', 'Comunidad de egresados', '🎓', array['egresado'], false),
    (p_org, 'apoderados', 'Apoderados', 'Comunidad de apoderados', '👪', array['apoderado'], false)
  on conflict (organization_id, code) do nothing
$$;
select private.seed_offices(id) from public.organizations;

create or replace function public.ensure_offices(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(p_org) then raise exception 'No autorizado' using errcode = '42501'; end if;
  perform private.seed_offices(p_org);
end $$;
revoke all on function public.ensure_offices(uuid) from public, anon;
grant execute on function public.ensure_offices(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Administración total del propietario: suspender, reactivar y eliminar
--    en todos los módulos (con auditoría y protección del historial)
-- ---------------------------------------------------------------------
create or replace function private.is_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id
    where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
      and (m.valid_until is null or m.valid_until > now()) and r.code = 'propietario_institucional')
$$;
grant execute on function private.is_owner(uuid) to authenticated;

create or replace function public.owner_manage(p_table text, p_id uuid, p_op text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := '{
    "programs":          {"col":"status","off":"inactive","on":"active"},
    "courses":           {"col":"status","off":"inactive","on":"active"},
    "sections":          {"col":"status","off":"inactive","on":"active"},
    "campuses":          {"col":"status","off":"inactive","on":"active"},
    "departments":       {"col":"status","off":"inactive","on":"active"},
    "curricula":         {"col":"status","off":"inactive","on":"active"},
    "students":          {"col":"status","off":"suspended","on":"active"},
    "teachers":          {"col":"status","off":"suspended","on":"active"},
    "employees":         {"col":"status","off":"suspended","on":"active"},
    "catalog_offerings": {"col":"is_published","off":"false","on":"true"},
    "job_postings":      {"col":"published","off":"false","on":"true"},
    "surveys":           {"col":"published","off":"false","on":"true"},
    "resources":         {"col":"status","off":"mantencion","on":"disponible"},
    "inventory_items":   {"col":"status","off":"de_baja","on":"operativo"},
    "library_items":     {},
    "announcements":     {},
    "calendar_events":   {},
    "academic_periods":  {},
    "offices":           {},
    "appointments":      {},
    "student_requests":  {},
    "guardian_links":    {},
    "fee_schedules":     {}
  }'::jsonb;
  c jsonb; v_org uuid; v_col_type text;
begin
  c := cfg -> p_table;
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
    if c ->> 'col' is null then raise exception 'Este registro solo se puede eliminar' using errcode = '22023'; end if;
    select format_type(a.atttypid, a.atttypmod) into v_col_type from pg_attribute a
     where a.attrelid = ('public.' || p_table)::regclass and a.attname = c ->> 'col';
    execute format('update public.%I set %I = $1::%s where id = $2', p_table, c ->> 'col', v_col_type)
      using (c ->> case when p_op = 'suspend' then 'off' else 'on' end), p_id;
    return case when p_op = 'suspend' then 'suspendido' else 'activado' end;
  end if;
  raise exception 'Operación inválida' using errcode = '22023';
end $$;
revoke all on function public.owner_manage(text, uuid, text) from public, anon;
grant execute on function public.owner_manage(text, uuid, text) to authenticated;

-- Al crear una institución nueva, sus oficinas se crean al entrar a «Oficinas» (ensure_offices)

-- ---------------------------------------------------------------------
-- 7. Pago en línea de cuotas (tarjeta de crédito/débito o banco) por el
--    estudiante o su apoderado. La confirmación la hace el backend.
-- ---------------------------------------------------------------------
alter table public.checkout_orders
  alter column offering_id drop not null,
  add column if not exists kind text not null default 'offering' check (kind in ('offering','installments')),
  add column if not exists installment_ids uuid[];
alter table public.checkout_orders add constraint checkout_orders_kind_chk
  check ((kind = 'offering') = (offering_id is not null) and (kind = 'installments') = (installment_ids is not null));

create or replace function public.create_installments_order(p_student uuid, p_installments uuid[], p_provider text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.students; v_amount numeric; v_curr text; v_n int; v_num bigint; v_id uuid; v_email text; v_name text; v_code text;
begin
  select * into s from public.students where id = p_student;
  if not found or not (p_student in (select private.my_student_ids()) or private.is_guardian_of(p_student)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_installments is null or cardinality(p_installments) = 0 then raise exception 'Seleccione al menos una cuota' using errcode = '22023'; end if;
  select coalesce(sum(b.outstanding), 0), min(b.currency), count(distinct b.currency), count(*)
    into v_amount, v_curr, v_n, v_num
    from public.installment_balances b
   where b.student_id = p_student and b.installment_id = any(p_installments) and not b.cancelled and b.outstanding > 0;
  if v_num <> cardinality(p_installments) then raise exception 'Alguna cuota ya fue pagada o no corresponde. Actualice la página.' using errcode = '22023'; end if;
  if v_n <> 1 then raise exception 'Pague por separado las cuotas de distinta moneda' using errcode = '22023'; end if;
  if private.rate_limited('inst_order', auth.uid()::text, 15, interval '1 hour') then
    raise exception 'Demasiados intentos de pago. Intente más tarde.' using errcode = '54000';
  end if;
  select email, full_name into v_email, v_name from public.profiles where id = auth.uid();
  v_num := private.next_number(s.organization_id, 'order');
  v_code := private.new_tracking_code();
  insert into public.checkout_orders (organization_id, order_number, kind, installment_ids, buyer_name, buyer_email,
      buyer_doc_country, amount, currency, provider, tracking_code, student_id, user_id)
  values (s.organization_id, v_num, 'installments', p_installments, coalesce(v_name, s.first_names || ' ' || s.last_names),
      coalesce(v_email, s.email), 'CL', v_amount, v_curr, p_provider, v_code, s.id, auth.uid())
  returning id into v_id;
  return jsonb_build_object('order_id', v_id, 'order_number', v_num, 'amount', v_amount, 'currency', v_curr,
                            'title', 'Cuotas ' || s.first_names || ' ' || s.last_names, 'tracking_code', v_code);
end $$;
revoke all on function public.create_installments_order(uuid, uuid[], text) from public, anon;
grant execute on function public.create_installments_order(uuid, uuid[], text) to authenticated;

-- Registra el pago confirmado en la cuenta del estudiante (solo backend)
create or replace function public.fulfill_installments_order(p_order uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.checkout_orders; v_pay uuid;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order for update;
  if o.kind <> 'installments' or o.status <> 'paid' then raise exception 'Pedido no pagado' using errcode = '22023'; end if;
  if o.fulfilled_at is not null then return o.payment_id; end if;
  v_pay := public.register_payment(o.student_id, o.amount, o.currency,
             case when o.provider = 'fintoc' then 'bank_transfer' else 'payment_gateway' end,
             o.provider, o.provider_reference, o.installment_ids, 'Pago en línea · pedido N° ' || o.order_number);
  update public.checkout_orders set payment_id = v_pay, fulfilled_at = now() where id = o.id;
  return v_pay;
end $$;
revoke all on function public.fulfill_installments_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_installments_order(uuid) to service_role;

-- Cuotas pendientes del pupilo (el apoderado no tiene acceso directo a las tablas de finanzas)
create or replace function public.guardian_installments(p_student uuid)
returns table (installment_id uuid, number int, concept text, due_on date, outstanding numeric, currency text, days_overdue int)
language sql stable security definer set search_path = '' as $$
  select b.installment_id, b.number::int, b.concept, b.due_on, b.outstanding, b.currency::text, b.days_overdue::int
  from public.installment_balances b
  where b.student_id = p_student and private.is_guardian_of(p_student) and not b.cancelled and b.outstanding > 0
  order by b.due_on, b.number limit 24
$$;
revoke all on function public.guardian_installments(uuid) from public, anon;
grant execute on function public.guardian_installments(uuid) to authenticated;

-- Oficinas visibles para el usuario, indicando si integra cada una y citas pendientes
create or replace function public.my_offices(p_org uuid)
returns table (id uuid, code text, name text, description text, icon text, accepts_appointments boolean, attention_hours text,
               is_member boolean, pending_appointments bigint, members bigint)
language sql stable security definer set search_path = '' as $$
  select o.id, o.code, o.name, o.description, o.icon, o.accepts_appointments, o.attention_hours,
         private.office_member(o.id),
         case when private.office_member(o.id) then (select count(*) from public.appointments a where a.office_id = o.id and a.status = 'solicitada') else 0 end,
         (select count(distinct m.user_id) from public.memberships m join public.roles r on r.id = m.role_id
           where m.organization_id = o.organization_id and m.status = 'active' and r.code = any(o.role_codes))
  from public.offices o
  where o.organization_id = p_org and private.is_member(p_org)
  order by o.name
$$;

-- Integrantes de una oficina (solo nombre y rol), visible para sus integrantes
create or replace function public.office_people(p_office uuid)
returns table (user_id uuid, full_name text, role_name text)
language sql stable security definer set search_path = '' as $$
  select distinct on (p.id) p.id, p.full_name, r.name
  from public.offices o
  join public.memberships m on m.organization_id = o.organization_id and m.status = 'active'
  join public.roles r on r.id = m.role_id and r.code = any(o.role_codes)
  join public.profiles p on p.id = m.user_id
  where o.id = p_office and private.office_member(p_office)
  order by p.id, r.name
$$;
revoke all on function public.my_offices(uuid), public.office_people(uuid) from public, anon;
grant execute on function public.my_offices(uuid), public.office_people(uuid) to authenticated;
