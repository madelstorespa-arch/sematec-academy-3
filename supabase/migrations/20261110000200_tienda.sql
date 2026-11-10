-- =====================================================================
-- Tienda: productos de aseo, comestibles, bebestibles, electrónica y otros.
-- Inventario con lotes y vencimientos, caja (punto de venta), tienda web con pedidos,
-- compras a proveedores (gasto de mercadería) e integración con el balance financiero.
-- =====================================================================

-- ---------- Permisos ----------
insert into public.permissions (code, module, action, description)
select 'store.' || a.action, 'store', a.action, 'Tienda · ' || a.label
from (values ('view','Ver'), ('create','Vender'), ('edit','Productos, precios y compras'), ('void','Anular ventas'), ('admin','Administrar')) as a(action, label)
on conflict (code) do nothing;

with grants(role_code, actions) as (values
  ('propietario_institucional', array['view','create','edit','void','admin']),
  ('director_general',          array['view','create','edit','void']),
  ('director_financiero',       array['view','create','edit','void']),
  ('administrador_sede',        array['view','create','edit']),
  ('tesoreria',                 array['view','create','edit','void']),
  ('contabilidad',              array['view']),
  ('secretaria',                array['view','create']),
  ('auditor',                   array['view'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, 'store.' || a from grants g
join public.roles r on r.code = g.role_code and r.organization_id is null
cross join lateral unnest(g.actions) a
on conflict do nothing;

-- Fotos de productos e insumos de mercadería como gasto
alter table public.media_assets drop constraint if exists media_assets_kind_check;
alter table public.media_assets add constraint media_assets_kind_check check (kind in ('logo','favicon','hero','course','avatar','page','product'));
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in
  ('remuneraciones','honorarios','arriendo','servicios_basicos','internet_tecnologia','materiales','marketing','mantencion','impuestos','comisiones','capacitacion','mercaderia','otros'));

-- ---------- Productos ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null check (length(btrim(sku)) between 1 and 40),
  barcode text check (length(barcode) <= 40),
  name text not null check (length(btrim(name)) between 2 and 160),
  description text check (length(description) <= 2000),
  kind text not null default 'otro' check (kind in ('aseo','comestible','bebestible','electronica','otro')),
  category text check (length(category) <= 80),
  brand text check (length(brand) <= 80),
  unit text not null default 'unidad' check (length(unit) <= 20),
  price numeric(14,2) not null check (price >= 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  tax_rate numeric(5,2) not null default 19 check (tax_rate between 0 and 100),
  currency char(3) not null default 'CLP',
  stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  track_stock boolean not null default true,
  track_expiry boolean not null default false,
  warranty_months int check (warranty_months between 0 and 120),
  requires_serial boolean not null default false,
  image_asset_id uuid references public.media_assets(id) on delete set null,
  online boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create unique index if not exists products_barcode_uq on public.products (organization_id, barcode) where barcode is not null and barcode <> '';
create index if not exists products_org_idx on public.products (organization_id, kind, name);

create table if not exists public.product_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  lot_code text check (length(lot_code) <= 40),
  expires_on date,
  qty_remaining numeric(14,3) not null default 0 check (qty_remaining >= 0),
  received_at timestamptz not null default now()
);
create index if not exists product_lots_idx on public.product_lots (product_id, expires_on nulls last);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier text check (length(supplier) <= 200),
  document_number text check (length(document_number) <= 60),
  purchased_on date not null default current_date,
  total numeric(14,2) not null default 0,
  currency char(3) not null default 'CLP',
  expense_id uuid references public.expenses(id) on delete set null,
  notes text check (length(notes) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  lot_code text, expires_on date
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number bigint not null,
  channel text not null default 'caja' check (channel in ('caja','web')),
  status text not null default 'pagada' check (status in ('pendiente_pago','pagada','lista','entregada','anulada')),
  customer_name text check (length(customer_name) <= 160),
  customer_doc_type text check (length(customer_doc_type) <= 20),
  customer_doc_number text check (length(customer_doc_number) <= 30),
  customer_email text check (length(customer_email) <= 200),
  customer_phone text check (length(customer_phone) <= 40),
  delivery text not null default 'retiro' check (delivery in ('retiro','despacho','en_caja')),
  address text check (length(address) <= 300),
  payment_method text check (payment_method in ('cash','card','bank_transfer','payment_gateway','other')),
  currency char(3) not null default 'CLP',
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  tax numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  cash_received numeric(14,2), change_given numeric(14,2),
  tracking_code text unique,
  order_id uuid references public.checkout_orders(id) on delete set null,
  seller_id uuid,
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  paid_at timestamptz, delivered_at timestamptz,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  unique (organization_id, number)
);
create index if not exists sales_org_idx on public.sales (organization_id, created_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  name text not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  tax_rate numeric(5,2) not null default 19,
  unit_cost numeric(14,2) not null default 0,
  serial text check (length(serial) <= 80),
  warranty_until date
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  lot_id uuid references public.product_lots(id) on delete set null,
  kind text not null check (kind in ('inicial','compra','venta','ajuste','merma','devolucion','anulacion','pedido_web','cancelacion')),
  qty numeric(14,3) not null,
  unit_cost numeric(14,2),
  sale_id uuid references public.sales(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete set null,
  note text check (length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stock_mov_idx on public.stock_movements (organization_id, created_at desc);

alter table public.checkout_orders add column if not exists sale_id uuid references public.sales(id) on delete set null;
alter table public.checkout_orders drop constraint if exists checkout_orders_kind_check;
alter table public.checkout_orders add constraint checkout_orders_kind_check check (kind in ('offering','installments','store'));
alter table public.checkout_orders drop constraint if exists checkout_orders_kind_chk;
alter table public.checkout_orders add constraint checkout_orders_kind_chk check (
  ((kind = 'offering') = (offering_id is not null)) and ((kind = 'installments') = (installment_ids is not null)) and ((kind = 'store') = (sale_id is not null)));

-- ---------- Seguridad ----------
alter table public.products enable row level security;
alter table public.product_lots enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
revoke all on public.products, public.product_lots, public.purchases, public.purchase_items, public.sales, public.sale_items, public.stock_movements from anon;
grant select on public.product_lots, public.purchases, public.purchase_items, public.sales, public.sale_items, public.stock_movements to authenticated;
grant select, insert, update, delete on public.products to authenticated;

drop policy if exists prod_read on public.products;
create policy prod_read on public.products for select to authenticated using (private.has_permission(organization_id, 'store.view') or private.has_permission(organization_id, 'store.create'));
drop policy if exists prod_insert on public.products;
create policy prod_insert on public.products for insert to authenticated with check (private.has_permission(organization_id, 'store.edit'));
drop policy if exists prod_update on public.products;
create policy prod_update on public.products for update to authenticated using (private.has_permission(organization_id, 'store.edit')) with check (private.has_permission(organization_id, 'store.edit'));
drop policy if exists prod_delete on public.products;
create policy prod_delete on public.products for delete to authenticated using (private.has_permission(organization_id, 'store.admin') or private.has_permission(organization_id, 'store.edit'));
do $$ declare t text; begin
  foreach t in array array['product_lots','purchases','purchase_items','sales','sale_items','stock_movements'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.has_permission(organization_id, %2$L) or private.has_permission(organization_id, %3$L))', t, 'store.view', 'store.create');
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'audit_products') then
    create trigger audit_products after insert or update or delete on public.products for each row execute function private.audit_row();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_products_updated') then
    create trigger trg_products_updated before update on public.products for each row execute function private.set_updated_at();
  end if;
end $$;

-- El stock solo cambia con movimientos (compras, ventas, ajustes): no se edita a mano en la ficha
create or replace function private.products_guard_stock() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.stock is distinct from old.stock and coalesce(current_setting('sematec.stock_ok', true), '') <> '1' then
    new.stock := old.stock;
  elsif tg_op = 'INSERT' and coalesce(current_setting('sematec.stock_ok', true), '') <> '1' then
    new.stock := 0;
  end if;
  return new;
end $$;
drop trigger if exists trg_products_stock on public.products;
create trigger trg_products_stock before insert or update on public.products for each row execute function private.products_guard_stock();

-- ---------- Movimiento de stock (núcleo) ----------
/** Suma o resta stock; al restar consume primero los lotes que vencen antes (FEFO). */
create or replace function private.store_move(p_product uuid, p_qty numeric, p_kind text, p_sale uuid, p_purchase uuid, p_note text,
  p_unit_cost numeric default null, p_lot_code text default null, p_expires date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.products; l record; left_qty numeric := -p_qty; take numeric; v_lot uuid;
begin
  select * into p from public.products where id = p_product for update;
  perform set_config('sematec.stock_ok', '1', true);
  if p_qty >= 0 then
    if p.track_expiry or p_expires is not null or p_lot_code is not null then
      insert into public.product_lots (organization_id, product_id, lot_code, expires_on, qty_remaining)
      values (p.organization_id, p.id, p_lot_code, p_expires, p_qty) returning id into v_lot;
    end if;
    update public.products set stock = stock + p_qty where id = p.id;
    insert into public.stock_movements (organization_id, product_id, lot_id, kind, qty, unit_cost, sale_id, purchase_id, note)
    values (p.organization_id, p.id, v_lot, p_kind, p_qty, coalesce(p_unit_cost, p.cost), p_sale, p_purchase, p_note);
  else
    if p.track_stock and p.stock + p_qty < 0 then
      raise exception 'Stock insuficiente de «%»: quedan % %', p.name, trim(to_char(p.stock, 'FM999999990.###')), p.unit using errcode = '23514';
    end if;
    for l in select id, qty_remaining from public.product_lots where product_id = p.id and qty_remaining > 0 order by expires_on nulls last, received_at loop
      exit when left_qty <= 0;
      take := least(left_qty, l.qty_remaining);
      update public.product_lots set qty_remaining = qty_remaining - take where id = l.id;
      insert into public.stock_movements (organization_id, product_id, lot_id, kind, qty, unit_cost, sale_id, purchase_id, note)
      values (p.organization_id, p.id, l.id, p_kind, -take, p.cost, p_sale, p_purchase, p_note);
      left_qty := left_qty - take;
    end loop;
    if left_qty > 0 then
      insert into public.stock_movements (organization_id, product_id, kind, qty, unit_cost, sale_id, purchase_id, note)
      values (p.organization_id, p.id, p_kind, -left_qty, p.cost, p_sale, p_purchase, p_note);
    end if;
    update public.products set stock = stock + p_qty where id = p.id;
  end if;
  perform set_config('sematec.stock_ok', '', true);
end $$;

/** Arma el detalle y totales de una venta a partir de [{product, qty, discount?, serial?}]. Precios desde la base de datos. */
create or replace function private.store_fill_sale(p_sale uuid, p_items jsonb, p_kind text, p_online_only boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sales; it jsonb; p public.products; q numeric; d numeric; line numeric; v_sub numeric := 0; v_tax numeric := 0; cst numeric := 0; n int := 0;
begin
  select * into s from public.sales where id = p_sale;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agregue al menos un producto' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Demasiados productos en una venta' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from public.products where id = (it ->> 'product')::uuid and organization_id = s.organization_id;
    if not found or not p.active or (p_online_only and not p.online) then raise exception 'Producto no disponible' using errcode = '22023'; end if;
    if p.currency <> s.currency then raise exception 'El producto «%» está en otra moneda', p.name using errcode = '22023'; end if;
    q := round(coalesce((it ->> 'qty')::numeric, 1), 3);
    if q <= 0 or q > 100000 then raise exception 'Cantidad inválida para «%»', p.name using errcode = '22023'; end if;
    if p.unit = 'unidad' and q <> trunc(q) then raise exception '«%» se vende por unidades enteras', p.name using errcode = '22023'; end if;
    d := least(greatest(coalesce((it ->> 'discount')::numeric, 0), 0), round(p.price * q, 2));
    line := round(p.price * q - d, 2);
    if p.requires_serial and p_kind = 'venta' and coalesce(btrim(it ->> 'serial'), '') = '' then
      raise exception 'Ingrese el N° de serie de «%» (tiene garantía)', p.name using errcode = '22023';
    end if;
    insert into public.sale_items (organization_id, sale_id, product_id, name, qty, unit_price, discount, total, tax_rate, unit_cost, serial, warranty_until)
    values (s.organization_id, s.id, p.id, p.name, q, p.price, d, line, p.tax_rate, p.cost, nullif(btrim(coalesce(it ->> 'serial', '')), ''),
            case when coalesce(p.warranty_months, 0) > 0 then current_date + make_interval(months => p.warranty_months) end);
    perform private.store_move(p.id, -q, p_kind, s.id, null, null);
    v_sub := v_sub + line; cst := cst + round(p.cost * q, 2);
    v_tax := v_tax + round(line - line / (1 + p.tax_rate / 100), 2);
    n := n + 1;
  end loop;
  update public.sales set subtotal = v_sub, total = greatest(v_sub - s.discount, 0), cost_total = cst,
         tax = case when v_sub > 0 then round(v_tax * greatest(v_sub - s.discount, 0) / v_sub, 2) else 0 end
   where id = s.id;
end $$;

-- ---------- Caja: venta presencial ----------
create or replace function public.store_sell(p_org uuid, p_items jsonb, p_payment_method text, p_customer jsonb default '{}',
  p_discount numeric default 0, p_cash numeric default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; s public.sales; cur text;
begin
  if not private.has_permission(p_org, 'store.create') then raise exception 'No autorizado para vender' using errcode = '42501'; end if;
  if p_payment_method not in ('cash','card','bank_transfer','other') then raise exception 'Medio de pago inválido' using errcode = '22023'; end if;
  select base_currency into cur from public.organizations where id = p_org;
  insert into public.sales (organization_id, number, channel, status, customer_name, customer_doc_type, customer_doc_number, customer_email, customer_phone,
                            delivery, payment_method, currency, discount, seller_id, notes, paid_at, delivered_at)
  values (p_org, private.next_number(p_org, 'sale'), 'caja', 'entregada', nullif(btrim(coalesce(p_customer ->> 'name', '')), ''),
          nullif(p_customer ->> 'doc_type', ''), nullif(upper(btrim(coalesce(p_customer ->> 'doc_number', ''))), ''),
          nullif(lower(btrim(coalesce(p_customer ->> 'email', ''))), ''), nullif(btrim(coalesce(p_customer ->> 'phone', '')), ''),
          'en_caja', p_payment_method, cur, round(greatest(coalesce(p_discount, 0), 0), 2), auth.uid(), nullif(btrim(coalesce(p_notes, '')), ''), now(), now())
  returning id into v_id;
  perform private.store_fill_sale(v_id, p_items, 'venta', false);
  select * into s from public.sales where id = v_id;
  if s.discount > s.subtotal then raise exception 'El descuento supera el total' using errcode = '22023'; end if;
  if p_payment_method = 'cash' then
    if p_cash is null or p_cash < s.total then raise exception 'El efectivo recibido (%) no alcanza para el total (%)', coalesce(p_cash, 0), s.total using errcode = '22023'; end if;
    update public.sales set cash_received = p_cash, change_given = p_cash - s.total where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'number', s.number, 'total', s.total, 'change', case when p_payment_method = 'cash' then p_cash - s.total end);
end $$;

-- ---------- Anular venta o pedido (devuelve el stock) ----------
create or replace function public.store_cancel_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sales; m public.stock_movements;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'Venta inexistente' using errcode = 'P0002'; end if;
  if not (private.has_permission(s.organization_id, 'store.void') or (s.status = 'pendiente_pago' and private.has_permission(s.organization_id, 'store.create'))) then
    raise exception 'No autorizado para anular ventas' using errcode = '42501'; end if;
  if s.status = 'anulada' then return; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Indique el motivo' using errcode = '22023'; end if;
  -- Devuelve cada unidad al mismo lote del que salió (conserva el vencimiento)
  perform set_config('sematec.stock_ok', '1', true);
  for m in select * from public.stock_movements where sale_id = s.id and qty < 0 and kind in ('venta','pedido_web') loop
    if m.lot_id is not null then update public.product_lots set qty_remaining = qty_remaining - m.qty where id = m.lot_id; end if;
    update public.products set stock = stock - m.qty where id = m.product_id;
    insert into public.stock_movements (organization_id, product_id, lot_id, kind, qty, unit_cost, sale_id, note)
    values (s.organization_id, m.product_id, m.lot_id, case when s.channel = 'web' and s.paid_at is null then 'cancelacion' else 'anulacion' end, -m.qty, m.unit_cost, s.id, left(btrim(p_reason), 300));
  end loop;
  perform set_config('sematec.stock_ok', '', true);
  update public.sales set status = 'anulada', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason) where id = s.id;
end $$;

-- ---------- Pedidos web ----------
/** Catálogo público (sin costos ni datos internos). */
create or replace function public.store_catalog(p_org uuid)
returns table (id uuid, name text, description text, kind text, category text, brand text, unit text, price numeric, currency char(3),
               available boolean, stock numeric, image_asset_id uuid, warranty_months int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.description, p.kind, p.category, p.brand, p.unit, p.price, p.currency,
         (not p.track_stock or p.stock > 0), case when p.track_stock then greatest(p.stock, 0) end, p.image_asset_id, p.warranty_months
    from public.products p
   where p.organization_id = p_org and p.active and p.online
     and exists (select 1 from public.site_settings ss where ss.organization_id = p_org and ss.is_published)
   order by p.kind, p.category nulls last, p.name
$$;
grant execute on function public.store_catalog(uuid) to anon, authenticated;

create or replace function public.store_web_order(p_org uuid, p_items jsonb, p_customer jsonb, p_delivery text, p_address text, p_payment text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; s public.sales; cur text; v_track text;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  if p_delivery not in ('retiro','despacho') then raise exception 'Forma de entrega inválida' using errcode = '22023'; end if;
  if p_delivery = 'despacho' and length(btrim(coalesce(p_address, ''))) < 5 then raise exception 'Ingrese la dirección de despacho' using errcode = '22023'; end if;
  if p_payment not in ('bank_transfer','cash','payment_gateway') then raise exception 'Medio de pago inválido' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_customer ->> 'name', ''))) < 3 or coalesce(p_customer ->> 'email', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Ingrese su nombre y un correo válido' using errcode = '22023'; end if;
  select base_currency into cur from public.organizations where id = p_org;
  v_track := upper(substr(translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'XYZ'), 1, 10));
  insert into public.sales (organization_id, number, channel, status, customer_name, customer_doc_type, customer_doc_number, customer_email, customer_phone,
                            delivery, address, payment_method, currency, tracking_code, notes)
  values (p_org, private.next_number(p_org, 'sale'), 'web', 'pendiente_pago', left(btrim(p_customer ->> 'name'), 160), nullif(p_customer ->> 'doc_type', ''),
          nullif(upper(btrim(coalesce(p_customer ->> 'doc_number', ''))), ''), lower(btrim(p_customer ->> 'email')), nullif(left(btrim(coalesce(p_customer ->> 'phone', '')), 40), ''),
          p_delivery, nullif(left(btrim(coalesce(p_address, '')), 300), ''), p_payment, cur, v_track, nullif(left(btrim(coalesce(p_notes, '')), 1000), ''))
  returning id into v_id;
  perform private.store_fill_sale(v_id, p_items, 'pedido_web', true);
  select * into s from public.sales where id = v_id;
  return jsonb_build_object('id', v_id, 'number', s.number, 'total', s.total, 'currency', s.currency, 'tracking', v_track);
end $$;

/** Pedido web pagado en línea: queda como pagado. */
create or replace function public.store_create_payment_order(p_sale uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sales; o public.checkout_orders;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into s from public.sales where id = p_sale and channel = 'web' and status = 'pendiente_pago';
  if not found then raise exception 'Pedido no disponible' using errcode = 'P0002'; end if;
  insert into public.checkout_orders (organization_id, order_number, kind, sale_id, buyer_name, buyer_email, buyer_phone, buyer_doc_country, buyer_doc_type, buyer_doc_number,
                                      amount, currency, provider, status, tracking_code)
  values (s.organization_id, private.next_number(s.organization_id, 'order'), 'store', s.id, s.customer_name, s.customer_email, s.customer_phone,
          'CL', s.customer_doc_type, s.customer_doc_number, s.total, s.currency, p_provider, 'pending', private.new_tracking_code())
  returning * into o;
  update public.sales set order_id = o.id where id = s.id;
  return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'amount', o.amount, 'currency', o.currency, 'title', 'Pedido tienda N° ' || s.number);
end $$;

create or replace function public.fulfill_store_order(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.checkout_orders;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into o from public.checkout_orders where id = p_order and kind = 'store' and status = 'paid' for update;
  if not found or o.fulfilled_at is not null then return; end if;
  update public.sales set status = 'pagada', paid_at = coalesce(paid_at, o.paid_at, now()), payment_method = 'payment_gateway'
   where id = o.sale_id and status = 'pendiente_pago';
  update public.checkout_orders set fulfilled_at = now() where id = o.id;
end $$;

/** Seguimiento público de un pedido con su código. */
create or replace function public.store_order_status(p_tracking text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('number', s.number, 'status', s.status, 'total', s.total, 'currency', s.currency, 'delivery', s.delivery,
           'created_at', s.created_at, 'payment_method', s.payment_method, 'name', s.customer_name,
           'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'total', i.total)) from public.sale_items i where i.sale_id = s.id))
    from public.sales s where s.tracking_code = upper(btrim(p_tracking)) and length(btrim(p_tracking)) >= 8
$$;
grant execute on function public.store_order_status(text) to anon, authenticated;

/** El personal avanza el pedido: pagado (indicando el medio), listo para retiro/despacho, entregado. */
create or replace function public.store_set_order_status(p_sale uuid, p_status text, p_payment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'Pedido inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(s.organization_id, 'store.create') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if s.status = 'anulada' then raise exception 'El pedido está anulado' using errcode = '22023'; end if;
  if p_status not in ('pagada','lista','entregada') then raise exception 'Estado inválido' using errcode = '22023'; end if;
  if p_status in ('lista','entregada') and s.paid_at is null then raise exception 'Primero registre el pago del pedido' using errcode = '22023'; end if;
  update public.sales set status = p_status,
         paid_at = case when p_status = 'pagada' then coalesce(paid_at, now()) else paid_at end,
         payment_method = case when p_status = 'pagada' and p_payment in ('cash','card','bank_transfer','other') then p_payment else payment_method end,
         delivered_at = case when p_status = 'entregada' then now() else delivered_at end
   where id = s.id;
end $$;

-- ---------- Compras e inventario ----------
create or replace function public.store_purchase(p_org uuid, p_supplier text, p_document text, p_date date, p_items jsonb, p_expense boolean default true, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; it jsonb; p public.products; q numeric; c numeric; tot numeric := 0; cur text; v_exp uuid;
begin
  if not private.has_permission(p_org, 'store.edit') then raise exception 'No autorizado para registrar compras' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agregue al menos un producto' using errcode = '22023'; end if;
  select base_currency into cur from public.organizations where id = p_org;
  insert into public.purchases (organization_id, supplier, document_number, purchased_on, currency, notes)
  values (p_org, nullif(btrim(coalesce(p_supplier, '')), ''), nullif(btrim(coalesce(p_document, '')), ''), coalesce(p_date, current_date), cur, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from public.products where id = (it ->> 'product')::uuid and organization_id = p_org;
    if not found then raise exception 'Producto inválido' using errcode = '22023'; end if;
    q := round((it ->> 'qty')::numeric, 3); c := round(coalesce((it ->> 'cost')::numeric, p.cost), 2);
    if q is null or q <= 0 then raise exception 'Cantidad inválida para «%»', p.name using errcode = '22023'; end if;
    if c < 0 then raise exception 'Costo inválido' using errcode = '22023'; end if;
    if p.track_expiry and nullif(it ->> 'expires', '') is null then raise exception 'Ingrese la fecha de vencimiento de «%»', p.name using errcode = '22023'; end if;
    insert into public.purchase_items (organization_id, purchase_id, product_id, qty, unit_cost, lot_code, expires_on)
    values (p_org, v_id, p.id, q, c, nullif(it ->> 'lot', ''), nullif(it ->> 'expires', '')::date);
    perform private.store_move(p.id, q, 'compra', null, v_id, null, c, nullif(it ->> 'lot', ''), nullif(it ->> 'expires', '')::date);
    -- costo promedio ponderado
    update public.products set cost = case when stock > 0 then round(((stock - q) * cost + q * c) / stock, 2) else c end where id = p.id;
    tot := tot + round(q * c, 2);
  end loop;
  update public.purchases set total = tot where id = v_id;
  if p_expense and tot > 0 then
    insert into public.expenses (organization_id, spent_on, category, description, supplier, document_number, amount, currency, created_by)
    values (p_org, coalesce(p_date, current_date), 'mercaderia', 'Compra de mercadería' || coalesce(' · ' || nullif(btrim(p_supplier), ''), ''),
            nullif(btrim(coalesce(p_supplier, '')), ''), nullif(btrim(coalesce(p_document, '')), ''), tot, cur, auth.uid())
    returning id into v_exp;
    update public.purchases set expense_id = v_exp where id = v_id;
  end if;
  return v_id;
end $$;

/** Ajuste de inventario (conteo, merma, producto vencido o dañado, stock inicial). */
create or replace function public.store_adjust(p_product uuid, p_qty numeric, p_kind text, p_note text, p_lot text default null, p_expires date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.products;
begin
  select * into p from public.products where id = p_product;
  if not found then raise exception 'Producto inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(p.organization_id, 'store.edit') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_kind not in ('inicial','ajuste','merma','devolucion') then raise exception 'Tipo de ajuste inválido' using errcode = '22023'; end if;
  if p_qty = 0 then raise exception 'La cantidad no puede ser cero' using errcode = '22023'; end if;
  if p_kind = 'merma' and p_qty > 0 then p_qty := -p_qty; end if;
  if p.track_expiry and p_qty > 0 and p_expires is null then raise exception 'Ingrese la fecha de vencimiento' using errcode = '22023'; end if;
  perform private.store_move(p.id, p_qty, p_kind, null, null, nullif(btrim(coalesce(p_note, '')), ''), null, nullif(p_lot, ''), p_expires);
end $$;

-- ---------- Reporte de la tienda ----------
create or replace function public.store_report(p_org uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare tz text; res jsonb;
begin
  if not (private.has_permission(p_org, 'store.view') or private.has_permission(p_org, 'finance.view')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select coalesce(timezone, 'America/Santiago') into tz from public.organizations where id = p_org;
  with s as (
    select * from public.sales where organization_id = p_org and status <> 'anulada' and paid_at is not null
       and (paid_at at time zone tz)::date between p_from and p_to),
  it as (select i.*, p.kind, p.category from public.sale_items i join s on s.id = i.sale_id join public.products p on p.id = i.product_id)
  select jsonb_build_object(
    'sales', (select count(*) from s), 'total', coalesce((select sum(total) from s), 0), 'tax', coalesce((select sum(tax) from s), 0),
    'cost', coalesce((select sum(cost_total) from s), 0), 'profit', coalesce((select sum(total - cost_total) from s), 0),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'total', t, 'n', n) order by d) from
        (select (paid_at at time zone tz)::date d, sum(total) t, count(*) n from s group by 1) z), '[]'),
    'by_kind', coalesce((select jsonb_object_agg(kind, t) from (select kind, sum(total) t from it group by 1) z), '{}'),
    'by_method', coalesce((select jsonb_object_agg(coalesce(payment_method, 'other'), t) from (select payment_method, sum(total) t from s group by 1) z), '{}'),
    'by_channel', coalesce((select jsonb_object_agg(channel, t) from (select channel, sum(total) t from s group by 1) z), '{}'),
    'top', coalesce((select jsonb_agg(z) from (select name, sum(qty) qty, sum(total) total, sum(total - unit_cost * qty) profit from it group by name order by sum(total) desc limit 10) z), '[]'),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock, 'min', min_stock, 'unit', unit) order by stock)
        from public.products where organization_id = p_org and active and track_stock and stock <= min_stock), '[]'),
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('product', p.name, 'id', p.id, 'lot', l.lot_code, 'expires', l.expires_on, 'qty', l.qty_remaining) order by l.expires_on)
        from public.product_lots l join public.products p on p.id = l.product_id
        where l.organization_id = p_org and l.qty_remaining > 0 and l.expires_on is not null and l.expires_on <= current_date + 30), '[]'),
    'pending_orders', (select count(*) from public.sales where organization_id = p_org and channel = 'web' and status in ('pendiente_pago','pagada','lista')),
    'stock_value', coalesce((select sum(greatest(stock, 0) * cost) from public.products where organization_id = p_org and active), 0)
  ) into res;
  return res;
end $$;

grant execute on function public.store_sell(uuid, jsonb, text, jsonb, numeric, numeric, text), public.store_cancel_sale(uuid, text),
  public.store_set_order_status(uuid, text, text), public.store_purchase(uuid, text, text, date, jsonb, boolean, text),
  public.store_adjust(uuid, numeric, text, text, text, date), public.store_report(uuid, date, date) to authenticated;
revoke all on function public.store_web_order(uuid, jsonb, jsonb, text, text, text, text), public.store_create_payment_order(uuid, text),
  public.fulfill_store_order(uuid) from public, anon, authenticated;
grant execute on function public.store_web_order(uuid, jsonb, jsonb, text, text, text, text), public.store_create_payment_order(uuid, text),
  public.fulfill_store_order(uuid) to service_role;
revoke all on function private.store_move(uuid, numeric, text, uuid, uuid, text, numeric, text, date), private.store_fill_sale(uuid, jsonb, text, boolean) from public;

-- ---------- Balance financiero: las ventas de la tienda son ingresos ----------
create or replace function public.finance_report(p_org uuid, p_from date, p_to date, p_currency text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cur text; tz text; res jsonb;
begin
  if not private.has_permission(p_org, 'finance.view') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then raise exception 'Rango de fechas inválido' using errcode = '22023'; end if;
  select coalesce(upper(p_currency), o.base_currency), coalesce(o.timezone, 'America/Santiago') into cur, tz from public.organizations o where o.id = p_org;

  with pay as (
    select p.id, p.kind, p.refund_of, p.amount, date_trunc('month', p.paid_at at time zone tz)::date as m
      from public.payments p
     where p.organization_id = p_org and p.status = 'confirmed' and p.currency = cur
       and (p.paid_at at time zone tz)::date between p_from and p_to),
  base as (select distinct coalesce(refund_of, id) as pid from pay),
  alloc as (
    select a.payment_id, c.enrollment_id, sum(a.amount) as amt
      from public.payment_allocations a
      join public.installments i on i.id = a.installment_id
      join public.charges c on c.id = i.charge_id
     where a.payment_id in (select pid from base)
     group by 1, 2),
  shares as (
    select x.payment_id, x.enrollment_id, x.amt / p.amount as share
      from alloc x join public.payments p on p.id = x.payment_id
    union all
    select p.id, null::uuid, greatest(0, 1 - coalesce((select sum(amt) from alloc where payment_id = p.id), 0) / p.amount)
      from public.payments p where p.id in (select pid from base)),
  lines as (
    select pay.m, s.enrollment_id, case when pay.kind = 'refund' then -1 else 1 end * pay.amount * s.share as amt
      from pay join shares s on s.payment_id = coalesce(pay.refund_of, pay.id)
     where s.share > 0),
  inc as (select l.m, l.enrollment_id, e.program_id, l.amt from lines l left join public.enrollments e on e.id = l.enrollment_id),
  secs as (
    select i.m, se.section_id, i.amt / count(*) over (partition by i.m, i.enrollment_id, i.amt) as amt
      from inc i join public.section_enrollments se on se.enrollment_id = i.enrollment_id and se.status <> 'dropped'),
  shop as (   -- ventas de la tienda (caja y web) ya pagadas
    select date_trunc('month', s.paid_at at time zone tz)::date as m, s.total as amt, s.cost_total
      from public.sales s
     where s.organization_id = p_org and s.status <> 'anulada' and s.paid_at is not null and s.currency = cur
       and (s.paid_at at time zone tz)::date between p_from and p_to),
  exp as (
    select date_trunc('month', x.spent_on)::date as m, x.program_id, x.section_id, x.category, x.amount as amt
      from public.expenses x
     where x.organization_id = p_org and x.currency = cur and x.spent_on between p_from and p_to),
  months as (select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m),
  prog_ids as (select program_id as id from inc where program_id is not null union select program_id from exp where program_id is not null),
  sec_ids as (select section_id as id from secs union select section_id from exp where section_id is not null)
  select jsonb_build_object(
    'currency', cur, 'from', p_from, 'to', p_to,
    'income', coalesce((select sum(amt) from inc), 0) + coalesce((select sum(amt) from shop), 0),
    'tuition_income', coalesce((select sum(amt) from inc), 0),
    'store_income', coalesce((select sum(amt) from shop), 0),
    'store_cost', coalesce((select sum(cost_total) from shop), 0),
    'expenses', coalesce((select sum(amt) from exp), 0),
    'months', coalesce((select jsonb_agg(jsonb_build_object('m', mo.m,
        'income', coalesce((select sum(amt) from inc where inc.m = mo.m), 0) + coalesce((select sum(amt) from shop where shop.m = mo.m), 0),
        'store', coalesce((select sum(amt) from shop where shop.m = mo.m), 0),
        'expenses', coalesce((select sum(amt) from exp where exp.m = mo.m), 0)) order by mo.m) from months mo), '[]'),
    'programs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name,
        'students', (select count(*) from public.enrollments e where e.program_id = p.id and e.status = 'active'),
        'income', coalesce((select sum(amt) from inc where inc.program_id = p.id), 0),
        'expenses', coalesce((select sum(amt) from exp where exp.program_id = p.id), 0),
        'months', (select jsonb_object_agg(mo.m, coalesce((select sum(amt) from inc where inc.program_id = p.id and inc.m = mo.m), 0)) from months mo))
        order by p.name) from public.programs p where p.id in (select id from prog_ids)), '[]'),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', c.name,
        'students', (select count(*) from public.section_enrollments se where se.section_id = s.id and se.status = 'enrolled'),
        'income', coalesce((select sum(amt) from secs where secs.section_id = s.id), 0),
        'expenses', coalesce((select sum(amt) from exp where exp.section_id = s.id), 0),
        'months', (select jsonb_object_agg(mo.m, coalesce((select sum(amt) from secs where secs.section_id = s.id and secs.m = mo.m), 0)) from months mo))
        order by c.name, s.code) from public.sections s join public.courses c on c.id = s.course_id where s.id in (select id from sec_ids)), '[]'),
    'unassigned_income', coalesce((select sum(amt) from inc where program_id is null), 0),
    'general_expenses', coalesce((select sum(amt) from exp where program_id is null and section_id is null), 0),
    'categories', coalesce((select jsonb_object_agg(category, t) from (select category, sum(amt) t from exp group by 1) z), '{}')
  ) into res;
  return res;
