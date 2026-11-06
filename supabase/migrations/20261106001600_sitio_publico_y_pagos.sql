-- =====================================================================
-- Migración 016 · Sitio web público, marca, catálogo con precios,
-- contacto, postulación pública con seguimiento, pagos en línea
-- (Webpay, Mercado Pago, Flow, Stripe) y archivos de imagen.
-- Todo se administra desde el panel, sin editar código.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Imágenes (logo, fotos de perfil, imágenes de cursos) guardadas en la BD
-- ---------------------------------------------------------------------
create table public.media_assets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  kind            text not null check (kind in ('logo','favicon','hero','course','avatar','page')),
  mime_type       text not null check (mime_type in ('image/png','image/jpeg','image/webp','image/svg+xml')),
  size_bytes      integer not null check (size_bytes between 1 and 3145728),       -- máx. 3 MB
  sha256          text not null,
  bytes           bytea not null,
  is_public       boolean not null default true,
  uploaded_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
alter table public.media_assets enable row level security;   -- solo se lee mediante el servidor
alter table public.profiles add column avatar_asset_id uuid references public.media_assets(id);

-- ---------------------------------------------------------------------
-- Sitio web y marca de la institución
-- ---------------------------------------------------------------------
create table public.site_settings (
  organization_id uuid primary key references public.organizations(id),
  site_name       text not null,
  tagline         text not null default '',
  logo_asset_id   uuid references public.media_assets(id),
  hero_asset_id   uuid references public.media_assets(id),
  primary_color   text not null default '#1f45c8' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color    text not null default '#10b5a3' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  hero_title      text not null default '',
  hero_subtitle   text not null default '',
  about_text      text not null default '',
  mission         text not null default '',
  vision          text not null default '',
  highlights      jsonb not null default '[]'::jsonb,     -- [{"title":"…","text":"…"}]
  contact_email   text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone   text,
  whatsapp        text,
  address         text,
  office_hours    text,
  social_links    jsonb not null default '{}'::jsonb,     -- {"facebook":"https://…","instagram":"…"}
  footer_text     text not null default '',
  terms_text      text not null default '',
  privacy_text    text not null default '',
  is_published    boolean not null default false,
  updated_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now()
);
create trigger trg_site_updated before update on public.site_settings for each row execute function private.set_updated_at();
create trigger audit_site_settings after insert or update on public.site_settings for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Catálogo público: cursos y programas a la venta
-- ---------------------------------------------------------------------
create table public.catalog_offerings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  title           text not null,
  summary         text not null default '',
  description     text not null default '',
  category        text not null default 'Curso',
  modality        text not null default 'online' check (modality in ('in_person','online','hybrid')),
  duration_text   text,
  schedule_text   text,
  starts_on       date,
  image_asset_id  uuid references public.media_assets(id),
  price           public.money_amount not null check (price > 0),
  currency        public.currency_code not null references public.currencies(code),
  admission_mode  text not null default 'direct' check (admission_mode in ('direct','application')),
  program_id      uuid not null,
  period_id       uuid not null,
  capacity        integer check (capacity is null or capacity > 0),
  is_published    boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id),
  foreign key (organization_id, program_id) references public.programs(organization_id, id),
  foreign key (organization_id, period_id)  references public.academic_periods(organization_id, id)
);
create trigger trg_offering_updated before update on public.catalog_offerings for each row execute function private.set_updated_at();
create trigger audit_offerings after insert or update or delete on public.catalog_offerings for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Mensajes del formulario de contacto
-- ---------------------------------------------------------------------
create table public.contact_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  full_name       text not null check (length(trim(full_name)) between 2 and 120),
  email           text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone           text,
  subject         text not null check (length(subject) between 2 and 150),
  message         text not null check (length(message) between 5 and 4000),
  offering_id     uuid references public.catalog_offerings(id),
  status          text not null default 'new' check (status in ('new','in_progress','answered','spam')),
  internal_notes  text,
  ip_address      inet,
  created_at      timestamptz not null default now(),
  handled_by      uuid references public.profiles(id),
  handled_at      timestamptz
);
create index on public.contact_messages (organization_id, status, created_at desc);

-- ---------------------------------------------------------------------
-- Postulaciones públicas: código de seguimiento y datos del interesado
-- ---------------------------------------------------------------------
alter table public.applications
  add column tracking_code text unique check (tracking_code ~ '^SA-[A-Z0-9]{8}$'),
  add column offering_id uuid references public.catalog_offerings(id),
  add column applicant_email text,
  add column applicant_name text;

