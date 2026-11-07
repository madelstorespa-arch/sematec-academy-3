-- =====================================================================
-- Organización: calendario académico, reservas de salas y recursos,
-- RR. HH. (asistencia del personal y permisos) e inventario
-- =====================================================================

insert into public.permissions (code, module, action, description)
select m.module || '.' || a.action, m.module, a.action, m.label || ' · ' || a.label
from (values
  ('calendar',   'Calendario académico'),
  ('facilities', 'Salas, recursos y reservas'),
  ('inventory',  'Inventario de bienes')
) as m(module, label)
cross join (values ('view','Ver'), ('create','Crear'), ('edit','Editar'), ('admin','Administrar')) as a(action, label)
on conflict (code) do nothing;

with grants(role_code, modules, actions) as (values
  ('propietario_institucional', array['calendar','facilities','inventory'], array['view','create','edit','admin']),
  ('director_general',   array['calendar','facilities','inventory'], array['view','create','edit']),
  ('director_academico', array['calendar','facilities'], array['view','create','edit']),
  ('administrador_sede', array['calendar','facilities','inventory'], array['view','create','edit']),
  ('coordinador',        array['calendar','facilities'], array['view','create','edit']),
  ('secretaria',         array['calendar','facilities'], array['view','create','edit']),
  ('contabilidad',       array['inventory'], array['view']),
  ('soporte_tecnico',    array['inventory','facilities'], array['view','create','edit']),
  ('auditor',            array['calendar','facilities','inventory'], array['view'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from grants g
join public.roles r on r.code = g.role_code and r.organization_id is null
join public.permissions p on p.module = any(g.modules) and p.action = any(g.actions)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Calendario académico
-- ---------------------------------------------------------------------
create table public.calendar_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  campus_id       uuid references public.campuses(id),
  kind            text not null default 'evento' check (kind in ('feriado','academico','evaluacion','evento','reunion','otro')),
  title           text not null check (length(title) between 2 and 200),
  description     text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  all_day         boolean not null default false,
  audience        text not null default 'all' check (audience in ('all','students','teachers','staff')),
  created_by      uuid default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index on public.calendar_events (organization_id, starts_at);
create trigger audit_calendar after insert or update or delete on public.calendar_events for each row execute function private.audit_row();
alter table public.calendar_events enable row level security;
create policy cal_select on public.calendar_events for select to authenticated using (
  private.is_member(organization_id) and (
    audience = 'all' or private.has_permission(organization_id, 'calendar.view')
    or (audience = 'students' and exists (select 1 from public.students s where s.user_id = auth.uid() and s.organization_id = calendar_events.organization_id))
    or (audience = 'teachers' and exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = calendar_events.organization_id))
    or (audience = 'staff' and private.is_staff(organization_id))));
create policy cal_write on public.calendar_events for all to authenticated
  using (private.has_permission(organization_id, 'calendar.edit'))
  with check (private.has_permission(organization_id, 'calendar.create'));

-- ---------------------------------------------------------------------
-- Recursos reservables y reservas (salas y equipos)
-- ---------------------------------------------------------------------
create table public.resources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  campus_id       uuid references public.campuses(id),
  code            text not null,
  name            text not null,
  kind            text not null default 'equipo' check (kind in ('equipo','proyector','notebook','laboratorio','vehiculo','otro')),
  status          text not null default 'disponible' check (status in ('disponible','mantencion','baja')),
  notes           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create table public.reservations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  room_id         uuid references public.rooms(id),
  resource_id     uuid references public.resources(id),
  reserved_by     uuid not null default auth.uid() references public.profiles(id),
  reserved_name   text,
  purpose         text not null check (length(purpose) between 2 and 300),
  during          tstzrange not null check (not isempty(during) and upper(during) - lower(during) <= interval '14 hours'),
  status          text not null default 'confirmada' check (status in ('confirmada','cancelada')),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(room_id, resource_id) = 1),
  constraint no_room_double_booking exclude using gist (room_id with =, during with &&) where (status = 'confirmada' and room_id is not null),
  constraint no_resource_double_booking exclude using gist (resource_id with =, during with &&) where (status = 'confirmada' and resource_id is not null)
);
create index on public.reservations (organization_id, lower(during));

