-- =====================================================================
-- Etapa C: sucursales separadas (un solo dueño), apertura y cierre de caja,
-- clientes, reportes de ventas y traslados de stock entre sucursales.
-- =====================================================================

-- ---------- 🏢 Sucursales ----------
alter table public.campuses add column if not exists phone text check (length(phone) <= 40);
alter table public.campuses add column if not exists email text check (length(email) <= 200);
alter table public.campuses add column if not exists receipt_footer text check (length(receipt_footer) <= 300);
alter table public.campuses add column if not exists store_enabled boolean not null default true;

/** ¿El usuario trabaja en esa sucursal? (rol sin sucursal = todas; propietario y plataforma = todas) */
create or replace function private.campus_allowed(p_org uuid, p_campus uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_campus is null or private.is_service() or private.is_platform_admin() or exists (
    select 1 from public.memberships m
     where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
       and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
       and (m.campus_id is null or m.campus_id = p_campus))
$$;

/** Sucursal fija del usuario: si todos sus roles son de una misma sucursal, esa; si no, ninguna (ve todas). */
create or replace function private.user_campus(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when bool_or(m.campus_id is null) then null when count(distinct m.campus_id) = 1 then min(m.campus_id::text)::uuid end
    from public.memberships m
   where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
     and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
$$;

/** Sucursal activa de la solicitud: la elegida en el sistema (encabezado x-sucursal) si el usuario tiene acceso; si no, la suya. */
create or replace function private.active_campus(p_org uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare h text; v uuid;
begin
  begin
    h := nullif(current_setting('request.headers', true)::json ->> 'x-sucursal', '');
  exception when others then h := null;
  end;
  if h ~* '^[0-9a-f-]{36}$' then
    v := h::uuid;
    if exists (select 1 from public.campuses c where c.id = v and c.organization_id = p_org) and private.campus_allowed(p_org, v) then return v; end if;
  end if;
  return private.user_campus(p_org);
end $$;
grant execute on function private.campus_allowed(uuid, uuid), private.user_campus(uuid), private.active_campus(uuid) to authenticated, anon;

/** Sucursales a las que tiene acceso el usuario (para el selector). */
create or replace function public.my_campuses(p_org uuid)
returns table (id uuid, code text, name text, city text, fixed boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.code, c.name, c.city, private.user_campus(p_org) is not null
    from public.campuses c
   where c.organization_id = p_org and c.status = 'active' and private.is_member(p_org) and private.campus_allowed(p_org, c.id)
   order by c.name
$$;
grant execute on function public.my_campuses(uuid) to authenticated;

-- Tablas que pasan a pertenecer a una sucursal
alter table public.products  add column if not exists campus_id uuid references public.campuses(id) on delete restrict;
alter table public.sales     add column if not exists campus_id uuid references public.campuses(id) on delete restrict;
alter table public.purchases add column if not exists campus_id uuid references public.campuses(id) on delete restrict;
create index if not exists products_campus_idx on public.products (organization_id, campus_id);
create index if not exists sales_campus_idx on public.sales (organization_id, campus_id, created_at desc);
create index if not exists purchases_campus_idx on public.purchases (organization_id, campus_id);

/** Al crear, toma la sucursal activa; nunca permite registrar en una sucursal ajena. */
create or replace function private.set_campus() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.campus_id is null and tg_op = 'INSERT' then new.campus_id := private.active_campus(new.organization_id); end if;
  if new.campus_id is not null then
    if not exists (select 1 from public.campuses c where c.id = new.campus_id and c.organization_id = new.organization_id) then
      raise exception 'La sucursal no pertenece a la institución' using errcode = '42501';
    end if;
    if auth.uid() is not null and not private.campus_allowed(new.organization_id, new.campus_id) then
      raise exception 'No trabaja en esa sucursal' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['products','sales','purchases','expenses'] loop
    execute format('drop trigger if exists trg_%1$s_campus on public.%1$I', t);
    execute format('create trigger trg_%1$s_campus before insert or update of campus_id on public.%1$I for each row execute function private.set_campus()', t);
  end loop;
end $$;

/** Una venta o compra solo lleva productos de su sucursal (la venta web toma la sucursal del primer producto). */
create or replace function private.item_campus_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_pc uuid; v_name text; v_parent uuid;
begin
  select campus_id, name into v_pc, v_name from public.products where id = new.product_id;
  if tg_table_name = 'sale_items' then
    select campus_id into v_parent from public.sales where id = new.sale_id;
    if v_parent is null and v_pc is not null then update public.sales set campus_id = v_pc where id = new.sale_id; v_parent := v_pc; end if;
  else
    select campus_id into v_parent from public.purchases where id = new.purchase_id;
    if v_parent is null and v_pc is not null then update public.purchases set campus_id = v_pc where id = new.purchase_id; v_parent := v_pc; end if;
  end if;
  if v_pc is not null and v_parent is not null and v_pc <> v_parent then
    raise exception 'El producto «%» es de otra sucursal: haga una venta o compra por sucursal', v_name using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_sale_items_campus on public.sale_items;
create trigger trg_sale_items_campus before insert on public.sale_items for each row execute function private.item_campus_check();
drop trigger if exists trg_purchase_items_campus on public.purchase_items;
create trigger trg_purchase_items_campus before insert on public.purchase_items for each row execute function private.item_campus_check();

-- Aislamiento por sucursal en la base de datos (se suma a los permisos que ya existían)
do $$ declare t text; begin
  foreach t in array array['products','sales','purchases','expenses'] loop
    execute format('drop policy if exists %1$s_campus_scope on public.%1$I', t);
    execute format('create policy %1$s_campus_scope on public.%1$I as restrictive for all to authenticated using (campus_id is null or private.campus_allowed(organization_id, campus_id)) with check (campus_id is null or private.campus_allowed(organization_id, campus_id))', t);
  end loop;
end $$;
drop policy if exists sale_items_campus_scope on public.sale_items;
create policy sale_items_campus_scope on public.sale_items as restrictive for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id and (s.campus_id is null or private.campus_allowed(s.organization_id, s.campus_id))));
drop policy if exists stock_mov_campus_scope on public.stock_movements;
create policy stock_mov_campus_scope on public.stock_movements as restrictive for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.campus_id is null or private.campus_allowed(p.organization_id, p.campus_id))));
drop policy if exists product_lots_campus_scope on public.product_lots;
create policy product_lots_campus_scope on public.product_lots as restrictive for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.campus_id is null or private.campus_allowed(p.organization_id, p.campus_id))));

