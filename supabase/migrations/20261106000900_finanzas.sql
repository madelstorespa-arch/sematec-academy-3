-- =====================================================================
-- Migración 009 · Aranceles, cuotas, pagos, reembolsos y cobranza
-- Sistemas 16, 17, 20 · RF-033 a RF-040
-- Regla: los movimientos financieros NUNCA se borran; se reversan.
-- Toda escritura pasa por funciones transaccionales con permisos.
-- =====================================================================

-- Numeración correlativa sin huecos por institución (recibos, certificados)
create table public.document_sequences (
  organization_id uuid not null references public.organizations(id),
  kind            text not null,
  last_value      bigint not null default 0,
  primary key (organization_id, kind)
);
create or replace function private.next_number(p_org uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.document_sequences (organization_id, kind, last_value) values (p_org, p_kind, 1)
  on conflict (organization_id, kind) do update set last_value = public.document_sequences.last_value + 1
  returning last_value into v;
  return v;
end $$;

-- Aranceles por programa y periodo (RF-033)
create table public.fee_schedules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  program_id      uuid not null,
  period_id       uuid not null,
  concept         text not null check (concept in ('enrollment_fee','tuition','exam_fee','certificate_fee','other')),
  amount          public.money_amount not null check (amount > 0),
  currency        public.currency_code not null references public.currencies(code),
  default_installments smallint not null default 1 check (default_installments between 1 and 36),
  created_at      timestamptz not null default now(),
  unique (program_id, period_id, concept),
  foreign key (organization_id, program_id) references public.programs(organization_id, id),
  foreign key (organization_id, period_id)  references public.academic_periods(organization_id, id)
);

-- Beneficios y descuentos (RF-036)
create table public.benefits (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code            text not null,
  name            text not null,
  percent_off     numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  amount_off      public.money_amount check (amount_off > 0),
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  check (num_nonnulls(percent_off, amount_off) = 1)
);

create table public.student_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  student_id      uuid not null,
  currency        public.currency_code not null references public.currencies(code),
  created_at      timestamptz not null default now(),
  unique (student_id, currency),
  unique (organization_id, id),
  foreign key (organization_id, student_id) references public.students(organization_id, id)
);

create table public.charges (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  account_id      uuid not null,
  student_id      uuid not null,
  enrollment_id   uuid,
  concept         text not null,
  description     text,
  gross_amount    public.money_amount not null check (gross_amount > 0),
  discount_amount public.money_amount not null default 0 check (discount_amount >= 0),
  net_amount      public.money_amount generated always as (gross_amount - discount_amount) stored,
  benefit_id      uuid,
  currency        public.currency_code not null,
  status          public.charge_status not null default 'pending',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.profiles(id),
  cancel_reason   text,
  unique (organization_id, id),
  check (discount_amount < gross_amount),
  check (status <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null)),
  foreign key (organization_id, account_id)    references public.student_accounts(organization_id, id),
  foreign key (organization_id, student_id)    references public.students(organization_id, id),
  foreign key (organization_id, enrollment_id) references public.enrollments(organization_id, id),
  foreign key (organization_id, benefit_id)    references public.benefits(organization_id, id)
);

create table public.installments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  charge_id       uuid not null,
  number          smallint not null check (number >= 1),
  amount          public.money_amount not null check (amount > 0),
  due_on          date not null,
  created_at      timestamptz not null default now(),
  unique (charge_id, number),
  unique (organization_id, id),
  foreign key (organization_id, charge_id) references public.charges(organization_id, id)
);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  account_id      uuid not null,
  student_id      uuid not null,
  kind            text not null default 'payment' check (kind in ('payment','refund')),
  refund_of       uuid references public.payments(id),
  receipt_number  bigint not null,
  amount          public.money_amount not null check (amount > 0),
  currency        public.currency_code not null,
  method          text not null check (method in ('cash','bank_transfer','card','payment_gateway','check','other')),
  provider        text,
  external_reference text,                 -- id del proveedor: conciliación (RF-039)
  paid_at         timestamptz not null default now(),
  status          public.payment_status not null default 'confirmed',
  received_by     uuid references public.profiles(id),
  notes           text,
  voided_at       timestamptz,
  voided_by       uuid references public.profiles(id),
  void_reason     text,
  created_at      timestamptz not null default now(),
  unique (organization_id, kind, receipt_number),
  unique (organization_id, id),
  check ((kind = 'refund') = (refund_of is not null)),
  check (status <> 'voided' or (voided_at is not null and void_reason is not null)),
  foreign key (organization_id, account_id) references public.student_accounts(organization_id, id),
  foreign key (organization_id, student_id) references public.students(organization_id, id)
);