end $$;

-- Búsqueda global: también productos y ventas de la tienda
create or replace function public.store_search(p_org uuid, p_q text)
returns table (kind text, id uuid, title text, subtitle text, href text, rank int)
language plpgsql stable security invoker set search_path = '' as $$
declare q text := public.search_norm(btrim(coalesce(p_q, ''))); pat text; n bigint;
begin
  if length(q) < 2 then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  n := case when q ~ '^[0-9]{1,15}$' then q::bigint end;
  return query
    (select 'Producto'::text, p.id, p.name, concat_ws(' · ', p.sku, p.brand, 'stock ' || trim(to_char(p.stock, 'FM999999990.###'))), ('/app/tienda/productos/' || p.id)::text, 2
       from public.products p
      where p.organization_id = p_org and (public.search_norm(p.name) like pat or public.search_norm(p.sku) like pat or p.barcode = btrim(p_q) or public.search_norm(p.brand) like pat)
      order by p.name limit 6)
    union all
    (select 'Venta', s.id, 'Venta N° ' || s.number, concat_ws(' · ', s.customer_name, s.currency || ' ' || s.total::text), '/app/tienda/ventas/' || s.id, 8
       from public.sales s where s.organization_id = p_org and (s.number = n or public.search_norm(s.customer_name) like pat or s.tracking_code = upper(btrim(p_q)))
      order by s.created_at desc limit 5);
end $$;
grant execute on function public.store_search(uuid, text) to authenticated;

-- El servidor de la plataforma (service_role) lee y escribe estas tablas (comprobantes, tienda web)
grant all on public.products, public.product_lots, public.purchases, public.purchase_items, public.sales, public.sale_items, public.stock_movements to service_role;
