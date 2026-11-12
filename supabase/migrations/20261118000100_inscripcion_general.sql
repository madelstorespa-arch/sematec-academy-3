-- =====================================================================
-- Inscripción general (aparte de los cursos)
--  · La persona completa el formulario de inscripción y paga el monto de
--    inscripción (en línea desde el sitio, o en caja desde la plataforma).
--  · Queda registrada como estudiante, con su cuenta y su pago, lista para
--    matricularla después en cualquier curso o carrera.
--  · Configuración: organization_settings «inscripcion.general».
-- =====================================================================

create table if not exists public.registrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  student_id      uuid not null,
  source          text not null check (source in ('web','interna')),
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  currency        char(3) not null,
  method          text,
  payment_id      uuid,
  order_id        uuid references public.checkout_orders(id),
  tracking_code   text,
  form_data       jsonb not null default '{}'::jsonb,
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, student_id) references public.students(organization_id, id)
);
create index if not exists registrations_org_idx on public.registrations (organization_id, created_at desc);
create index if not exists registrations_student_idx on public.registrations (student_id);
alter table public.registrations enable row level security;
drop policy if exists registrations_read on public.registrations;
create policy registrations_read on public.registrations for select to authenticated
  using (private.has_permission(organization_id, 'students.view') or private.has_permission(organization_id, 'finance.view')
         or student_id in (select private.my_student_ids()));
grant select on public.registrations to authenticated;
grant all on public.registrations to service_role;
drop trigger if exists trg_registrations_audit on public.registrations;
create trigger trg_registrations_audit after insert or update or delete on public.registrations
  for each row execute function private.audit_row();

-- Pedidos en línea de tipo «inscripción»
alter table public.checkout_orders drop constraint if exists checkout_orders_kind_check;
alter table public.checkout_orders add constraint checkout_orders_kind_check check (kind in ('offering','installments','store','registration'));
alter table public.checkout_orders drop constraint if exists checkout_orders_kind_chk;
alter table public.checkout_orders add constraint checkout_orders_kind_chk check (
  ((kind = 'offering') = (offering_id is not null)) and ((kind = 'installments') = (installment_ids is not null)) and ((kind = 'store') = (sale_id is not null)));
alter table public.checkout_orders add column if not exists form_data jsonb;

-- Configuración pública del formulario de inscripción
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
      'ask_guardian', coalesce((v ->> 'ask_guardian')::boolean, false))
  from public.organizations o
  left join lateral (select s.value v from public.organization_settings s where s.organization_id = o.id and s.key = 'inscripcion.general') x on true
  where o.id = p_org
$$;

create or replace function public.registration_info(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.registration_config(p_org)
$$;
grant execute on function public.registration_info(uuid) to anon, authenticated;

-- Limpia el formulario: solo campos conocidos y textos cortos
create or replace function private.clean_registration_form(p_form jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, left(trim(p_form ->> k), 500)) filter (where nullif(trim(p_form ->> k), '') is not null), '{}'::jsonb)
  from unnest(array['birth_date','address','city','education','guardian_name','guardian_phone','how_found','notes','nationality']) k
$$;