-- Imputación de pagos a cuotas. Montos negativos = reverso o reembolso.
create table public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payment_id      uuid not null,
  installment_id  uuid not null,
  amount          public.money_amount not null check (amount <> 0),
  reversal_of     uuid references public.payment_allocations(id),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, payment_id)     references public.payments(organization_id, id),
  foreign key (organization_id, installment_id) references public.installments(organization_id, id)
);
-- Una misma operación del banco/pasarela no puede registrarse dos veces (con o sin proveedor indicado)
create unique index payments_external_reference_uq on public.payments (organization_id, coalesce(provider, ''), external_reference)
  where external_reference is not null and kind = 'payment';

create index on public.payment_allocations (installment_id);
create index on public.payment_allocations (payment_id);

-- Inmutabilidad: nada se borra; asignaciones y cuotas no se editan
create or replace function private.block_finance_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Los registros financieros no se eliminan; use la anulación o el reverso' using errcode = '42501';
end $$;
create trigger trg_no_delete_charges      before delete on public.charges             for each row execute function private.block_finance_delete();
create trigger trg_no_delete_installments before delete on public.installments        for each row execute function private.block_finance_delete();
create trigger trg_no_delete_payments     before delete on public.payments            for each row execute function private.block_finance_delete();
create trigger trg_no_change_allocations  before update or delete on public.payment_allocations for each row execute function private.block_finance_delete();
create trigger trg_no_trunc_payments      before truncate on public.payments            for each statement execute function private.block_finance_delete();
create trigger trg_no_trunc_allocations   before truncate on public.payment_allocations for each statement execute function private.block_finance_delete();

-- Un pago confirmado solo puede pasar a anulado; sus montos no cambian
create or replace function private.guard_payment_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'voided' then raise exception 'Pago anulado: inmutable' using errcode = '42501'; end if;
  if (new.amount, new.currency, new.account_id, new.student_id, new.receipt_number, new.kind, new.paid_at)
     is distinct from (old.amount, old.currency, old.account_id, old.student_id, old.receipt_number, old.kind, old.paid_at) then
    raise exception 'Los datos económicos de un pago no se modifican; anule y registre nuevamente' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard_payment before update on public.payments for each row execute function private.guard_payment_update();

create trigger audit_fee_schedules after insert or update or delete on public.fee_schedules for each row execute function private.audit_row();
create trigger audit_benefits      after insert or update or delete on public.benefits      for each row execute function private.audit_row();
create trigger audit_accounts      after insert or update or delete on public.student_accounts for each row execute function private.audit_row();
create trigger audit_charges       after insert or update or delete on public.charges       for each row execute function private.audit_row();
create trigger audit_installments  after insert or update or delete on public.installments  for each row execute function private.audit_row();
create trigger audit_payments      after insert or update or delete on public.payments      for each row execute function private.audit_row();
create trigger audit_allocations   after insert on public.payment_allocations for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Vistas de saldos y morosidad (respetan RLS del usuario que consulta)
-- ---------------------------------------------------------------------
create view public.installment_balances with (security_invoker = true) as
select i.id as installment_id, i.organization_id, c.student_id, c.account_id, i.charge_id, c.concept,
       i.number, i.due_on, i.amount, c.currency,
       coalesce(sum(pa.amount), 0)::numeric(18,4) as paid,
       (i.amount - coalesce(sum(pa.amount), 0))::numeric(18,4) as outstanding,
       c.status = 'cancelled' as cancelled,
       case when c.status <> 'cancelled' and i.amount > coalesce(sum(pa.amount), 0) and i.due_on < current_date
            then current_date - i.due_on else 0 end as days_overdue
from public.installments i
join public.charges c on c.id = i.charge_id
left join public.payment_allocations pa on pa.installment_id = i.id
group by i.id, c.id;

create view public.account_balances with (security_invoker = true) as
select account_id, organization_id, student_id, currency,
       sum(amount) filter (where not cancelled)       as total_billed,
       sum(paid)                                       as total_paid,
       sum(outstanding) filter (where not cancelled)   as outstanding,
       sum(outstanding) filter (where not cancelled and days_overdue > 0) as overdue,
       max(days_overdue)                               as max_days_overdue
