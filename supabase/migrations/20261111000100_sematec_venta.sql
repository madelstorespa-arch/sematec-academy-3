-- =====================================================================
-- SEMATEC VENTA: promociones, cupones, códigos automáticos (4 letras + números),
-- identificación con nombre y RUT de quien registra, disponibilidad de productos y cursos,
-- e ingresos/egresos por día, semana, mes, semestre y año.
-- =====================================================================

-- ---------- Nombre de la tienda ----------
alter table public.site_settings add column if not exists store_name text not null default 'SEMATEC VENTA' check (length(store_name) between 2 and 60);

-- ---------- Identificación del personal: nombre + RUT ----------
alter table public.profiles add column if not exists id_document_type text check (length(id_document_type) <= 20);
alter table public.profiles add column if not exists id_document_number text check (length(id_document_number) <= 30);
alter table public.profiles add column if not exists user_code text;
create unique index if not exists profiles_doc_uq on public.profiles (upper(regexp_replace(id_document_number, '[^0-9Kk]', '', 'g')))
  where id_document_number is not null and id_document_type = 'RUN';
create unique index if not exists profiles_user_code_uq on public.profiles (user_code) where user_code is not null;

/** En SEMATEC VENTA nadie registra, edita ni elimina sin nombre y RUT en su cuenta. */
create or replace function private.require_identity() returns void language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then return; end if; -- procesos del servidor (tienda web, pagos)
  select * into p from public.profiles where id = auth.uid();
  if length(btrim(coalesce(p.full_name, ''))) < 3 or length(btrim(coalesce(p.id_document_number, ''))) < 3 then
    raise exception 'Para registrar, editar o eliminar en SEMATEC VENTA complete su nombre y RUT en «Mi cuenta».' using errcode = '42501';
  end if;
end $$;

create or replace function private.products_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  -- los movimientos de stock de una venta ya validaron la identidad
  if coalesce(current_setting('sematec.stock_ok', true), '') <> '1' then perform private.require_identity(); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_products_identity on public.products;
create trigger trg_products_identity before insert or update or delete on public.products for each row execute function private.products_identity();

/** El usuario actual completa su nombre y documento (RUT/pasaporte). */
create or replace function public.update_my_identity(p_full_name text, p_doc_type text, p_doc_number text, p_phone text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Inicie sesión' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_full_name, ''))) < 3 then raise exception 'Escriba su nombre completo' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_doc_number, ''))) < 3 then raise exception 'Ingrese su RUT o pasaporte' using errcode = '22023'; end if;
  begin
    update public.profiles set full_name = left(btrim(p_full_name), 160), id_document_type = left(p_doc_type, 20),
           id_document_number = left(upper(btrim(p_doc_number)), 30), phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone)
     where id = auth.uid();
  exception when unique_violation then
    raise exception 'Ese RUT ya está registrado en otra cuenta' using errcode = '23505';
  end;
end $$;
grant execute on function public.update_my_identity(text, text, text, text) to authenticated;