-- Núcleo: ficha del estudiante + cuenta + cargo y pago de la inscripción + registro
create or replace function private.register_student(
  p_org uuid, p_user uuid, p_name text, p_first text, p_last text, p_email text, p_phone text,
  p_doc_country char(2), p_doc_type text, p_doc_number text, p_form jsonb, p_source text,
  p_amount numeric, p_currency text, p_method text, p_provider text, p_reference text, p_order uuid, p_notes text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid; v_campus uuid; v_code text; v_role uuid; v_acc uuid; v_charge uuid; v_inst uuid; v_pay uuid; v_reg uuid;
  v_first text := nullif(trim(coalesce(p_first, split_part(trim(p_name), ' ', 1))), '');
  v_last text := nullif(trim(coalesce(p_last, substr(trim(p_name), length(split_part(trim(p_name), ' ', 1)) + 1))), '');
  v_form jsonb := private.clean_registration_form(coalesce(p_form, '{}'::jsonb));
  v_birth date;
begin
  if v_first is null then raise exception 'Escriba el nombre' using errcode = '22023'; end if;
  begin v_birth := nullif(v_form ->> 'birth_date', '')::date; exception when others then v_birth := null; end;
  select id into v_campus from public.campuses where organization_id = p_org and status = 'active' order by created_at limit 1;
  select id into v_student from public.students
   where organization_id = p_org
     and ((p_doc_number is not null and id_document_country = p_doc_country and id_document_type = p_doc_type and id_document_number = p_doc_number)
          or (p_user is not null and user_id = p_user))
   limit 1;
  if v_student is null then
    v_code := (case when p_source = 'web' then 'WEB-' else 'INS-' end) || lpad(private.next_number(p_org, 'student_code')::text, 6, '0');
    insert into public.students (organization_id, campus_id, user_id, student_code, first_names, last_names,
                                 id_document_country, id_document_type, id_document_number, email, phone, birth_date)
    values (p_org, v_campus, p_user, v_code, v_first, coalesce(v_last, '-'), p_doc_country, p_doc_type, p_doc_number,
            nullif(lower(trim(p_email)), ''), nullif(trim(coalesce(p_phone, '')), ''), v_birth)
    returning id into v_student;
  else
    update public.students set user_id = coalesce(user_id, p_user), phone = coalesce(phone, nullif(trim(coalesce(p_phone, '')), '')),
           email = coalesce(email, nullif(lower(trim(p_email)), '')), birth_date = coalesce(birth_date, v_birth)
     where id = v_student;
  end if;
  if p_user is not null then
    select id into v_role from public.roles where organization_id is null and code = 'estudiante';
    insert into public.memberships (user_id, organization_id, role_id) values (p_user, p_org, v_role)
    on conflict (user_id, organization_id, role_id, campus_id) do update set status = 'active', revoked_at = null;
  end if;

  if coalesce(p_amount, 0) > 0 then
    insert into public.student_accounts (organization_id, student_id, currency) values (p_org, v_student, p_currency)
    on conflict (student_id, currency) do update set currency = excluded.currency returning id into v_acc;
    insert into public.charges (organization_id, account_id, student_id, concept, description, gross_amount, currency, status)
    values (p_org, v_acc, v_student, 'registration_fee', 'Inscripción', p_amount, p_currency, 'paid') returning id into v_charge;
    insert into public.installments (organization_id, charge_id, number, amount, due_on)
    values (p_org, v_charge, 1, p_amount, current_date) returning id into v_inst;
    insert into public.payments (organization_id, account_id, student_id, receipt_number, amount, currency, method, provider, external_reference, notes, received_by)
    values (p_org, v_acc, v_student, private.next_number(p_org, 'receipt'), p_amount, p_currency, coalesce(p_method, 'other'), p_provider, p_reference,
            coalesce(nullif(p_notes, ''), 'Inscripción'), p_by)
    returning id into v_pay;
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount) values (p_org, v_pay, v_inst, p_amount);
  end if;

  insert into public.registrations (organization_id, student_id, source, amount, currency, method, payment_id, order_id, tracking_code, form_data, notes, created_by)
  values (p_org, v_student, p_source, coalesce(p_amount, 0), p_currency, case when coalesce(p_amount, 0) > 0 then coalesce(p_method, 'other') end, v_pay, p_order,
          (select tracking_code from public.checkout_orders where id = p_order), v_form, nullif(p_notes, ''), p_by)
  returning id into v_reg;
  return jsonb_build_object('student_id', v_student, 'registration_id', v_reg, 'payment_id', v_pay);
end $$;