from public.installment_balances
group by account_id, organization_id, student_id, currency;

-- ---------------------------------------------------------------------
-- Operaciones
-- ---------------------------------------------------------------------
create or replace function private.require_finance(p_org uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission(p_org, p_perm) then
    raise exception 'No autorizado (%).', p_perm using errcode = '42501';
  end if;
end $$;

-- RF-034/RF-036: cargo con cuotas mensuales; la última cuota absorbe el redondeo
create or replace function public.create_charge(
  p_student uuid, p_concept text, p_gross numeric, p_currency text, p_installments int,
  p_first_due date, p_enrollment uuid default null, p_benefit uuid default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.students; v_acc uuid; v_charge uuid; v_disc numeric := 0; v_net numeric; v_each numeric;
  v_minor smallint; b public.benefits; i int;
begin
  select * into s from public.students where id = p_student;
  if not found then raise exception 'Estudiante inexistente' using errcode = 'P0002'; end if;
  perform private.require_finance(s.organization_id, 'finance.create');
  if p_installments not between 1 and 36 then raise exception 'Número de cuotas inválido' using errcode = '22023'; end if;
  select minor_units into v_minor from public.currencies where code = p_currency;
  if v_minor is null then raise exception 'Moneda % no configurada', p_currency using errcode = '22023'; end if;
  if p_benefit is not null then
    select * into b from public.benefits where id = p_benefit and organization_id = s.organization_id and status = 'active';
    if not found then raise exception 'Beneficio inválido' using errcode = '22023'; end if;
    v_disc := round(coalesce(p_gross * b.percent_off / 100, least(b.amount_off, p_gross - power(10::numeric, -v_minor))), v_minor::int);
  end if;
  insert into public.student_accounts (organization_id, student_id, currency)
  values (s.organization_id, s.id, p_currency)
  on conflict (student_id, currency) do update set currency = excluded.currency
  returning id into v_acc;
  insert into public.charges (organization_id, account_id, student_id, enrollment_id, concept, description,
                              gross_amount, discount_amount, benefit_id, currency, created_by)
  values (s.organization_id, v_acc, s.id, p_enrollment, p_concept, p_description, p_gross, v_disc, p_benefit, p_currency, auth.uid())
  returning id, net_amount into v_charge, v_net;
  v_each := trunc(v_net / p_installments, v_minor::int);
  for i in 1..p_installments loop
    insert into public.installments (organization_id, charge_id, number, amount, due_on)
    values (s.organization_id, v_charge, i,
            case when i = p_installments then v_net - v_each * (p_installments - 1) else v_each end,
            (p_first_due + make_interval(months => i - 1))::date);
  end loop;
  return v_charge;
end $$;

create or replace function private.refresh_charge_status(p_charge uuid)
returns void language sql security definer set search_path = '' as $$
  update public.charges c set status = case
      when x.paid <= 0 then 'pending'
      when x.paid >= c.net_amount then 'paid'
      else 'partially_paid' end::public.charge_status
  from (select coalesce(sum(pa.amount), 0) as paid
          from public.installments i left join public.payment_allocations pa on pa.installment_id = i.id
         where i.charge_id = p_charge) x
  where c.id = p_charge and c.status <> 'cancelled'
$$;

-- RF-035: registro de pago con imputación automática a las cuotas más antiguas.
-- p_external_reference evita registrar dos veces la misma transacción del proveedor.
create or replace function public.register_payment(
  p_student uuid, p_amount numeric, p_currency text, p_method text,
  p_provider text default null, p_external_reference text default null,
  p_installment_ids uuid[] default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.students; v_acc uuid; v_pay uuid; v_left numeric := p_amount; r record; v_apply numeric;
  v_charges uuid[] := '{}';
begin
  select * into s from public.students where id = p_student;
  if not found then raise exception 'Estudiante inexistente' using errcode = 'P0002'; end if;
  if not (private.has_permission(s.organization_id, 'finance.create') or private.is_service()) then
    raise exception 'No autorizado (finance.create).' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Monto inválido' using errcode = '22023'; end if;
  select id into v_acc from public.student_accounts where student_id = s.id and currency = p_currency;
  if v_acc is null then raise exception 'El estudiante no tiene cuenta en %', p_currency using errcode = '22023'; end if;

  -- Bloquea las cuotas con saldo para evitar doble imputación concurrente
  perform 1 from public.installments i join public.charges c on c.id = i.charge_id
   where c.account_id = v_acc and c.status <> 'cancelled' for update of i;

  if (select coalesce(sum(outstanding), 0) from public.installment_balances
       where account_id = v_acc and not cancelled
         and (p_installment_ids is null or installment_id = any(p_installment_ids))) < p_amount then
    raise exception 'El monto supera la deuda pendiente seleccionada' using errcode = '23514';
  end if;

  insert into public.payments (organization_id, account_id, student_id, receipt_number, amount, currency, method,
                               provider, external_reference, received_by, notes)
  values (s.organization_id, v_acc, s.id, private.next_number(s.organization_id, 'receipt'), p_amount, p_currency,
          p_method, p_provider, p_external_reference, auth.uid(), p_notes)
  returning id into v_pay;

  for r in select installment_id, charge_id, outstanding from public.installment_balances
            where account_id = v_acc and not cancelled and outstanding > 0
              and (p_installment_ids is null or installment_id = any(p_installment_ids))
            order by due_on, number loop
    exit when v_left <= 0;
    v_apply := least(v_left, r.outstanding);
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount)
    values (s.organization_id, v_pay, r.installment_id, v_apply);
    v_left := v_left - v_apply;
    v_charges := array_append(v_charges, r.charge_id);
  end loop;
  perform private.refresh_charge_status(c) from unnest(v_charges) c;
  return v_pay;
end $$;

-- Anulación (reverso total) de un pago: exige permiso de anulación, MFA y motivo
create or replace function public.void_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.payments; r record;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'Pago inexistente' using errcode = 'P0002'; end if;
  perform private.require_finance(p.organization_id, 'finance.void');
  if private.current_aal() <> 'aal2' then raise exception 'La anulación requiere MFA' using errcode = '42501'; end if;
  if p.status = 'voided' then raise exception 'El pago ya está anulado' using errcode = '22023'; end if;
  if exists (select 1 from public.payments x where x.refund_of = p.id and x.status = 'confirmed') then
    raise exception 'El pago tiene reembolsos vigentes; anúlelos primero' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Debe indicar un motivo' using errcode = '22023'; end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  for r in select pa.id, pa.installment_id, pa.amount from public.payment_allocations pa
            where pa.payment_id = p.id and pa.reversal_of is null loop
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount, reversal_of)
    values (p.organization_id, p.id, r.installment_id, -r.amount, r.id);
  end loop;
  update public.payments set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p.id;
  perform private.refresh_charge_status(i.charge_id)
     from public.installments i where i.id in (select installment_id from public.payment_allocations where payment_id = p.id);
end $$;

-- RF-035: reembolso parcial o total de un pago (libera las cuotas más recientes primero)
create or replace function public.refund_payment(p_payment uuid, p_amount numeric, p_method text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.payments; v_ref uuid; v_left numeric := p_amount; v_avail numeric; r record; v_apply numeric;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or p.kind <> 'payment' then raise exception 'Pago inexistente' using errcode = 'P0002'; end if;
  perform private.require_finance(p.organization_id, 'finance.void');
  if private.current_aal() <> 'aal2' then raise exception 'El reembolso requiere MFA' using errcode = '42501'; end if;
  if p.status = 'voided' then raise exception 'Pago anulado' using errcode = '22023'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Debe indicar un motivo' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_avail from public.payment_allocations pa
   where pa.payment_id = p.id or pa.payment_id in (select id from public.payments where refund_of = p.id and status = 'confirmed');
  if p_amount <= 0 or p_amount > v_avail then
    raise exception 'Monto de reembolso inválido (disponible %)', v_avail using errcode = '23514';
  end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  insert into public.payments (organization_id, account_id, student_id, kind, refund_of, receipt_number, amount,
                               currency, method, received_by, notes)
  values (p.organization_id, p.account_id, p.student_id, 'refund', p.id, private.next_number(p.organization_id, 'refund'),
          p_amount, p.currency, p_method, auth.uid(), p_reason)
  returning id into v_ref;
  for r in select pa.installment_id, sum(pa.amount) as net, max(i.due_on) as due_on
             from public.payment_allocations pa join public.installments i on i.id = pa.installment_id
            where pa.payment_id = p.id or pa.payment_id in (select id from public.payments where refund_of = p.id)
            group by pa.installment_id having sum(pa.amount) > 0
            order by max(i.due_on) desc loop
    exit when v_left <= 0;
    v_apply := least(v_left, r.net);
    insert into public.payment_allocations (organization_id, payment_id, installment_id, amount)
    values (p.organization_id, v_ref, r.installment_id, -v_apply);
    v_left := v_left - v_apply;
  end loop;
  perform private.refresh_charge_status(i.charge_id)
     from public.installments i where i.id in (select installment_id from public.payment_allocations where payment_id = v_ref);
  return v_ref;
end $$;

-- Anulación de un cargo sin pagos imputados
create or replace function public.cancel_charge(p_charge uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.charges;
begin
  select * into c from public.charges where id = p_charge for update;
  if not found then raise exception 'Cargo inexistente' using errcode = 'P0002'; end if;
  perform private.require_finance(c.organization_id, 'finance.void');
  if c.status = 'cancelled' then raise exception 'El cargo ya está anulado' using errcode = '22023'; end if;
  if (select coalesce(sum(pa.amount), 0) from public.payment_allocations pa join public.installments i on i.id = pa.installment_id
       where i.charge_id = c.id) <> 0 then
    raise exception 'El cargo tiene pagos imputados; reverse los pagos primero' using errcode = '22023';
  end if;
  perform set_config('sematec.audit_reason', p_reason, true);
  update public.charges set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
   where id = c.id;
end $$;

-- RF-039: conciliación con el proveedor de pagos (marca diferencias)
create or replace function public.reconcile_provider_payments(p_org uuid, p_provider text, p_items jsonb)
returns table (external_reference text, provider_amount numeric, recorded_amount numeric, status text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_finance(p_org, 'finance.approve');
  return query
  with prov as (
    select x ->> 'reference' as ref, (x ->> 'amount')::numeric as amt from jsonb_array_elements(p_items) x
  ), rec as (
    select p.external_reference as ref, p.amount::numeric as amt from public.payments p
     where p.organization_id = p_org and p.provider = p_provider and p.status = 'confirmed' and p.kind = 'payment'
  )
  select coalesce(prov.ref, rec.ref), prov.amt, rec.amt,
         case when rec.ref is null then 'missing_in_sematec'
              when prov.ref is null then 'missing_in_provider'
              when prov.amt <> rec.amt then 'amount_mismatch' else 'ok' end
  from prov full join rec on rec.ref = prov.ref
  order by 1;
end $$;

-- ---------------------------------------------------------------------
-- RLS: solo lectura directa; escrituras por funciones
-- ---------------------------------------------------------------------
alter table public.document_sequences  enable row level security;
alter table public.fee_schedules       enable row level security;
alter table public.benefits            enable row level security;
alter table public.student_accounts    enable row level security;
alter table public.charges             enable row level security;
alter table public.installments        enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;

create policy fee_read on public.fee_schedules for select to authenticated using (private.is_member(organization_id));
create policy fee_ins  on public.fee_schedules for insert to authenticated with check (private.has_permission(organization_id, 'finance.admin'));
create policy fee_upd  on public.fee_schedules for update to authenticated
  using (private.has_permission(organization_id, 'finance.admin')) with check (private.has_permission(organization_id, 'finance.admin'));

create policy ben_read on public.benefits for select to authenticated using (private.has_permission(organization_id, 'finance.view'));
create policy ben_ins  on public.benefits for insert to authenticated with check (private.has_permission(organization_id, 'finance.admin'));
create policy ben_upd  on public.benefits for update to authenticated
  using (private.has_permission(organization_id, 'finance.admin')) with check (private.has_permission(organization_id, 'finance.admin'));

create policy acc_read on public.student_accounts for select to authenticated
  using (private.has_permission(organization_id, 'finance.view') or student_id in (select private.my_student_ids()));
create policy chg_read on public.charges for select to authenticated
  using (private.has_permission(organization_id, 'finance.view') or student_id in (select private.my_student_ids()));
create policy inst_read on public.installments for select to authenticated
  using (private.has_permission(organization_id, 'finance.view')
         or exists (select 1 from public.charges c where c.id = charge_id and c.student_id in (select private.my_student_ids())));
create policy pay_read on public.payments for select to authenticated
  using (private.has_permission(organization_id, 'finance.view') or student_id in (select private.my_student_ids()));
create policy alloc_read on public.payment_allocations for select to authenticated
  using (private.has_permission(organization_id, 'finance.view')
         or exists (select 1 from public.payments p where p.id = payment_id and p.student_id in (select private.my_student_ids())));