/** Ingreso con RUT: el servidor obtiene el correo de la cuenta (no se expone al navegador). */
create or replace function public.email_for_document(p_doc text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email from public.profiles p join auth.users u on u.id = p.id
   where upper(regexp_replace(p.id_document_number, '[^0-9Kk]', '', 'g')) = upper(regexp_replace(p_doc, '[^0-9Kk]', '', 'g'))
     and length(regexp_replace(p_doc, '[^0-9Kk]', '', 'g')) >= 7
   limit 1
$$;
revoke all on function public.email_for_document(text) from public, anon, authenticated;
grant execute on function public.email_for_document(text) to service_role;

-- ---------- Códigos automáticos: 4 letras + 6 números ----------
create sequence if not exists private.user_code_seq;
create or replace function private.code_prefix_for_role(p_role text) returns text language sql immutable as $$
  select case
    when p_role in ('estudiante','egresado','postulante') then 'ESTU'
    when p_role in ('profesor','tutor') then 'PROF'
    when p_role = 'apoderado' then 'APOD'
    when p_role = 'propietario_institucional' then 'PROP'
    when p_role is null then 'USUA'
    else 'FUNC' end
$$;
create or replace function private.ensure_user_code(p_user uuid, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select user_code into v from public.profiles where id = p_user;
  if v is null then
    v := private.code_prefix_for_role(p_role) || lpad(nextval('private.user_code_seq')::text, 6, '0');
    update public.profiles set user_code = v where id = p_user and user_code is null;
  end if;
  return v;
end $$;
create or replace function private.memberships_user_code() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_user_code(new.user_id, (select code from public.roles where id = new.role_id));
  return new;
end $$;
drop trigger if exists trg_memberships_user_code on public.memberships;
create trigger trg_memberships_user_code after insert on public.memberships for each row execute function private.memberships_user_code();
-- Códigos para los usuarios que ya existen
do $$ declare r record; begin
  for r in select p.id, (select ro.code from public.memberships m join public.roles ro on ro.id = m.role_id where m.user_id = p.id order by m.created_at limit 1) as role
             from public.profiles p where p.user_code is null order by p.created_at loop
    perform private.ensure_user_code(r.id, r.role);
  end loop;
end $$;

/** Código de producto automático según el tipo: ASEO000001, COME000001, BEBE…, ELEC…, OTRO… */
create or replace function private.products_auto_sku() returns trigger language plpgsql security definer set search_path = '' as $$
declare pre text;
begin
  if new.sku is null or btrim(new.sku) = '' then
    pre := case new.kind when 'aseo' then 'ASEO' when 'comestible' then 'COME' when 'bebestible' then 'BEBE' when 'electronica' then 'ELEC' else 'OTRO' end;
    loop
      new.sku := pre || lpad(private.next_number(new.organization_id, 'sku_' || pre)::text, 6, '0');
      exit when not exists (select 1 from public.products where organization_id = new.organization_id and sku = new.sku);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_products_auto_sku on public.products;
create trigger trg_products_auto_sku before insert on public.products for each row execute function private.products_auto_sku();

-- Código de boleta de venta: VENT000123
alter table public.sales add column if not exists code text generated always as ('VENT' || lpad(number::text, 6, '0')) stored;

-- ---------- Promociones y cupones ----------
create table if not exists public.store_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  kind text not null check (kind in ('percent','amount','price','nxm')),
  value numeric(14,2) not null default 0 check (value >= 0),
  buy_qty int, pay_qty int,
  scope text not null default 'products' check (scope in ('all','kind','category','products')),
  scope_kind text, scope_category text,
  product_ids uuid[] not null default '{}',
  channel text not null default 'ambos' check (channel in ('caja','web','ambos')),
  starts_at timestamptz, ends_at timestamptz,
  active boolean not null default true,
  badge text check (length(badge) <= 30),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'nxm' or (buy_qty >= 2 and pay_qty >= 1 and pay_qty < buy_qty)),
  check (kind <> 'percent' or value between 1 and 100)
);
create table if not exists public.store_coupons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9-]{4,20}$'),
  kind text not null check (kind in ('percent','amount')),
  value numeric(14,2) not null check (value > 0),
  min_total numeric(14,2) not null default 0,
  max_uses int check (max_uses > 0), uses int not null default 0,
  channel text not null default 'ambos' check (channel in ('caja','web','ambos')),
  starts_at timestamptz, ends_at timestamptz,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  check (kind <> 'percent' or value <= 100)
);
alter table public.sale_items add column if not exists promotion_id uuid references public.store_promotions(id) on delete set null;
alter table public.sale_items add column if not exists promo_label text;
alter table public.sale_items add column if not exists promo_discount numeric(14,2) not null default 0;
alter table public.sales add column if not exists coupon_code text;
alter table public.sales add column if not exists coupon_discount numeric(14,2) not null default 0;

