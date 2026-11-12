-- =====================================================================
-- Matrícula + arancel en la inscripción desde el sitio web
--  · Cada curso del catálogo puede tener un precio de matrícula y un
--    número de cuotas para el arancel.
--  · Quien se inscribe en el sitio elige: pagar todo ahora, o pagar solo
--    la matrícula y el arancel en cuotas (que luego paga en línea desde
--    «Mis pagos», igual que un alumno matriculado internamente).
-- =====================================================================

alter table public.catalog_offerings
  add column if not exists enrollment_fee numeric(14,2) check (enrollment_fee is null or enrollment_fee >= 0),
  add column if not exists installments_count smallint not null default 1 check (installments_count between 1 and 36);

alter table public.checkout_orders
  add column if not exists plan text not null default 'total' check (plan in ('total','matricula')),
  add column if not exists enrollment_fee_amount numeric(14,2) not null default 0 check (enrollment_fee_amount >= 0),
  add column if not exists course_amount numeric(14,2),
  add column if not exists plan_installments smallint not null default 1 check (plan_installments between 1 and 36);

-- Desglose público del precio (matrícula + arancel) de un curso
create or replace function public.offering_breakdown(p_offering uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enrollment_fee', coalesce(o.enrollment_fee, 0),
    'course_price', private.offering_price(o),
    'total', coalesce(o.enrollment_fee, 0) + private.offering_price(o),
    'installments', o.installments_count,
    'installment_amount', round(private.offering_price(o) / o.installments_count, 0),
    'currency', o.currency)
  from public.catalog_offerings o
  where o.id = p_offering and (o.is_published or private.is_member(o.organization_id))
$$;
grant execute on function public.offering_breakdown(uuid) to anon, authenticated;

drop function if exists public.create_checkout_order(uuid, text, text, text, text, char, text, text, text);

-- El pedido cobra: plan «total» = matrícula + arancel; plan «matricula» = solo la matrícula
create or replace function public.create_checkout_order(
  p_offering uuid, p_provider text, p_name text, p_email text, p_phone text,
  p_doc_country char(2), p_doc_type text, p_doc_number text, p_tracking_code text default null,
  p_plan text default 'total')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  off public.catalog_offerings; a public.applications; v_code text; v_id uuid; v_num bigint; v_taken int;
  v_fee numeric; v_course numeric; v_amount numeric; v_plan text := coalesce(nullif(p_plan, ''), 'total');
begin
  select * into off from public.catalog_offerings where id = p_offering and is_published;
  if not found then raise exception 'Curso no disponible' using errcode = 'P0002'; end if;
  if v_plan not in ('total','matricula') then raise exception 'Forma de pago inválida' using errcode = '22023'; end if;
  v_fee := coalesce(off.enrollment_fee, 0);
  v_course := private.offering_price(off);
  if v_plan = 'matricula' and v_fee <= 0 then v_plan := 'total'; end if;
  v_amount := case when v_plan = 'matricula' then v_fee else v_fee + v_course end;
  if v_amount <= 0 then raise exception 'Este curso no tiene precio configurado' using errcode = '22023'; end if;

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
      buyer_doc_country, buyer_doc_type, buyer_doc_number, amount, currency, provider, tracking_code,
      plan, enrollment_fee_amount, course_amount, plan_installments)
  values (off.organization_id, v_num, off.id, a.id,
      coalesce(a.applicant_name, trim(p_name)), lower(trim(p_email)), nullif(trim(coalesce(p_phone, a.form_data ->> 'phone', '')), ''),
      coalesce(a.form_data ->> 'doc_country', p_doc_country), coalesce(a.form_data ->> 'doc_type', p_doc_type),
      nullif(upper(trim(coalesce(a.form_data ->> 'doc_number', p_doc_number, ''))), ''), v_amount, off.currency, p_provider, v_code,
      v_plan, v_fee, v_course, case when v_plan = 'matricula' then off.installments_count else 1 end)
  returning id into v_id;
  return jsonb_build_object('order_id', v_id, 'order_number', v_num, 'amount', v_amount, 'currency', off.currency,
                            'title', case when v_plan = 'matricula' then 'Matrícula: ' || off.title else off.title end,
                            'tracking_code', v_code, 'plan', v_plan);
end $$;
revoke all on function public.create_checkout_order(uuid, text, text, text, text, char, text, text, text, text) from public;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, char, text, text, text, text) to anon, authenticated;