create or replace function private.new_tracking_code()
returns text language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(8); v text := 'SA-'; i int;
begin
  for i in 0..7 loop v := v || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Pedidos de pago en línea
-- ---------------------------------------------------------------------
create table public.checkout_orders (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id),
  order_number       bigint not null,
  offering_id        uuid not null references public.catalog_offerings(id),
  application_id     uuid references public.applications(id),
  buyer_name         text not null,
  buyer_email        text not null check (buyer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  buyer_phone        text,
  buyer_doc_country  char(2) not null references public.countries(code),
  buyer_doc_type     text not null,
  buyer_doc_number   text not null,
  amount             public.money_amount not null check (amount > 0),
  currency           public.currency_code not null,
  provider           text not null check (provider in ('webpay','mercadopago','flow','stripe')),
  status             text not null default 'pending' check (status in ('pending','paid','failed','cancelled','expired')),
  provider_reference text,                       -- token / id de pago del proveedor
  provider_status    text,
  provider_payload   jsonb,
  tracking_code      text not null,
  user_id            uuid references public.profiles(id),
  student_id         uuid references public.students(id),
  enrollment_id      uuid references public.enrollments(id),
  payment_id         uuid references public.payments(id),
  access_link_used   boolean not null default false,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  fulfilled_at       timestamptz,
  expires_at         timestamptz not null default now() + interval '2 hours',
  unique (organization_id, order_number),
  unique (provider, provider_reference)
);
create index on public.checkout_orders (tracking_code);
create index on public.checkout_orders (organization_id, status, created_at desc);
create trigger audit_checkout_orders after insert or update on public.checkout_orders for each row execute function private.audit_row();

-- Monto y estado pagado son inmutables una vez confirmados
create or replace function private.guard_order()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.amount, new.currency, new.offering_id, new.buyer_email) is distinct from (old.amount, old.currency, old.offering_id, old.buyer_email) then
    raise exception 'Los datos del pedido no pueden modificarse' using errcode = '42501';
  end if;
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'Un pedido pagado no cambia de estado (use reembolso en Finanzas)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard_order before update on public.checkout_orders for each row execute function private.guard_order();
create trigger trg_no_delete_orders before delete on public.checkout_orders for each row execute function private.block_finance_delete();

-- ---------------------------------------------------------------------
-- Funciones públicas (rol anon) — validan todo en el servidor
-- ---------------------------------------------------------------------
create or replace function private.site_org(p_slug text)
returns uuid language sql stable security definer set search_path = '' as $$
  select o.id from public.organizations o join public.site_settings s on s.organization_id = o.id
   where (o.slug = p_slug or o.id::text = p_slug) and o.status = 'active' and s.is_published
$$;

-- Límite simple anti-abuso por correo/IP
create or replace function private.rate_limited(p_kind text, p_key text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.system_events
   where event_type = 'rate:' || p_kind and details ->> 'key' = p_key and occurred_at > now() - p_window;
  insert into public.system_events (event_type, severity, details) values ('rate:' || p_kind, 'info', jsonb_build_object('key', p_key));
  return n >= p_max;
end $$;

create or replace function public.submit_contact_message(
  p_site text, p_name text, p_email text, p_phone text, p_subject text, p_message text, p_offering uuid default null, p_ip inet default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null then raise exception 'Sitio no disponible' using errcode = 'P0002'; end if;
  if private.rate_limited('contact', lower(p_email), 5, interval '1 hour')
     or (p_ip is not null and private.rate_limited('contact-ip', host(p_ip), 20, interval '1 hour')) then
    raise exception 'Demasiados mensajes. Intente más tarde.' using errcode = '54000';
  end if;
  insert into public.contact_messages (organization_id, full_name, email, phone, subject, message, offering_id, ip_address)
  values (v_org, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''), trim(p_subject), trim(p_message), p_offering, p_ip);
end $$;

-- Postulación a un curso con admisión previa: devuelve el código de seguimiento
create or replace function public.submit_public_application(
  p_offering uuid, p_name text, p_email text, p_phone text, p_doc_country char(2), p_doc_type text, p_doc_number text,
  p_form jsonb default '{}'::jsonb, p_ip inet default null)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.catalog_offerings; v_code text; v_contact uuid;
begin
  select * into o from public.catalog_offerings where id = p_offering and is_published;
  if not found then raise exception 'Curso no disponible' using errcode = 'P0002'; end if;
  if private.rate_limited('apply', lower(p_email), 5, interval '1 hour') then
    raise exception 'Demasiadas solicitudes. Intente más tarde.' using errcode = '54000';
  end if;
  if length(trim(p_name)) < 3 or length(trim(p_doc_number)) < 3 then raise exception 'Datos incompletos' using errcode = '22023'; end if;
  insert into public.contacts (organization_id, full_name, email, phone, country_code, source, stage, interest_program_id)
  values (o.organization_id, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''), p_doc_country, 'web', 'applied', o.program_id)
  returning id into v_contact;
  v_code := private.new_tracking_code();
  insert into public.applications (organization_id, program_id, period_id, contact_id, form_data, status, submitted_at,
                                   tracking_code, offering_id, applicant_email, applicant_name)
  values (o.organization_id, o.program_id, o.period_id, v_contact,
          coalesce(p_form, '{}'::jsonb) || jsonb_build_object('phone', p_phone, 'doc_country', p_doc_country, 'doc_type', p_doc_type, 'doc_number', upper(trim(p_doc_number))),
          'submitted', now(), v_code, o.id, lower(trim(p_email)), trim(p_name));
  return v_code;