-- El mismo código de barras puede existir en cada sucursal (cada una tiene su stock)
alter table public.products drop constraint if exists products_organization_id_sku_key;
drop index if exists public.products_barcode_uq;
create unique index if not exists products_sku_campus_uq on public.products (organization_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), sku);
create unique index if not exists products_barcode_campus_uq on public.products (organization_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), barcode)
  where barcode is not null and barcode <> '';

-- ---------- 🔁 Traslado de stock entre sucursales ----------
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.stock_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%inicial%';
  if c is not null then execute format('alter table public.stock_movements drop constraint %I', c); end if;
  alter table public.stock_movements add constraint stock_movements_kind_check check (kind in ('inicial','compra','venta','ajuste','merma','devolucion','anulacion','pedido_web','cancelacion','traslado'));
end $$;

create or replace function public.store_transfer(p_product uuid, p_to_campus uuid, p_qty numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.products; v_dest uuid; v_from text; v_to text;
begin
  select * into p from public.products where id = p_product;
  if p.id is null then raise exception 'Producto no encontrado' using errcode = 'P0002'; end if;
  if not private.has_permission(p.organization_id, 'store.edit') then raise exception 'Necesita permiso para editar la tienda' using errcode = '42501'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Indique una cantidad mayor que cero' using errcode = '22023'; end if;
  if p_to_campus is null or not exists (select 1 from public.campuses c where c.id = p_to_campus and c.organization_id = p.organization_id) then
    raise exception 'Sucursal de destino inválida' using errcode = '22023'; end if;
  if p.campus_id is not distinct from p_to_campus then raise exception 'El producto ya está en esa sucursal' using errcode = '22023'; end if;
  if not private.campus_allowed(p.organization_id, p.campus_id) or not private.campus_allowed(p.organization_id, p_to_campus) then
    raise exception 'Solo puede trasladar entre sucursales donde trabaja' using errcode = '42501'; end if;
  -- El mismo producto en la sucursal de destino (por código de barras o nombre); si no existe, se crea
  select id into v_dest from public.products
   where organization_id = p.organization_id and campus_id = p_to_campus
     and ((p.barcode is not null and barcode = p.barcode) or (lower(name) = lower(p.name) and kind = p.kind))
   order by (barcode = p.barcode) desc nulls last limit 1;
  if v_dest is null then
    insert into public.products (organization_id, campus_id, barcode, name, description, kind, category, brand, unit, price, cost, tax_rate, min_stock,
      track_stock, track_expiry, warranty_months, requires_serial, online, active, image_asset_id)
    select organization_id, p_to_campus, barcode, name, description, kind, category, brand, unit, price, cost, tax_rate, min_stock,
      track_stock, track_expiry, warranty_months, requires_serial, online, active, image_asset_id from public.products where id = p.id
    returning id into v_dest;
  end if;
  select coalesce((select name from public.campuses where id = p.campus_id), 'Sin sucursal'), (select name from public.campuses where id = p_to_campus) into v_from, v_to;
  perform private.store_move(p.id, -p_qty, 'traslado', null, null, left(coalesce(nullif(p_note, ''), 'Traslado') || ' → ' || v_to, 300));
  perform private.store_move(v_dest, p_qty, 'traslado', null, null, left(coalesce(nullif(p_note, ''), 'Traslado') || ' ← ' || v_from, 300), p.cost);
  return v_dest;
end $$;
grant execute on function public.store_transfer(uuid, uuid, numeric, text) to authenticated;

-- ---------- 💵 Apertura y cierre de caja (arqueo) ----------
create table if not exists public.cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campus_id       uuid references public.campuses(id) on delete restrict,
  opened_by       uuid not null default auth.uid() references public.profiles(id),
  opened_at       timestamptz not null default now(),
  opening_amount  numeric(14,2) not null check (opening_amount >= 0),
  closed_at       timestamptz,
  closed_by       uuid references public.profiles(id),
  sales_count     int,
  sales_total     numeric(14,2),
  cash_sales      numeric(14,2),
  expected_cash   numeric(14,2),
  counted_cash    numeric(14,2) check (counted_cash >= 0),
  difference      numeric(14,2),
  by_method       jsonb,
  notes           text check (length(notes) <= 500)
);
create unique index if not exists cash_sessions_open_uq on public.cash_sessions (organization_id, opened_by) where closed_at is null;
create index if not exists cash_sessions_org_idx on public.cash_sessions (organization_id, opened_at desc);
alter table public.cash_sessions enable row level security;
revoke all on public.cash_sessions from anon;
grant select on public.cash_sessions to authenticated;
grant all on public.cash_sessions to service_role;
drop policy if exists cash_read on public.cash_sessions;
create policy cash_read on public.cash_sessions for select to authenticated
  using ((opened_by = auth.uid() or private.has_permission(organization_id, 'store.edit') or private.is_owner(organization_id))
         and (campus_id is null or private.campus_allowed(organization_id, campus_id)));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_cash_sessions') then
    create trigger audit_cash_sessions after insert or update or delete on public.cash_sessions for each row execute function private.audit_row();
  end if;
