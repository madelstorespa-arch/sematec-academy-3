-- «Paga con tu banco» (transferencia inmediata vía Fintoc): nuevo proveedor de pago
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.checkout_orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%webpay%'
  loop
    execute format('alter table public.checkout_orders drop constraint %I', c);
  end loop;
end $$;
alter table public.checkout_orders add constraint checkout_orders_provider_check
  check (provider in ('webpay','mercadopago','flow','stripe','fintoc'));