-- Ficha, matrícula y cuenta del estudiante a partir de un pedido pagado:
--  · matrícula (cargo «enrollment_fee») y arancel (cargo «tuition») por separado
--  · plan «matricula»: el arancel queda en cuotas mensuales pendientes
create or replace function public.fulfill_checkout_order(p_order uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.checkout_orders; off public.catalog_offerings; v_student uuid; v_campus uuid; v_curr uuid; v_enr uuid;
  v_acc uuid; v_charge uuid; v_inst uuid; v_pay uuid; v_role uuid; v_code text;
  v_fee numeric; v_course numeric; v_n int; v_each numeric; i int; v_insts uuid[] := '{}'; v_amts numeric[] := '{}';
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order for update;
  if o.status <> 'paid' then raise exception 'El pedido no está pagado' using errcode = '22023'; end if;
  if o.fulfilled_at is not null then
    return jsonb_build_object('student_id', o.student_id, 'enrollment_id', o.enrollment_id, 'already', true);
  end if;
  select * into off from public.catalog_offerings where id = o.offering_id;
  select id into v_campus from public.campuses where organization_id = o.organization_id and status = 'active' order by created_at limit 1;

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

  select id into v_enr from public.enrollments where student_id = v_student and program_id = off.program_id and period_id = off.period_id;
  if v_enr is null then
    select id into v_curr from public.curricula where program_id = off.program_id and status = 'active' order by valid_from desc limit 1;
    insert into public.enrollments (organization_id, campus_id, student_id, program_id, curriculum_id, period_id, application_id, financial_terms)
    values (o.organization_id, coalesce((select campus_id from public.students where id = v_student), v_campus), v_student,
            off.program_id, v_curr, off.period_id, o.application_id,
            jsonb_build_object('source', 'online', 'order', o.order_number, 'provider', o.provider, 'plan', o.plan,
                               'enrollment_fee', o.enrollment_fee_amount, 'course_amount', o.course_amount,
                               'installments', o.plan_installments))
    returning id into v_enr;
  end if;
  if o.application_id is not null then
    update public.applications set student_id = v_student where id = o.application_id;
  end if;

  insert into public.student_accounts (organization_id, student_id, currency) values (o.organization_id, v_student, o.currency)
  on conflict (student_id, currency) do update set currency = excluded.currency returning id into v_acc;

  -- Pedidos antiguos (sin desglose): todo el monto es arancel
  v_fee := case when o.course_amount is null then 0 else o.enrollment_fee_amount end;
  v_course := coalesce(o.course_amount, o.amount);

  -- Matrícula
  if v_fee > 0 then
    insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
    values (o.organization_id, v_acc, v_student, v_enr, 'enrollment_fee', 'Matrícula: ' || off.title, v_fee, o.currency, 'paid')
    returning id into v_charge;
    insert into public.installments (organization_id, charge_id, number, amount, due_on)
    values (o.organization_id, v_charge, 1, v_fee, current_date) returning id into v_inst;
    v_insts := v_insts || v_inst; v_amts := v_amts || v_fee;
  end if;

  -- Arancel del curso
  if v_course > 0 then
    if o.plan = 'matricula' then
      v_n := greatest(o.plan_installments, 1);
      v_each := trunc(v_course / v_n, 0);
      if v_each <= 0 then v_n := 1; v_each := v_course; end if;
      insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
      values (o.organization_id, v_acc, v_student, v_enr, 'tuition',
              'Arancel: ' || off.title || case when v_n > 1 then ' (' || v_n || ' cuotas)' else '' end, v_course, o.currency, 'pending')
      returning id into v_charge;
      for i in 1..v_n loop
        insert into public.installments (organization_id, charge_id, number, amount, due_on)
        values (o.organization_id, v_charge, i,
                case when i = v_n then v_course - v_each * (v_n - 1) else v_each end,
                (greatest(current_date, coalesce(off.starts_on, current_date)) + make_interval(months => i - 1))::date);
      end loop;
    else
      insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description, gross_amount, currency, status)
      values (o.organization_id, v_acc, v_student, v_enr, 'tuition', 'Compra en línea: ' || off.title, v_course, o.currency, 'paid')
      returning id into v_charge;
      insert into public.installments (organization_id, charge_id, number, amount, due_on)
      values (o.organization_id, v_charge, 1, v_course, current_date) returning id into v_inst;
      v_insts := v_insts || v_inst; v_amts := v_amts || v_course;
    end if;
  end if;

  insert into public.payments (organization_id, account_id, student_id, receipt_number, amount, currency, method, provider, external_reference, notes)
  values (o.organization_id, v_acc, v_student, private.next_number(o.organization_id, 'receipt'), o.amount, o.currency,
          'payment_gateway', o.provider, o.provider_reference,
          'Pedido web N° ' || o.order_number || case when o.plan = 'matricula' then ' (matrícula)' else '' end)
  returning id into v_pay;
  for i in 1..coalesce(array_length(v_insts, 1), 0) loop
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount)
    values (o.organization_id, v_pay, v_insts[i], v_amts[i]);
  end loop;

  update public.checkout_orders set user_id = p_user, student_id = v_student, enrollment_id = v_enr, payment_id = v_pay, fulfilled_at = now()
   where id = o.id;
  return jsonb_build_object('student_id', v_student, 'enrollment_id', v_enr, 'payment_id', v_pay, 'already', false, 'plan', o.plan);
end $$;
revoke all on function public.fulfill_checkout_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fulfill_checkout_order(uuid, uuid) to service_role;

-- Fecha de creación de las instituciones con sitio publicado (el sitio principal es el de la más antigua)
create or replace function public.public_org_created(p_ids uuid[])
returns table (id uuid, created_at timestamptz) language sql stable security definer set search_path = '' as $$
  select o.id, o.created_at from public.organizations o
  join public.site_settings s on s.organization_id = o.id and s.is_published
  where o.id = any(p_ids)
$$;
grant execute on function public.public_org_created(uuid[]) to anon, authenticated;