end $$;

/** Ventas de una caja: las de esa persona desde la apertura hasta el cierre (sin anuladas). */
create or replace function private.cash_totals(c public.cash_sessions, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*), 'total', coalesce(sum(s.total), 0),
    'cash', coalesce(sum(s.total) filter (where s.payment_method = 'cash'), 0),
    'by_method', coalesce((select jsonb_object_agg(m, t) from (select s2.payment_method m, sum(s2.total) t from public.sales s2
        where s2.organization_id = c.organization_id and s2.seller_id = c.opened_by and s2.channel = 'caja' and s2.status <> 'anulada'
          and s2.created_at >= c.opened_at and s2.created_at <= p_until group by 1) x), '{}'::jsonb))
    from public.sales s
   where s.organization_id = c.organization_id and s.seller_id = c.opened_by and s.channel = 'caja' and s.status <> 'anulada'
     and s.created_at >= c.opened_at and s.created_at <= p_until
$$;

create or replace function public.cash_open(p_org uuid, p_amount numeric, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not private.has_permission(p_org, 'store.create') then raise exception 'Necesita permiso de caja' using errcode = '42501'; end if;
  perform private.require_identity();
  if p_amount is null or p_amount < 0 then raise exception 'Indique el dinero inicial de la caja (0 o más)' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_sessions where organization_id = p_org and opened_by = auth.uid() and closed_at is null) then
    raise exception 'Usted ya tiene una caja abierta: ciérrela antes de abrir otra' using errcode = '23505'; end if;
  insert into public.cash_sessions (organization_id, campus_id, opening_amount, notes)
  values (p_org, private.active_campus(p_org), round(p_amount, 2), left(nullif(btrim(p_notes), ''), 500)) returning id into v;
  return v;
