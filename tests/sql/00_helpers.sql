-- =====================================================================
-- Utilidades de prueba. Simulan sesiones de Supabase:
--   select tests.login('<uuid>', 'aal1'|'aal2');  set role authenticated;
-- Cada archivo de prueba corre en una transacción que se revierte.
-- =====================================================================
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.login(p_user uuid, p_aal text default 'aal1')
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, false);
$$;

create or replace function tests.service()
returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false);
$$;

create or replace function tests.anon()
returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', false);
$$;

create or replace function tests.ok(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALLÓ: %', p_msg;
  end if;
  raise notice 'OK   %', p_msg;
end $$;

-- Ejecuta SQL y exige que falle (opcionalmente con un SQLSTATE concreto)
create or replace function tests.fails(p_sql text, p_msg text, p_state text default null)
returns void language plpgsql as $$
declare v_state text; v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_err = message_text;
    if p_state is not null and v_state <> p_state then
      raise exception 'FALLÓ: % (se esperaba SQLSTATE %, se obtuvo % - %)', p_msg, p_state, v_state, v_err;
    end if;
    raise notice 'OK   % [bloqueado: %]', p_msg, v_err;
    return;
  end;
  raise exception 'FALLÓ: % (la operación debía ser rechazada)', p_msg;
end $$;

-- Cuenta filas visibles para el rol actual
create or replace function tests.visible(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') x' into n;
  return n;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Alias legibles para los identificadores del seed
create table if not exists tests.ids (name text primary key, id uuid not null);
insert into tests.ids values
  ('superadmin', '00000000-0000-4000-8000-000000000001'),
  ('owner_a',    '00000000-0000-4000-8000-000000000010'),
  ('secretaria_a','00000000-0000-4000-8000-000000000011'),
  ('tesoreria_a','00000000-0000-4000-8000-000000000012'),
  ('director_a', '00000000-0000-4000-8000-000000000013'),
  ('auditor_a',  '00000000-0000-4000-8000-000000000014'),
  ('soporte_a',  '00000000-0000-4000-8000-000000000015'),
  ('matriculas_a','00000000-0000-4000-8000-000000000016'),
  ('prof1_u',    '00000000-0000-4000-8000-000000000020'),
  ('prof2_u',    '00000000-0000-4000-8000-000000000021'),
  ('est1_u',     '00000000-0000-4000-8000-000000000030'),
  ('est2_u',     '00000000-0000-4000-8000-000000000031'),
  ('est3_u',     '00000000-0000-4000-8000-000000000032'),
  ('postulante', '00000000-0000-4000-8000-000000000040'),
  ('owner_b',    '00000000-0000-4000-8000-000000000050'),
  ('estb1_u',    '00000000-0000-4000-8000-000000000051'),
  ('org_a',      '0a000000-0000-4000-8000-000000000001'),
  ('org_b',      '0b000000-0000-4000-8000-000000000001'),
  ('campus_a1',  '0a000000-0000-4000-8000-0000000000c1'),
  ('campus_a2',  '0a000000-0000-4000-8000-0000000000c2'),
  ('campus_b1',  '0b000000-0000-4000-8000-0000000000c1'),
  ('room_a101',  '0a000000-0000-4000-8000-00000000aa01'),
  ('room_lab1',  '0a000000-0000-4000-8000-00000000aa02'),
  ('scale_a',    '0a000000-0000-4000-8000-00000000a5c1'),
  ('prog_a',     '0a000000-0000-4000-8000-00000000a9a1'),
  ('prog_b',     '0b000000-0000-4000-8000-00000000b9a1'),
  ('curr_a',     '0a000000-0000-4000-8000-00000000acc1'),
  ('prg101',     '0a000000-0000-4000-8000-00000000ac01'),
  ('prg201',     '0a000000-0000-4000-8000-00000000ac02'),
  ('bdd101',     '0a000000-0000-4000-8000-00000000ac03'),
  ('period_a',   '0a000000-0000-4000-8000-00000000ae01'),
  ('period_b',   '0b000000-0000-4000-8000-00000000be01'),
  ('sec_prg101', '0a000000-0000-4000-8000-00000000ad01'),
  ('sec_prg201', '0a000000-0000-4000-8000-00000000ad02'),
  ('sec_bdd101', '0a000000-0000-4000-8000-00000000ad03'),
  ('prof1',      '0a000000-0000-4000-8000-00000000a701'),
  ('prof2',      '0a000000-0000-4000-8000-00000000a702'),
  ('est1',       '0a000000-0000-4000-8000-00000000a501'),
  ('est2',       '0a000000-0000-4000-8000-00000000a502'),
  ('est3',       '0a000000-0000-4000-8000-00000000a503'),
  ('estb1',      '0b000000-0000-4000-8000-00000000b501'),
  ('tpl_course', '0a000000-0000-4000-8000-00000000ce01'),
  ('tpl_regular','0a000000-0000-4000-8000-00000000ce02'),
  ('tpl_conf',   '0a000000-0000-4000-8000-00000000ce03'),
  ('croom_bdd',  '0a000000-0000-4000-8000-00000000cf01')
on conflict (name) do nothing;
create or replace function tests.id(p_name text) returns uuid language sql stable as $$
  select id from tests.ids where name = p_name
$$;
grant select on tests.ids to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;