-- Una sala no se puede reservar si a esa hora tiene clases (horario semanal del periodo vigente)
create or replace function private.check_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tz text; v_start timestamp; v_end timestamp; v_status text;
begin
  select full_name into new.reserved_name from public.profiles where id = new.reserved_by;
  if new.status <> 'confirmada' then return new; end if;
  if new.resource_id is not null then
    select status into v_status from public.resources where id = new.resource_id and organization_id = new.organization_id;
    if v_status is null then raise exception 'Recurso inexistente' using errcode = 'P0002'; end if;
    if v_status <> 'disponible' then raise exception 'El recurso no está disponible (%)', v_status using errcode = 'P0001'; end if;
    return new;
  end if;
  select coalesce(c.timezone, o.timezone) into v_tz from public.rooms r join public.organizations o on o.id = r.organization_id
    left join public.campuses c on c.id = r.campus_id where r.id = new.room_id and r.organization_id = new.organization_id;
  if v_tz is null then raise exception 'Sala inexistente' using errcode = 'P0002'; end if;
  v_start := lower(new.during) at time zone v_tz; v_end := upper(new.during) at time zone v_tz;
  if v_start::date <> (v_end - interval '1 second')::date then raise exception 'La reserva debe comenzar y terminar el mismo día' using errcode = '22023'; end if;
  if exists (
    select 1 from public.section_schedules ss join public.academic_periods p on p.id = ss.period_id
    where ss.room_id = new.room_id and ss.weekday = extract(isodow from v_start)
      and v_start::date between p.starts_on and p.ends_on
      and ss.time_slot && public.timerange(v_start::time, (case when v_end::time = '00:00' then '23:59:59' else v_end::time end))
  ) then raise exception 'La sala tiene clases programadas en ese horario' using errcode = '23P01'; end if;
  return new;
end $$;
create trigger trg_check_reservation before insert or update of during, status, room_id, resource_id on public.reservations
  for each row execute function private.check_reservation();
create trigger audit_reservations after insert or update or delete on public.reservations for each row execute function private.audit_row();
create trigger audit_resources after insert or update or delete on public.resources for each row execute function private.audit_row();

alter table public.resources enable row level security;
alter table public.reservations enable row level security;
create policy res_select on public.resources for select to authenticated using (private.is_member(organization_id));
create policy res_write on public.resources for all to authenticated
  using (private.has_permission(organization_id, 'facilities.edit')) with check (private.has_permission(organization_id, 'facilities.create'));
create policy rsv_select on public.reservations for select to authenticated using (private.is_member(organization_id));
-- Reservan: personal autorizado y profesores (para sí mismos)
create policy rsv_insert on public.reservations for insert to authenticated with check (
  reserved_by = auth.uid() and status = 'confirmada' and (
    private.has_permission(organization_id, 'facilities.create')
    or exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = reservations.organization_id and t.status = 'active')));
create policy rsv_update on public.reservations for update to authenticated
  using (reserved_by = auth.uid() or private.has_permission(organization_id, 'facilities.edit'))
  with check (reserved_by = auth.uid() or private.has_permission(organization_id, 'facilities.edit'));

-- ---------------------------------------------------------------------
-- RR. HH.: asistencia del personal y solicitudes de permiso
-- ---------------------------------------------------------------------
create table public.staff_attendance (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id     uuid not null references public.employees(id),
  work_date       date not null,
  check_in        timestamptz not null default now(),
  check_out       timestamptz,
  notes           text,
  unique (employee_id, work_date),
  check (check_out is null or check_out >= check_in)
);
create table public.leave_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id     uuid not null references public.employees(id),
  kind            text not null check (kind in ('vacaciones','administrativo','licencia_medica','sin_goce','otro')),
  starts_on       date not null,
  ends_on         date not null,
  reason          text,
  status          text not null default 'pendiente' check (status in ('pendiente','aprobado','rechazado')),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create trigger audit_staff_att after insert or update or delete on public.staff_attendance for each row execute function private.audit_row();
create trigger audit_leaves after insert or update or delete on public.leave_requests for each row execute function private.audit_row();
alter table public.staff_attendance enable row level security;
alter table public.leave_requests enable row level security;
create policy sa_select on public.staff_attendance for select to authenticated using (
  private.has_permission(organization_id, 'employees.view')
  or employee_id in (select e.id from public.employees e where e.user_id = auth.uid()));
create policy lr_select on public.leave_requests for select to authenticated using (
  private.has_permission(organization_id, 'employees.view')
  or employee_id in (select e.id from public.employees e where e.user_id = auth.uid()));
create policy lr_insert on public.leave_requests for insert to authenticated with check (
  status = 'pendiente' and employee_id in (select e.id from public.employees e where e.user_id = auth.uid() and e.organization_id = leave_requests.organization_id));