end $$;

-- Estado de una solicitud o compra (exige código + correo)
create or replace function public.request_status(p_code text, p_email text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.applications; o public.checkout_orders; off public.catalog_offerings;
begin
  select * into a from public.applications where tracking_code = upper(trim(p_code)) and applicant_email = lower(trim(p_email));
  select * into o from public.checkout_orders where tracking_code = upper(trim(p_code)) and buyer_email = lower(trim(p_email))
   order by (status = 'paid') desc, created_at desc limit 1;
  if a.id is null and o.id is null then return jsonb_build_object('found', false); end if;
  select * into off from public.catalog_offerings where id = coalesce(a.offering_id, o.offering_id);
  return jsonb_build_object(
    'found', true, 'code', upper(trim(p_code)), 'course', off.title, 'offering_id', off.id, 'slug', off.slug,
    'price', off.price, 'currency', off.currency,
    'application_status', a.status, 'submitted_at', a.submitted_at, 'decided_at', a.decided_at,
    'decision_notes', case when a.status in ('approved','rejected') then a.decision_notes end,
    'order_status', o.status, 'paid_at', o.paid_at, 'enrolled', o.enrollment_id is not null,
    'can_pay', (a.status = 'approved' and coalesce(o.status, '') <> 'paid'));
end $$;

-- Crea el pedido. El MONTO SIEMPRE sale del catálogo, nunca del navegador.
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
      upper(trim(coalesce(a.form_data ->> 'doc_number', p_doc_number))), off.price, off.currency, p_provider, v_code)
  returning id into v_id;
  return jsonb_build_object('order_id', v_id, 'order_number', v_num, 'amount', off.price, 'currency', off.currency,
                            'title', off.title, 'tracking_code', v_code);
end $$;