end $$;

create or replace function public.cash_status(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.cash_sessions; t jsonb;
begin
  select * into c from public.cash_sessions where organization_id = p_org and opened_by = auth.uid() and closed_at is null;
  if c.id is null then return null; end if;
  t := private.cash_totals(c, now());
  return jsonb_build_object('id', c.id, 'opened_at', c.opened_at, 'opening', c.opening_amount, 'count', t -> 'count', 'total', t -> 'total',
    'cash', t -> 'cash', 'expected', c.opening_amount + (t ->> 'cash')::numeric, 'by_method', t -> 'by_method',
    'campus', (select name from public.campuses where id = c.campus_id));
end $$;

create or replace function public.cash_close(p_session uuid, p_counted numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cash_sessions; t jsonb; v_exp numeric;
begin
  select * into c from public.cash_sessions where id = p_session for update;
  if c.id is null or c.closed_at is not null then raise exception 'La caja no está abierta' using errcode = 'P0002'; end if;
  if c.opened_by <> auth.uid() and not private.has_permission(c.organization_id, 'store.edit') then raise exception 'Solo quien abrió la caja (o un encargado) puede cerrarla' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Indique el dinero contado en la caja' using errcode = '22023'; end if;
  t := private.cash_totals(c, now());
  v_exp := c.opening_amount + (t ->> 'cash')::numeric;
  update public.cash_sessions set closed_at = now(), closed_by = auth.uid(), sales_count = (t ->> 'count')::int, sales_total = (t ->> 'total')::numeric,
    cash_sales = (t ->> 'cash')::numeric, expected_cash = v_exp, counted_cash = round(p_counted, 2), difference = round(p_counted - v_exp, 2),
    by_method = t -> 'by_method', notes = coalesce(left(nullif(btrim(p_notes), ''), 500), notes)
   where id = c.id;
  return jsonb_build_object('expected', v_exp, 'counted', round(p_counted, 2), 'difference', round(p_counted - v_exp, 2), 'count', t -> 'count', 'total', t -> 'total');
end $$;
grant execute on function public.cash_open(uuid, numeric, text), public.cash_status(uuid), public.cash_close(uuid, numeric, text) to authenticated;

-- ---------- 👥 Clientes (a partir de las ventas) ----------
create or replace function public.store_customers(p_org uuid, p_q text default null, p_campus uuid default null)
returns table (key text, name text, doc text, email text, phone text, purchases bigint, total numeric, last_purchase timestamptz, channels text)
language sql stable security invoker set search_path = '' as $$
  select coalesce(nullif(s.customer_doc_number, ''), nullif(lower(s.customer_email), ''), lower(s.customer_name)) as key,
         (array_agg(s.customer_name order by s.created_at desc))[1], max(s.customer_doc_number), max(lower(s.customer_email)), max(s.customer_phone),
         count(*), sum(s.total), max(s.created_at), string_agg(distinct s.channel, ', ')
    from public.sales s
   where s.organization_id = p_org and s.status <> 'anulada'
     and coalesce(nullif(s.customer_doc_number, ''), nullif(s.customer_email, ''), nullif(s.customer_name, '')) is not null
     and (p_campus is null or s.campus_id = p_campus)
     and (p_q is null or btrim(p_q) = '' or public.search_norm(concat_ws(' ', s.customer_name, s.customer_doc_number, s.customer_email, s.customer_phone)) like '%' || public.search_norm(btrim(p_q)) || '%')
   group by 1
   order by sum(s.total) desc
   limit 1000
$$;
grant execute on function public.store_customers(uuid, text, uuid) to authenticated;

-- ---------- 📊 Reporte de ventas ----------
create or replace function public.store_sales_report(p_org uuid, p_from date, p_to date, p_campus uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with s as (
    select * from public.sales
     where organization_id = p_org and status <> 'anulada' and created_at >= p_from and created_at < p_to + 1
       and (p_campus is null or campus_id = p_campus)),
  it as (select i.*, s.campus_id from public.sale_items i join s on s.id = i.sale_id)
  select jsonb_build_object(
    'count', (select count(*) from s), 'total', (select coalesce(sum(total), 0) from s), 'cost', (select coalesce(sum(cost_total), 0) from s),
    'avg', (select coalesce(round(avg(total)), 0) from s),
    'by_day', coalesce((select jsonb_agg(x order by x.d) from (select (created_at at time zone 'America/Santiago')::date d, count(*) n, sum(total) t from s group by 1) x), '[]'),
    'by_hour', coalesce((select jsonb_agg(x order by x.h) from (select extract(hour from created_at at time zone 'America/Santiago')::int h, count(*) n, sum(total) t from s group by 1) x), '[]'),
    'by_method', coalesce((select jsonb_agg(x order by x.t desc) from (select payment_method m, count(*) n, sum(total) t from s group by 1) x), '[]'),
    'by_channel', coalesce((select jsonb_agg(x order by x.t desc) from (select channel c, count(*) n, sum(total) t from s group by 1) x), '[]'),
    'by_seller', coalesce((select jsonb_agg(x order by x.t desc) from (select coalesce(p.full_name, 'Tienda web') name, count(*) n, sum(s.total) t
        from s left join public.profiles p on p.id = s.seller_id group by 1) x), '[]'),
    'by_campus', coalesce((select jsonb_agg(x order by x.t desc) from (select coalesce(c.name, 'Sin sucursal') name, count(*) n, sum(s.total) t
        from s left join public.campuses c on c.id = s.campus_id group by 1) x), '[]'),
    'top', coalesce((select jsonb_agg(x order by x.t desc) from (select it.name name, sum(it.qty) q, sum(it.total) t from it group by 1 order by 3 desc limit 15) x), '[]'))
$$;
grant execute on function public.store_sales_report(uuid, date, date, uuid) to authenticated;

-- ---------- 🏢 Resumen por sucursal ----------
create or replace function public.campus_dashboard(p_org uuid)
returns table (campus_id uuid, name text, city text, sales_today numeric, sales_month numeric, sales_count_month bigint,
               tuition_month numeric, expenses_month numeric, students bigint, low_stock bigint, open_cash bigint)
language sql stable security invoker set search_path = '' as $$
  with cs as (
    select c.id, c.name, c.city from public.campuses c where c.organization_id = p_org and c.status = 'active' and private.campus_allowed(p_org, c.id)
    union all select null, 'Sin sucursal (general)', null where private.user_campus(p_org) is null),
  m as (select date_trunc('month', now() at time zone 'America/Santiago') at time zone 'America/Santiago' as start,
               date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago' as today)
  select cs.id, cs.name, cs.city,
    (select coalesce(sum(s.total), 0) from public.sales s, m where s.organization_id = p_org and s.campus_id is not distinct from cs.id and s.status <> 'anulada' and s.created_at >= m.today),
    (select coalesce(sum(s.total), 0) from public.sales s, m where s.organization_id = p_org and s.campus_id is not distinct from cs.id and s.status <> 'anulada' and s.created_at >= m.start),
    (select count(*) from public.sales s, m where s.organization_id = p_org and s.campus_id is not distinct from cs.id and s.status <> 'anulada' and s.created_at >= m.start),
    (select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) from public.payments p join public.students st on st.id = p.student_id, m
      where p.organization_id = p_org and st.campus_id is not distinct from cs.id and p.status = 'confirmed' and p.paid_at >= m.start),
    (select coalesce(sum(e.amount), 0) from public.expenses e, m where e.organization_id = p_org and e.campus_id is not distinct from cs.id and e.spent_on >= m.start::date),
    (select count(*) from public.students st where st.organization_id = p_org and st.campus_id is not distinct from cs.id and st.status = 'active'),
    (select count(*) from public.products pr where pr.organization_id = p_org and pr.campus_id is not distinct from cs.id and pr.active and pr.track_stock and pr.stock <= pr.min_stock),
    (select count(*) from public.cash_sessions k where k.organization_id = p_org and k.campus_id is not distinct from cs.id and k.closed_at is null)
  from cs
$$;
grant execute on function public.campus_dashboard(uuid) to authenticated;