create or replace function public.clock(p_org uuid, p_out boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_tz text; v_today date; v_row public.staff_attendance;
begin
  select e.id into v_emp from public.employees e where e.user_id = auth.uid() and e.organization_id = p_org and e.status = 'active';
  if v_emp is null then raise exception 'Su usuario no está vinculado a una ficha de personal activa' using errcode = '42501'; end if;
  select timezone into v_tz from public.organizations where id = p_org;
  v_today := (now() at time zone v_tz)::date;
  select * into v_row from public.staff_attendance where employee_id = v_emp and work_date = v_today;
  if not p_out then
    if found then raise exception 'Ya registró su entrada hoy' using errcode = 'P0001'; end if;
    insert into public.staff_attendance (organization_id, employee_id, work_date) values (p_org, v_emp, v_today);
    return 'Entrada registrada';
  end if;
  if not found then raise exception 'Primero registre su entrada' using errcode = 'P0001'; end if;
  if v_row.check_out is not null then raise exception 'Ya registró su salida hoy' using errcode = 'P0001'; end if;
  update public.staff_attendance set check_out = now() where id = v_row.id;
  return 'Salida registrada';
end $$;

create or replace function public.decide_leave(p_leave uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.leave_requests;
begin
  select * into l from public.leave_requests where id = p_leave for update;
  if not found then raise exception 'Solicitud inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(l.organization_id, 'employees.edit') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if l.status <> 'pendiente' then raise exception 'La solicitud ya fue resuelta' using errcode = 'P0001'; end if;
  update public.leave_requests set status = case when p_approve then 'aprobado' else 'rechazado' end, decided_by = auth.uid(), decided_at = now() where id = l.id;
  insert into public.notifications (organization_id, user_id, category, title, body, data)
  select l.organization_id, e.user_id, 'hr', 'Solicitud de permiso ' || case when p_approve then 'aprobada' else 'rechazada' end,
         to_char(l.starts_on, 'DD-MM-YYYY') || ' a ' || to_char(l.ends_on, 'DD-MM-YYYY'), jsonb_build_object('leave_id', l.id)
  from public.employees e where e.id = l.employee_id and e.user_id is not null;
end $$;

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
create table public.inventory_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  campus_id       uuid references public.campuses(id),
  room_id         uuid references public.rooms(id),
  code            text not null,
  name            text not null check (length(name) between 2 and 200),
  category        text not null default 'otro' check (category in ('computador','mobiliario','audiovisual','redes','laboratorio','oficina','otro')),
  brand           text,
  model           text,
  serial_number   text,
  status          text not null default 'operativo' check (status in ('operativo','en_reparacion','prestado','de_baja')),
  assigned_to     text,
  purchase_date   date,
  purchase_value  numeric(14,2) check (purchase_value >= 0),
  currency        text not null default 'CLP',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);
create table public.inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  item_id         uuid not null references public.inventory_items(id) on delete cascade,
  kind            text not null,
  detail          text not null,
  moved_by        uuid default auth.uid() references public.profiles(id),
  moved_by_name   text,
  created_at      timestamptz not null default now()
);
create trigger trg_inventory_updated before update on public.inventory_items for each row execute function private.set_updated_at();
create trigger audit_inventory after insert or update or delete on public.inventory_items for each row execute function private.audit_row();

-- Historial automático de altas, traslados, asignaciones y cambios de estado
create or replace function private.inventory_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_detail text := ''; v_kind text := 'actualizacion';
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    v_kind := 'alta'; v_detail := 'Ingreso al inventario';
  else
    if new.status is distinct from old.status then v_kind := case new.status when 'de_baja' then 'baja' when 'en_reparacion' then 'reparacion' else 'estado' end;
      v_detail := v_detail || 'Estado: ' || old.status || ' → ' || new.status || '. '; end if;
    if new.room_id is distinct from old.room_id or new.campus_id is distinct from old.campus_id then v_kind := 'traslado';
      v_detail := v_detail || 'Ubicación: ' || coalesce((select code from public.rooms where id = old.room_id), '—') || ' → ' || coalesce((select code from public.rooms where id = new.room_id), '—') || '. '; end if;
    if new.assigned_to is distinct from old.assigned_to then v_kind := 'asignacion';
      v_detail := v_detail || 'Asignado: ' || coalesce(old.assigned_to, '—') || ' → ' || coalesce(new.assigned_to, '—') || '. '; end if;
    if v_detail = '' then return null; end if;
  end if;
  insert into public.inventory_movements (organization_id, item_id, kind, detail, moved_by_name) values (new.organization_id, new.id, v_kind, trim(v_detail), v_name);
  return null;
end $$;
create trigger trg_inventory_log after insert or update on public.inventory_items for each row execute function private.inventory_log();

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
create policy inv_select on public.inventory_items for select to authenticated using (private.has_permission(organization_id, 'inventory.view'));
create policy inv_insert on public.inventory_items for insert to authenticated with check (private.has_permission(organization_id, 'inventory.create'));
create policy inv_update on public.inventory_items for update to authenticated
  using (private.has_permission(organization_id, 'inventory.edit')) with check (private.has_permission(organization_id, 'inventory.edit'));
create policy invm_select on public.inventory_movements for select to authenticated using (private.has_permission(organization_id, 'inventory.view'));

-- Privilegios
grant select, insert, update, delete on public.calendar_events, public.resources to authenticated;
grant select, insert on public.reservations to authenticated;
grant update (status) on public.reservations to authenticated;
grant select on public.staff_attendance to authenticated;
grant select, insert on public.leave_requests to authenticated;
grant select, insert, update on public.inventory_items to authenticated;
grant select on public.inventory_movements to authenticated;
grant all on public.calendar_events, public.resources, public.reservations, public.staff_attendance, public.leave_requests,
  public.inventory_items, public.inventory_movements to service_role;
grant execute on function public.clock(uuid, boolean), public.decide_leave(uuid, boolean) to authenticated;