-- Pedido en línea de inscripción (desde el sitio)
create or replace function public.create_registration_order(
  p_org uuid, p_provider text, p_name text, p_email text, p_phone text,
  p_doc_country char(2), p_doc_type text, p_doc_number text, p_form jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := private.registration_config(p_org); v_id uuid; v_num bigint; v_code text;
begin
  if cfg is null or not (cfg ->> 'enabled')::boolean then raise exception 'La inscripción en línea no está habilitada' using errcode = '42501'; end if;
  if (cfg ->> 'fee')::numeric <= 0 then raise exception 'La inscripción no tiene costo: envíe el formulario sin pago' using errcode = '22023'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Escriba su nombre completo' using errcode = '22023'; end if;
  if private.rate_limited('order', lower(p_email), 10, interval '1 hour') then
    raise exception 'Demasiados intentos. Intente más tarde.' using errcode = '54000';
  end if;
  v_code := private.new_tracking_code();
  v_num := private.next_number(p_org, 'order');
  insert into public.checkout_orders (organization_id, order_number, kind, buyer_name, buyer_email, buyer_phone, buyer_doc_country, buyer_doc_type, buyer_doc_number,
                                      amount, currency, provider, tracking_code, form_data)
  values (p_org, v_num, 'registration', trim(p_name), lower(trim(p_email)), nullif(trim(coalesce(p_phone, '')), ''), p_doc_country, p_doc_type,
          nullif(upper(trim(coalesce(p_doc_number, ''))), ''), (cfg ->> 'fee')::numeric, cfg ->> 'currency', p_provider, v_code, private.clean_registration_form(p_form))
  returning id into v_id;
  return jsonb_build_object('order_id', v_id, 'order_number', v_num, 'amount', (cfg ->> 'fee')::numeric, 'currency', cfg ->> 'currency',
                            'title', cfg ->> 'title', 'tracking_code', v_code);
end $$;
revoke all on function public.create_registration_order(uuid, text, text, text, text, char, text, text, jsonb) from public;
grant execute on function public.create_registration_order(uuid, text, text, text, text, char, text, text, jsonb) to anon, authenticated;

-- Al confirmarse el pago (solo el backend)
create or replace function public.fulfill_registration_order(p_order uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.checkout_orders; r jsonb;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order for update;
  if o.kind <> 'registration' then raise exception 'No es un pedido de inscripción' using errcode = '22023'; end if;
  if o.status <> 'paid' then raise exception 'El pedido no está pagado' using errcode = '22023'; end if;
  if o.fulfilled_at is not null then return jsonb_build_object('student_id', o.student_id, 'already', true); end if;
  r := private.register_student(o.organization_id, p_user, o.buyer_name, null, null, o.buyer_email, o.buyer_phone, o.buyer_doc_country, o.buyer_doc_type,
         o.buyer_doc_number, o.form_data, 'web', o.amount, o.currency, 'payment_gateway', o.provider, o.provider_reference, o.id,
         'Inscripción en línea · pedido N° ' || o.order_number, null);
  update public.checkout_orders set user_id = p_user, student_id = (r ->> 'student_id')::uuid, payment_id = (r ->> 'payment_id')::uuid, fulfilled_at = now() where id = o.id;
  return r || jsonb_build_object('already', false);
end $$;
revoke all on function public.fulfill_registration_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fulfill_registration_order(uuid, uuid) to service_role;

-- Inscripción sin costo desde el sitio (solo el backend, que antes crea la cuenta)
create or replace function public.register_web_free(
  p_org uuid, p_user uuid, p_name text, p_email text, p_phone text, p_doc_country char(2), p_doc_type text, p_doc_number text, p_form jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := private.registration_config(p_org);
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  if not (cfg ->> 'enabled')::boolean then raise exception 'La inscripción en línea no está habilitada' using errcode = '42501'; end if;
  if (cfg ->> 'fee')::numeric > 0 then raise exception 'La inscripción requiere pago' using errcode = '22023'; end if;
  return private.register_student(p_org, p_user, p_name, null, null, p_email, p_phone, p_doc_country, p_doc_type, nullif(upper(trim(coalesce(p_doc_number, ''))), ''),
                                   p_form, 'web', 0, cfg ->> 'currency', null, null, null, null, 'Inscripción en línea sin costo', null);
end $$;
revoke all on function public.register_web_free(uuid, uuid, text, text, text, char, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.register_web_free(uuid, uuid, text, text, text, char, text, text, jsonb) to service_role;

-- Inscripción interna (secretaría / caja): registra al estudiante y el monto pagado
create or replace function public.register_student_internal(
  p_org uuid, p_first text, p_last text, p_email text, p_phone text, p_doc_country char(2), p_doc_type text, p_doc_number text,
  p_form jsonb, p_amount numeric, p_currency text, p_method text, p_reference text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := p_org;
begin
  if v_org is null or not private.has_permission(v_org, 'students.create') then raise exception 'No autorizado (students.create).' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) > 0 and not private.has_permission(v_org, 'finance.create') then
    raise exception 'Para registrar el pago de la inscripción necesita el permiso de finanzas.' using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Monto inválido' using errcode = '22023'; end if;
  if p_method is not null and p_method not in ('cash','bank_transfer','card','payment_gateway','check','other') then
    raise exception 'Medio de pago inválido' using errcode = '22023';
  end if;
  return private.register_student(v_org, null, null, p_first, p_last, p_email, p_phone, p_doc_country, p_doc_type, nullif(upper(trim(coalesce(p_doc_number, ''))), ''),
                                  p_form, 'interna', coalesce(p_amount, 0), coalesce(nullif(p_currency, ''), (select base_currency from public.organizations where id = v_org)),
                                  p_method, null, nullif(trim(coalesce(p_reference, '')), ''), null, p_notes, auth.uid());
end $$;
revoke all on function public.register_student_internal(uuid, text, text, text, text, char, text, text, jsonb, numeric, text, text, text, text) from public, anon;
grant execute on function public.register_student_internal(uuid, text, text, text, text, char, text, text, jsonb, numeric, text, text, text, text) to authenticated;