-- ---------------------------------------------------------------------
-- Confirmación y cumplimiento (SOLO backend con service_role)
-- ---------------------------------------------------------------------
create or replace function public.mark_order_result(
  p_order uuid, p_provider text, p_reference text, p_paid boolean, p_amount numeric, p_currency text, p_status text, p_payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.checkout_orders;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order for update;
  if not found then raise exception 'Pedido inexistente' using errcode = 'P0002'; end if;
  if o.provider <> p_provider then raise exception 'Proveedor no coincide' using errcode = '42501'; end if;
  if o.status = 'paid' then return 'already_paid'; end if;     -- idempotente
  if p_paid then
    if p_amount <> o.amount or upper(p_currency) <> o.currency then
      update public.checkout_orders set status = 'failed', provider_status = 'amount_mismatch', provider_payload = p_payload, provider_reference = coalesce(provider_reference, p_reference)
       where id = o.id;
      insert into public.system_events (organization_id, event_type, severity, details)
      values (o.organization_id, 'payment_amount_mismatch', 'critical',
              jsonb_build_object('order', o.id, 'expected', o.amount, 'received', p_amount, 'currency', p_currency));
      return 'amount_mismatch';
    end if;
    update public.checkout_orders set status = 'paid', paid_at = now(), provider_reference = coalesce(p_reference, provider_reference),
           provider_status = p_status, provider_payload = p_payload where id = o.id;
    return 'paid';
  end if;
  update public.checkout_orders set status = case when p_status in ('cancelled','aborted') then 'cancelled' else 'failed' end,
         provider_status = p_status, provider_payload = p_payload, provider_reference = coalesce(provider_reference, p_reference)
   where id = o.id and status = 'pending';
  return 'not_paid';
end $$;

create or replace function public.set_order_reference(p_order uuid, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  update public.checkout_orders set provider_reference = p_reference where id = p_order and status = 'pending';
end $$;

-- Crea ficha de estudiante, matrícula, cargo y pago a partir de un pedido pagado
create or replace function public.fulfill_checkout_order(p_order uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.checkout_orders; off public.catalog_offerings; v_student uuid; v_campus uuid; v_curr uuid; v_enr uuid;
  v_acc uuid; v_charge uuid; v_inst uuid; v_pay uuid; v_role uuid; v_code text;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order for update;
  if o.status <> 'paid' then raise exception 'El pedido no está pagado' using errcode = '22023'; end if;
  if o.fulfilled_at is not null then
    return jsonb_build_object('student_id', o.student_id, 'enrollment_id', o.enrollment_id, 'already', true);
  end if;
  select * into off from public.catalog_offerings where id = o.offering_id;
  select id into v_campus from public.campuses where organization_id = o.organization_id and status = 'active' order by created_at limit 1;

  -- Ficha: reutiliza si ya existe por documento o por cuenta
  select id into v_student from public.students
   where organization_id = o.organization_id
     and ((id_document_country = o.buyer_doc_country and id_document_type = o.buyer_doc_type and id_document_number = o.buyer_doc_number)
          or user_id = p_user)
   limit 1;
  if v_student is null then
    v_code := 'WEB-' || lpad(private.next_number(o.organization_id, 'student_code')::text, 6, '0');
    insert into public.students (organization_id, campus_id, user_id, student_code, first_names, last_names,
                                 id_document_country, id_document_type, id_document_number, email, phone)
    values (o.organization_id, v_campus, p_user, v_code,
            split_part(o.buyer_name, ' ', 1),
            coalesce(nullif(trim(substr(o.buyer_name, length(split_part(o.buyer_name, ' ', 1)) + 1)), ''), '-'),
            o.buyer_doc_country, o.buyer_doc_type, o.buyer_doc_number, o.buyer_email, o.buyer_phone)
    returning id into v_student;
  else
    update public.students set user_id = coalesce(user_id, p_user) where id = v_student;
  end if;

  select id into v_role from public.roles where organization_id is null and code = 'estudiante';
  insert into public.memberships (user_id, organization_id, role_id)
  values (p_user, o.organization_id, v_role)
  on conflict (user_id, organization_id, role_id, campus_id) do update set status = 'active', revoked_at = null;

  -- Matrícula (si ya existe en el periodo, se reutiliza)
  select id into v_enr from public.enrollments where student_id = v_student and program_id = off.program_id and period_id = off.period_id;
  if v_enr is null then
    select id into v_curr from public.curricula where program_id = off.program_id and status = 'active' order by valid_from desc limit 1;
    insert into public.enrollments (organization_id, campus_id, student_id, program_id, curriculum_id, period_id, application_id, financial_terms)
    values (o.organization_id, coalesce((select campus_id from public.students where id = v_student), v_campus), v_student,
            off.program_id, v_curr, off.period_id, o.application_id,
            jsonb_build_object('source', 'online', 'order', o.order_number, 'provider', o.provider))
    returning id into v_enr;
  end if;
  if o.application_id is not null then
    update public.applications set student_id = v_student where id = o.application_id;
  end if;

  -- Registro contable: cargo pagado en una cuota + pago de la pasarela
  insert into public.student_accounts (organization_id, student_id, currency) values (o.organization_id, v_student, o.currency)
  on conflict (student_id, currency) do update set currency = excluded.currency returning id into v_acc;
  insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
  values (o.organization_id, v_acc, v_student, v_enr, 'tuition', 'Compra en línea: ' || off.title, o.amount, o.currency, 'paid')
  returning id into v_charge;
  insert into public.installments (organization_id, charge_id, number, amount, due_on)
  values (o.organization_id, v_charge, 1, o.amount, current_date) returning id into v_inst;
  insert into public.payments (organization_id, account_id, student_id, receipt_number, amount, currency, method, provider, external_reference, notes)
  values (o.organization_id, v_acc, v_student, private.next_number(o.organization_id, 'receipt'), o.amount, o.currency,
          'payment_gateway', o.provider, o.provider_reference, 'Pedido web N° ' || o.order_number)
  returning id into v_pay;
  insert into public.payment_allocations (organization_id, payment_id, installment_id, amount) values (o.organization_id, v_pay, v_inst, o.amount);

  update public.checkout_orders set user_id = p_user, student_id = v_student, enrollment_id = v_enr, payment_id = v_pay, fulfilled_at = now()
   where id = o.id;
  return jsonb_build_object('student_id', v_student, 'enrollment_id', v_enr, 'payment_id', v_pay, 'already', false);
end $$;

-- ---------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------
alter table public.site_settings     enable row level security;
alter table public.catalog_offerings enable row level security;
alter table public.contact_messages  enable row level security;
alter table public.checkout_orders   enable row level security;

-- Lectura pública (anon) del sitio y catálogo publicados
create policy site_public_read on public.site_settings for select to anon, authenticated
  using (is_published or private.is_member(organization_id));
create policy site_admin_ins on public.site_settings for insert to authenticated with check (private.has_permission(organization_id, 'settings.admin'));
create policy site_admin_upd on public.site_settings for update to authenticated
  using (private.has_permission(organization_id, 'settings.admin')) with check (private.has_permission(organization_id, 'settings.admin'));

create policy offer_public_read on public.catalog_offerings for select to anon, authenticated
  using ((is_published and exists (select 1 from public.site_settings s where s.organization_id = catalog_offerings.organization_id and s.is_published))
         or private.has_permission(organization_id, 'academic.view'));
create policy offer_ins on public.catalog_offerings for insert to authenticated with check (private.has_permission(organization_id, 'settings.admin'));
create policy offer_upd on public.catalog_offerings for update to authenticated
  using (private.has_permission(organization_id, 'settings.admin')) with check (private.has_permission(organization_id, 'settings.admin'));

create policy msg_read on public.contact_messages for select to authenticated using (private.has_permission(organization_id, 'admissions.view'));
create policy msg_upd on public.contact_messages for update to authenticated
  using (private.has_permission(organization_id, 'admissions.edit')) with check (private.has_permission(organization_id, 'admissions.edit'));

create policy order_read on public.checkout_orders for select to authenticated
  using (private.has_permission(organization_id, 'finance.view') or private.has_permission(organization_id, 'admissions.view')
         or user_id = (select auth.uid()));

grant select on public.site_settings, public.catalog_offerings, public.countries, public.currencies to anon;
grant select, insert, update on public.site_settings, public.catalog_offerings to authenticated;
grant select on public.contact_messages, public.checkout_orders to authenticated;
grant update (status, internal_notes, handled_by, handled_at) on public.contact_messages to authenticated;
grant update (avatar_asset_id) on public.profiles to authenticated;
grant all on public.media_assets, public.site_settings, public.catalog_offerings, public.contact_messages, public.checkout_orders to service_role;

-- Países y monedas: lectura pública para los formularios
create policy countries_anon on public.countries for select to anon using (true);
create policy currencies_anon on public.currencies for select to anon using (true);

revoke all on function public.submit_contact_message(text, text, text, text, text, text, uuid, inet), public.submit_public_application(uuid, text, text, text, char, text, text, jsonb, inet),
  public.request_status(text, text), public.create_checkout_order(uuid, text, text, text, text, char, text, text, text),
  public.mark_order_result(uuid, text, text, boolean, numeric, text, text, jsonb), public.set_order_reference(uuid, text),
  public.fulfill_checkout_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text, text, uuid, inet),
  public.submit_public_application(uuid, text, text, text, char, text, text, jsonb, inet),
  public.request_status(text, text),
  public.create_checkout_order(uuid, text, text, text, text, char, text, text, text) to anon, authenticated;
grant execute on function public.mark_order_result(uuid, text, text, boolean, numeric, text, text, jsonb),
  public.set_order_reference(uuid, text), public.fulfill_checkout_order(uuid, uuid) to service_role;
grant usage on schema private to anon;
grant execute on function private.is_member(uuid), private.has_permission(uuid, text, uuid), private.current_user_active(), private.current_aal() to anon;