alter table public.store_promotions enable row level security;
alter table public.store_coupons enable row level security;
revoke all on public.store_promotions, public.store_coupons from anon;
grant select, insert, update, delete on public.store_promotions, public.store_coupons to authenticated;
grant all on public.store_promotions, public.store_coupons to service_role;
do $$ declare t text; begin
  foreach t in array array['store_promotions','store_coupons'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.has_permission(organization_id, ''store.view'') or private.has_permission(organization_id, ''store.create''))', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (private.has_permission(organization_id, ''store.edit'')) with check (private.has_permission(organization_id, ''store.edit''))', t);
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function private.audit_row()', t);
    end if;
    execute format('drop trigger if exists trg_%1$s_identity on public.%1$s', t);
    execute format('create trigger trg_%1$s_identity before insert or update or delete on public.%1$s for each row execute function private.products_identity()', t);
  end loop;
end $$;

create or replace function private.money_round(x numeric, cur text) returns numeric language sql immutable as $$
  select round(x, case when cur in ('CLP','PYG','JPY','KRW','COP') then 0 else 2 end)
$$;

create or replace function private.promo_label(pr public.store_promotions) returns text language sql immutable as $$
  select coalesce(nullif(btrim(pr.badge), ''), case pr.kind
    when 'percent' then '-' || trim(to_char(pr.value, 'FM990')) || '%'
    when 'amount' then '-$' || replace(trim(to_char(pr.value, 'FM999,999,990')), ',', '.')
    when 'price' then 'Oferta'
    when 'nxm' then 'Lleva ' || pr.buy_qty || ' paga ' || pr.pay_qty end)
$$;

/** Descuento de una promoción para una línea (precio unitario × cantidad). */
create or replace function private.promo_discount(pr public.store_promotions, p_price numeric, p_qty numeric, p_cur text)
returns numeric language sql immutable as $$
  select greatest(0, least(p_price * p_qty, private.money_round(case pr.kind
    when 'percent' then p_price * p_qty * pr.value / 100
    when 'amount' then least(pr.value, p_price) * p_qty
    when 'price' then greatest(p_price - pr.value, 0) * p_qty
    when 'nxm' then floor(p_qty / pr.buy_qty) * (pr.buy_qty - pr.pay_qty) * p_price
    else 0 end, p_cur)))
$$;

/** La mejor promoción vigente para un producto (la que más descuenta). */
create or replace function private.best_promo(p public.products, p_qty numeric, p_channel text)
returns table (promotion_id uuid, discount numeric, label text)
language sql stable security definer set search_path = '' as $$
  select pr.id, private.promo_discount(pr, p.price, p_qty, p.currency), private.promo_label(pr)
    from public.store_promotions pr
   where pr.organization_id = p.organization_id and pr.active
     and (pr.starts_at is null or pr.starts_at <= now()) and (pr.ends_at is null or pr.ends_at > now())
     and pr.channel in ('ambos', p_channel)
     and (pr.scope = 'all' or (pr.scope = 'kind' and pr.scope_kind = p.kind)
          or (pr.scope = 'category' and lower(pr.scope_category) = lower(p.category)) or (pr.scope = 'products' and p.id = any(pr.product_ids)))
   order by 2 desc, pr.created_at desc
   limit 1
$$;

/** Recalcula subtotal, total, IVA incluido y costo de una venta a partir de su detalle y descuentos. */
create or replace function private.sale_totals(p_sale uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_sub numeric; v_tax numeric; v_cost numeric; s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  select coalesce(sum(total), 0), coalesce(sum(total - total / (1 + tax_rate / 100)), 0), coalesce(sum(unit_cost * qty), 0)
    into v_sub, v_tax, v_cost from public.sale_items where sale_id = p_sale;
  update public.sales set subtotal = v_sub, total = greatest(v_sub - discount, 0), cost_total = round(v_cost, 2),
         tax = case when v_sub > 0 then round(v_tax * greatest(v_sub - discount, 0) / v_sub, 2) else 0 end
   where id = p_sale;
end $$;

-- Detalle de la venta con promociones automáticas (reemplaza la versión anterior)
drop function if exists private.store_fill_sale(uuid, jsonb, text, boolean);
create or replace function private.store_fill_sale(p_sale uuid, p_items jsonb, p_kind text, p_online_only boolean, p_channel text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sales; it jsonb; p public.products; q numeric; d numeric; line numeric; bp record;
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
    select * into bp from private.best_promo(p, q, p_channel);
    d := least(greatest(coalesce((it ->> 'discount')::numeric, 0), 0) + coalesce(bp.discount, 0), private.money_round(p.price * q, p.currency));
    line := private.money_round(p.price * q - d, p.currency);
    if p.requires_serial and p_kind = 'venta' and coalesce(btrim(it ->> 'serial'), '') = '' then
      raise exception 'Ingrese el N° de serie de «%» (tiene garantía)', p.name using errcode = '22023';
    end if;
    insert into public.sale_items (organization_id, sale_id, product_id, name, qty, unit_price, discount, total, tax_rate, unit_cost, serial, warranty_until,
                                   promotion_id, promo_label, promo_discount)
    values (s.organization_id, s.id, p.id, p.name, q, p.price, d, line, p.tax_rate, p.cost, nullif(btrim(coalesce(it ->> 'serial', '')), ''),
            case when coalesce(p.warranty_months, 0) > 0 then current_date + make_interval(months => p.warranty_months) end,
            case when coalesce(bp.discount, 0) > 0 then bp.promotion_id end, case when coalesce(bp.discount, 0) > 0 then bp.label end, coalesce(bp.discount, 0));
    perform private.store_move(p.id, -q, p_kind, s.id, null, null);
  end loop;
  perform private.sale_totals(s.id);
end $$;

/** Valida y aplica un cupón a la venta (descuento sobre el total). */
create or replace function private.apply_coupon(p_sale uuid, p_code text, p_channel text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sales; c public.store_coupons; v numeric;
begin
  if coalesce(btrim(p_code), '') = '' then return; end if;
  select * into s from public.sales where id = p_sale;
  select * into c from public.store_coupons where organization_id = s.organization_id and code = upper(btrim(p_code)) for update;
  if not found or not c.active or (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at <= now())
     or c.channel not in ('ambos', p_channel) or (c.max_uses is not null and c.uses >= c.max_uses) then
    raise exception 'El cupón «%» no es válido o ya venció', upper(btrim(p_code)) using errcode = '22023';
  end if;
  if s.subtotal - s.discount < c.min_total then raise exception 'El cupón requiere una compra mínima de %', c.min_total using errcode = '22023'; end if;
  v := private.money_round(case c.kind when 'percent' then (s.subtotal - s.discount) * c.value / 100 else least(c.value, s.subtotal - s.discount) end, s.currency);
  update public.sales set coupon_code = c.code, coupon_discount = v, discount = discount + v where id = s.id;
  update public.store_coupons set uses = uses + 1 where id = c.id;
  perform private.sale_totals(s.id);
end $$;

/** Vista previa de un cupón en la tienda web o la caja. */
create or replace function public.store_coupon_check(p_org uuid, p_code text, p_total numeric, p_channel text default 'web')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('valid', true, 'code', c.code, 'kind', c.kind, 'value', c.value, 'min_total', c.min_total,
            'discount', case when coalesce(p_total, 0) < c.min_total then 0 when c.kind = 'percent' then round(p_total * c.value / 100) else least(c.value, p_total) end)
      from public.store_coupons c
     where c.organization_id = p_org and c.code = upper(btrim(p_code)) and length(btrim(p_code)) >= 4 and c.active
       and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
       and c.channel in ('ambos', p_channel) and (c.max_uses is null or c.uses < c.max_uses)), jsonb_build_object('valid', false))
$$;
grant execute on function public.store_coupon_check(uuid, text, numeric, text) to anon, authenticated;

-- ---------- Caja y pedidos web con promociones, cupón e identificación ----------
drop function if exists public.store_sell(uuid, jsonb, text, jsonb, numeric, numeric, text);
create or replace function public.store_sell(p_org uuid, p_items jsonb, p_payment_method text, p_customer jsonb default '{}',
  p_discount numeric default 0, p_cash numeric default null, p_notes text default null, p_coupon text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; s public.sales; cur text;
begin
  if not private.has_permission(p_org, 'store.create') then raise exception 'No autorizado para vender' using errcode = '42501'; end if;
  perform private.require_identity();
  if p_payment_method not in ('cash','card','bank_transfer','other') then raise exception 'Medio de pago inválido' using errcode = '22023'; end if;
  select base_currency into cur from public.organizations where id = p_org;
  insert into public.sales (organization_id, number, channel, status, customer_name, customer_doc_type, customer_doc_number, customer_email, customer_phone,
                            delivery, payment_method, currency, discount, seller_id, notes, paid_at, delivered_at)
  values (p_org, private.next_number(p_org, 'sale'), 'caja', 'entregada', nullif(btrim(coalesce(p_customer ->> 'name', '')), ''),
          nullif(p_customer ->> 'doc_type', ''), nullif(upper(btrim(coalesce(p_customer ->> 'doc_number', ''))), ''),
          nullif(lower(btrim(coalesce(p_customer ->> 'email', ''))), ''), nullif(btrim(coalesce(p_customer ->> 'phone', '')), ''),
          'en_caja', p_payment_method, cur, round(greatest(coalesce(p_discount, 0), 0), 2), auth.uid(), nullif(btrim(coalesce(p_notes, '')), ''), now(), now())
  returning id into v_id;
  perform private.store_fill_sale(v_id, p_items, 'venta', false, 'caja');
  select * into s from public.sales where id = v_id;
  if s.discount > s.subtotal then raise exception 'El descuento supera el total' using errcode = '22023'; end if;
  perform private.apply_coupon(v_id, p_coupon, 'caja');
  select * into s from public.sales where id = v_id;
  if p_payment_method = 'cash' then
    if p_cash is null or p_cash < s.total then raise exception 'El efectivo recibido (%) no alcanza para el total (%)', coalesce(p_cash, 0), s.total using errcode = '22023'; end if;
    update public.sales set cash_received = p_cash, change_given = p_cash - s.total where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'number', s.number, 'code', s.code, 'total', s.total, 'change', case when p_payment_method = 'cash' then p_cash - s.total end);
end $$;

drop function if exists public.store_web_order(uuid, jsonb, jsonb, text, text, text, text);
create or replace function public.store_web_order(p_org uuid, p_items jsonb, p_customer jsonb, p_delivery text, p_address text, p_payment text,
  p_notes text default null, p_coupon text default null)
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
  perform private.store_fill_sale(v_id, p_items, 'pedido_web', true, 'web');
  perform private.apply_coupon(v_id, p_coupon, 'web');
  select * into s from public.sales where id = v_id;
  return jsonb_build_object('id', v_id, 'number', s.number, 'code', s.code, 'total', s.total, 'currency', s.currency, 'tracking', v_track);
end $$;
revoke all on function public.store_web_order(uuid, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.store_web_order(uuid, jsonb, jsonb, text, text, text, text, text) to service_role;
grant execute on function public.store_sell(uuid, jsonb, text, jsonb, numeric, numeric, text, text) to authenticated;
revoke all on function private.store_fill_sale(uuid, jsonb, text, boolean, text), private.apply_coupon(uuid, text, text), private.sale_totals(uuid) from public;

-- Las demás operaciones de la tienda también exigen nombre y RUT
do $$
declare f text; def text; src text;
begin
  foreach f in array array['store_cancel_sale','store_set_order_status','store_purchase','store_adjust'] loop
    select pg_get_functiondef(p.oid), p.prosrc into def, src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f limit 1;
    if src is not null and src not like '%require_identity%' then
      execute regexp_replace(def, E'\nbegin\n', E'\nbegin\n  perform private.require_identity();\n');
    end if;
  end loop;
end $$;

-- ---------- Catálogo público con ofertas y disponibilidad ----------
drop function if exists public.store_catalog(uuid);
create or replace function public.store_catalog(p_org uuid)
returns table (id uuid, sku text, name text, description text, kind text, category text, brand text, unit text, price numeric, currency char(3),
               available boolean, stock numeric, availability text, image_asset_id uuid, warranty_months int,
               promo_label text, promo_price numeric, promo_kind text, promo_ends timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.sku, p.name, p.description, p.kind, p.category, p.brand, p.unit, p.price, p.currency,
         (not p.track_stock or p.stock > 0), case when p.track_stock then greatest(p.stock, 0) end,
         case when not p.track_stock or p.stock > greatest(p.min_stock, 5) then 'disponible' when p.stock > 0 then 'pocas' else 'agotado' end,
         p.image_asset_id, p.warranty_months,
         bp.label, case when bp.discount > 0 and pr.kind in ('percent','amount','price') then p.price - bp.discount end, pr.kind, pr.ends_at
    from public.products p
    left join lateral private.best_promo(p, 1, 'web') bp on true
    left join public.store_promotions pr on pr.id = bp.promotion_id
   where p.organization_id = p_org and p.active and p.online
     and exists (select 1 from public.site_settings ss where ss.organization_id = p_org and ss.is_published)
   order by p.kind, p.category nulls last, p.name
$$;
grant execute on function public.store_catalog(uuid) to anon, authenticated;

/** Disponibilidad de cupos de los cursos publicados. */
create or replace function public.offering_availability(p_org uuid)
returns table (id uuid, capacity int, taken bigint, status text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.capacity, (select count(*) from public.checkout_orders c where c.offering_id = o.id and c.status = 'paid'),
         case when o.starts_on is not null and o.starts_on < current_date - 30 then 'cerrado'
              when o.capacity is not null and (select count(*) from public.checkout_orders c where c.offering_id = o.id and c.status = 'paid') >= o.capacity then 'agotado'
              when o.capacity is not null and o.capacity - (select count(*) from public.checkout_orders c where c.offering_id = o.id and c.status = 'paid') <= 5 then 'ultimos'
              else 'disponible' end
    from public.catalog_offerings o where o.organization_id = p_org and o.is_published
$$;
grant execute on function public.offering_availability(uuid) to anon, authenticated;

-- Búsqueda: códigos de usuario y de boleta
create or replace function public.store_search(p_org uuid, p_q text)
returns table (kind text, id uuid, title text, subtitle text, href text, rank int)
language plpgsql stable security invoker set search_path = '' as $$
declare q text := public.search_norm(btrim(coalesce(p_q, ''))); pat text; n bigint; up text := upper(btrim(coalesce(p_q, '')));
begin
  if length(q) < 2 then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  n := case when q ~ '^[0-9]{1,15}$' then q::bigint when up ~ '^VENT[0-9]{1,9}$' then substr(up, 5)::bigint end;
  return query
    (select 'Producto'::text, p.id, p.name, concat_ws(' · ', p.sku, p.brand, 'stock ' || trim(to_char(p.stock, 'FM999999990.###'))), ('/app/tienda/productos/' || p.id)::text, 2
       from public.products p
      where p.organization_id = p_org and (public.search_norm(p.name) like pat or public.search_norm(p.sku) like pat or p.barcode = btrim(p_q) or public.search_norm(p.brand) like pat)
      order by p.name limit 6)
    union all
    (select 'Venta', s.id, 'Boleta ' || s.code, concat_ws(' · ', s.customer_name, s.currency || ' ' || s.total::text), '/app/tienda/ventas/' || s.id, 8
       from public.sales s where s.organization_id = p_org and (s.number = n or public.search_norm(s.customer_name) like pat or s.tracking_code = up)
      order by s.created_at desc limit 5)
    union all
    (select 'Usuario', pr.id, coalesce(pr.full_name, pr.email), concat_ws(' · ', pr.user_code, pr.id_document_number, pr.email), '/app/usuarios?revisar=' || pr.email, 3
       from public.profiles pr
      where (pr.user_code = up or public.search_norm(pr.id_document_number) like pat)
        and exists (select 1 from public.memberships m where m.user_id = pr.id and m.organization_id = p_org)
        and (private.has_permission(p_org, 'users.view') or private.is_owner(p_org))
      limit 5);
end $$;

-- ---------- Ingresos y egresos por día, semana, mes, semestre o año ----------
create or replace function private.period_start(d date, g text) returns date language sql immutable as $$
  select case g
    when 'day' then d
    when 'week' then date_trunc('week', d)::date
    when 'semester' then make_date(extract(year from d)::int, case when extract(month from d) <= 6 then 1 else 7 end, 1)
    when 'year' then date_trunc('year', d)::date
    else date_trunc('month', d)::date end
$$;

drop function if exists public.finance_report(uuid, date, date, text);
create or replace function public.finance_report(p_org uuid, p_from date, p_to date, p_currency text default null, p_group text default 'month')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cur text; tz text; res jsonb; g text := case when p_group in ('day','week','month','semester','year') then p_group else 'month' end;
  step interval;
begin
  if not private.has_permission(p_org, 'finance.view') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then raise exception 'Rango de fechas inválido' using errcode = '22023'; end if;
  if g = 'day' and p_to - p_from > 400 then raise exception 'Para ver por día elija un rango de hasta 400 días' using errcode = '22023'; end if;
  step := case g when 'day' then interval '1 day' when 'week' then interval '1 week' when 'semester' then interval '6 months' when 'year' then interval '1 year' else interval '1 month' end;
  select coalesce(upper(p_currency), o.base_currency), coalesce(o.timezone, 'America/Santiago') into cur, tz from public.organizations o where o.id = p_org;

  with pay as (
    select p.id, p.kind, p.refund_of, p.amount, private.period_start((p.paid_at at time zone tz)::date, g) as m
      from public.payments p
     where p.organization_id = p_org and p.status = 'confirmed' and p.currency = cur
       and (p.paid_at at time zone tz)::date between p_from and p_to),
  base as (select distinct coalesce(refund_of, id) as pid from pay),
  alloc as (
    select a.payment_id, c.enrollment_id, sum(a.amount) as amt
      from public.payment_allocations a join public.installments i on i.id = a.installment_id join public.charges c on c.id = i.charge_id
     where a.payment_id in (select pid from base) group by 1, 2),
  shares as (
    select x.payment_id, x.enrollment_id, x.amt / p.amount as share from alloc x join public.payments p on p.id = x.payment_id
    union all
    select p.id, null::uuid, greatest(0, 1 - coalesce((select sum(amt) from alloc where payment_id = p.id), 0) / p.amount)
      from public.payments p where p.id in (select pid from base)),
  lines as (
    select pay.m, s.enrollment_id, case when pay.kind = 'refund' then -1 else 1 end * pay.amount * s.share as amt
      from pay join shares s on s.payment_id = coalesce(pay.refund_of, pay.id) where s.share > 0),
  inc as (select l.m, l.enrollment_id, e.program_id, l.amt from lines l left join public.enrollments e on e.id = l.enrollment_id),
  secs as (
    select i.m, se.section_id, i.amt / count(*) over (partition by i.m, i.enrollment_id, i.amt) as amt
      from inc i join public.section_enrollments se on se.enrollment_id = i.enrollment_id and se.status <> 'dropped'),
  shop as (
    select private.period_start((s.paid_at at time zone tz)::date, g) as m, s.total as amt, s.cost_total
      from public.sales s
     where s.organization_id = p_org and s.status <> 'anulada' and s.paid_at is not null and s.currency = cur
       and (s.paid_at at time zone tz)::date between p_from and p_to),
  exp as (
    select private.period_start(x.spent_on, g) as m, x.program_id, x.section_id, x.category, x.amount as amt
      from public.expenses x where x.organization_id = p_org and x.currency = cur and x.spent_on between p_from and p_to),
  months as (select generate_series(private.period_start(p_from, g), p_to, step)::date as m),
  prog_ids as (select program_id as id from inc where program_id is not null union select program_id from exp where program_id is not null),
  sec_ids as (select section_id as id from secs union select section_id from exp where section_id is not null)
  select jsonb_build_object(
    'currency', cur, 'from', p_from, 'to', p_to, 'group', g,
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
grant execute on function public.finance_report(uuid, date, date, text, text) to authenticated;

-- El código de usuario no se puede cambiar desde la cuenta
create or replace function private.profiles_keep_code() returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and new.user_code is distinct from old.user_code and old.user_code is not null then new.user_code := old.user_code; end if;
  return new;
end $$;
drop trigger if exists trg_profiles_keep_code on public.profiles;
create trigger trg_profiles_keep_code before update on public.profiles for each row execute function private.profiles_keep_code();
