-- =====================================================================
-- Comunicación (anuncios y mensajes), biblioteca y soporte técnico
-- =====================================================================

-- Permisos nuevos
insert into public.permissions (code, module, action, description)
select m.module || '.' || a.action, m.module, a.action, m.label || ' · ' || a.label
from (values
  ('communications', 'Anuncios y mensajería'),
  ('library',        'Biblioteca y préstamos'),
  ('support',        'Soporte técnico (mesa de ayuda)')
) as m(module, label)
cross join (values ('view','Ver'), ('create','Crear'), ('edit','Editar'), ('admin','Administrar')) as a(action, label)
on conflict (code) do nothing;

with grants(role_code, modules, actions) as (values
  ('propietario_institucional', array['communications','library','support'], array['view','create','edit','admin']),
  ('director_general',   array['communications','library','support'], array['view','create','edit']),
  ('director_academico', array['communications','library','support'], array['view','create','edit']),
  ('administrador_sede', array['communications','support'], array['view','create','edit']),
  ('coordinador',        array['communications','library'], array['view','create','edit']),
  ('secretaria',         array['communications','library','support'], array['view','create','edit']),
  ('bibliotecario',      array['library'], array['view','create','edit','admin']),
  ('soporte_tecnico',    array['support'], array['view','create','edit','admin'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from grants g
join public.roles r on r.code = g.role_code and r.organization_id is null
join public.permissions p on p.module = any(g.modules) and p.action = any(g.actions)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Anuncios
-- ---------------------------------------------------------------------
create table public.announcements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section_id      uuid references public.sections(id),
  audience        text not null default 'all' check (audience in ('all','students','teachers','staff','section')),
  title           text not null check (length(title) between 3 and 200),
  body            text not null check (length(body) between 1 and 20000),
  pinned          boolean not null default false,
  published_at    timestamptz not null default now(),
  expires_at      timestamptz,
  created_by      uuid not null default auth.uid() references public.profiles(id),
  author_name     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((audience = 'section') = (section_id is not null))
);
create index on public.announcements (organization_id, published_at desc);
create trigger trg_announcements_updated before update on public.announcements for each row execute function private.set_updated_at();
create trigger audit_announcements after insert or update or delete on public.announcements for each row execute function private.audit_row();

create or replace function private.is_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_user_active() and exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id
    where m.user_id = auth.uid() and m.organization_id = p_org and m.status = 'active'
      and (m.valid_until is null or m.valid_until > now())
      and r.code not in ('estudiante','postulante','egresado','profesor'))
$$;

create or replace function private.can_see_announcement(a public.announcements)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(a.organization_id) and (
    private.has_permission(a.organization_id, 'communications.view')
    or a.created_by = auth.uid()
    or (a.published_at <= now() and (a.expires_at is null or a.expires_at > now()) and case a.audience
      when 'all' then true
      when 'students' then exists (select 1 from public.students s where s.user_id = auth.uid() and s.organization_id = a.organization_id)
      when 'teachers' then exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.organization_id = a.organization_id)
      when 'staff' then private.is_staff(a.organization_id)
      when 'section' then private.teaches_section(a.section_id) or private.enrolled_in_section(a.section_id)
    end))
$$;

alter table public.announcements enable row level security;
create policy ann_select on public.announcements for select to authenticated using (private.can_see_announcement(announcements));
create policy ann_insert on public.announcements for insert to authenticated with check (
  created_by = auth.uid() and (
    private.has_permission(organization_id, 'communications.create')
    or (audience = 'section' and private.teaches_section(section_id))));
create policy ann_update on public.announcements for update to authenticated
  using (private.has_permission(organization_id, 'communications.edit') or (created_by = auth.uid() and private.is_member(organization_id)))
  with check (private.has_permission(organization_id, 'communications.edit') or (created_by = auth.uid() and (audience <> 'section' and private.has_permission(organization_id, 'communications.create') or private.teaches_section(section_id))));
create policy ann_delete on public.announcements for delete to authenticated
  using (private.has_permission(organization_id, 'communications.edit') or (created_by = auth.uid() and private.is_member(organization_id)));

-- ---------------------------------------------------------------------
-- Mensajería interna
-- ---------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  sender_id       uuid not null default auth.uid() references public.profiles(id),
  recipient_id    uuid not null references public.profiles(id),
  parent_id       uuid references public.messages(id),
  subject         text not null check (length(subject) between 1 and 200),
  body            text not null check (length(body) between 1 and 10000),
  read_at         timestamptz,
  sender_name     text,
  recipient_name  text,
  created_at      timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index on public.messages (recipient_id, created_at desc);
create index on public.messages (sender_id, created_at desc);

-- Destinatarios permitidos: el personal ve a todos; estudiantes y profesores ven al personal,
-- a sus profesores / estudiantes de sus secciones (nunca la lista completa de estudiantes).
create or replace function public.message_recipients(p_org uuid)
returns table (user_id uuid, full_name text, role_name text) language sql stable security definer set search_path = '' as $$
  with me as (select private.is_member(p_org) ok, private.is_staff(p_org) staff),
  members as (
    select distinct on (p.id) p.id, p.full_name, r.name, r.code
    from public.memberships m join public.profiles p on p.id = m.user_id join public.roles r on r.id = m.role_id
    where m.organization_id = p_org and m.status = 'active' and p.status = 'active' and p.id <> auth.uid()
    order by p.id, r.code in ('estudiante','postulante','egresado')
  )
  select x.id, x.full_name, x.name from members x, me
  where me.ok and (
    me.staff
    or x.code not in ('estudiante','postulante','egresado','profesor')
    or exists (  -- mis profesores (soy estudiante) o mis estudiantes (soy profesor)
      select 1 from public.section_enrollments se
      join public.sections s on s.id = se.section_id
      join public.students st on st.id = se.student_id
      join public.teachers t on t.id = s.teacher_id
      where s.organization_id = p_org and se.status = 'enrolled'
        and ((st.user_id = auth.uid() and t.user_id = x.id) or (t.user_id = auth.uid() and st.user_id = x.id))))
  order by x.full_name
$$;

alter table public.messages enable row level security;
create policy msg_select on public.messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy msg_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and private.is_member(organization_id)
  and exists (select 1 from public.message_recipients(organization_id) r where r.user_id = recipient_id));
create policy msg_read on public.messages for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function private.notify_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (organization_id, user_id, category, title, body, data)
  values (new.organization_id, new.recipient_id, 'message', 'Nuevo mensaje: ' || left(new.subject, 120),
          left(new.body, 280), jsonb_build_object('message_id', new.id, 'sender_id', new.sender_id));
  return null;
end $$;
create trigger trg_notify_message after insert on public.messages for each row execute function private.notify_message();

-- ---------------------------------------------------------------------
-- Biblioteca
-- ---------------------------------------------------------------------
create table public.library_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  item_type        text not null default 'libro' check (item_type in ('libro','ebook','revista','tesis','video','enlace','otro')),
  title            text not null check (length(title) between 1 and 300),
  author           text,
  publisher        text,
  year             int check (year between 1400 and 2100),
  isbn             text,
  category         text,
  course_id        uuid references public.courses(id),
  url              text check (url is null or url ~* '^https://'),
  description      text,
  total_copies     int not null default 0 check (total_copies >= 0),
  available_copies int not null default 0 check (available_copies >= 0),
  created_by       uuid default auth.uid() references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (available_copies <= total_copies)
);
create index on public.library_items (organization_id, title);
create trigger trg_library_items_updated before update on public.library_items for each row execute function private.set_updated_at();
create trigger audit_library_items after insert or update or delete on public.library_items for each row execute function private.audit_row();

create table public.library_loans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  item_id         uuid not null references public.library_items(id),
  borrower_id     uuid not null references public.profiles(id),
  loaned_at       timestamptz not null default now(),
  due_on          date not null,
  returned_at     timestamptz,
  loaned_by       uuid not null default auth.uid() references public.profiles(id),
  notes           text
);
create index on public.library_loans (organization_id, returned_at);
create index on public.library_loans (borrower_id);
create trigger audit_library_loans after insert or update or delete on public.library_loans for each row execute function private.audit_row();

alter table public.library_items enable row level security;
alter table public.library_loans enable row level security;
create policy lib_select on public.library_items for select to authenticated using (private.is_member(organization_id));
create policy lib_insert on public.library_items for insert to authenticated with check (private.has_permission(organization_id, 'library.create'));
create policy lib_update on public.library_items for update to authenticated
  using (private.has_permission(organization_id, 'library.edit')) with check (private.has_permission(organization_id, 'library.edit'));
create policy loan_select on public.library_loans for select to authenticated
  using (borrower_id = auth.uid() or private.has_permission(organization_id, 'library.view'));

create or replace function public.library_loan(p_item uuid, p_borrower uuid, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare it public.library_items; v_id uuid;
begin
  select * into it from public.library_items where id = p_item for update;
  if not found then raise exception 'Material inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(it.organization_id, 'library.edit') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if it.available_copies < 1 then raise exception 'No hay ejemplares disponibles' using errcode = 'P0001'; end if;
  if p_due < current_date then raise exception 'La fecha de devolución no puede ser pasada' using errcode = '22023'; end if;
  if not exists (select 1 from public.memberships m where m.user_id = p_borrower and m.organization_id = it.organization_id and m.status = 'active') then
    raise exception 'El lector no pertenece a la institución' using errcode = '22023';
  end if;
  update public.library_items set available_copies = available_copies - 1 where id = p_item;
  insert into public.library_loans (organization_id, item_id, borrower_id, due_on) values (it.organization_id, p_item, p_borrower, p_due) returning id into v_id;
  return v_id;
end $$;

create or replace function public.library_return(p_loan uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.library_loans;
begin
  select * into l from public.library_loans where id = p_loan for update;
  if not found then raise exception 'Préstamo inexistente' using errcode = 'P0002'; end if;
  if not private.has_permission(l.organization_id, 'library.edit') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if l.returned_at is not null then return; end if;
  update public.library_loans set returned_at = now() where id = p_loan;
  update public.library_items set available_copies = least(total_copies, available_copies + 1) where id = l.item_id;
end $$;

-- Lectores posibles (solo personal de biblioteca)
create or replace function public.library_borrowers(p_org uuid)
returns table (user_id uuid, full_name text, email text) language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.full_name, p.email from public.memberships m join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and m.status = 'active' and p.status = 'active'
    and private.has_permission(p_org, 'library.edit')
  order by p.full_name
$$;

-- ---------------------------------------------------------------------
-- Soporte técnico (mesa de ayuda)
-- ---------------------------------------------------------------------
create table public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  number          bigint generated always as identity,
  requester_id    uuid not null default auth.uid() references public.profiles(id),
  category        text not null default 'general' check (category in ('acceso','plataforma','aula_virtual','pagos','academico','general')),
  priority        text not null default 'normal' check (priority in ('baja','normal','alta','urgente')),
  subject         text not null check (length(subject) between 3 and 200),
  status          text not null default 'abierto' check (status in ('abierto','en_progreso','esperando_usuario','resuelto','cerrado')),
  assigned_to     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index on public.support_tickets (organization_id, status, created_at desc);
create trigger trg_tickets_updated before update on public.support_tickets for each row execute function private.set_updated_at();
create trigger audit_tickets after insert or update or delete on public.support_tickets for each row execute function private.audit_row();

create table public.support_messages (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references public.support_tickets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  author_id       uuid not null default auth.uid() references public.profiles(id),
  body            text not null check (length(body) between 1 and 10000),
  internal        boolean not null default false,
  author_name     text,
  created_at      timestamptz not null default now()
);
create index on public.support_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy tk_select on public.support_tickets for select to authenticated
  using (requester_id = auth.uid() or private.has_permission(organization_id, 'support.view'));
create policy tk_insert on public.support_tickets for insert to authenticated
  with check (requester_id = auth.uid() and private.is_member(organization_id) and status = 'abierto' and assigned_to is null);
create policy tk_update on public.support_tickets for update to authenticated
  using (private.has_permission(organization_id, 'support.edit')) with check (private.has_permission(organization_id, 'support.edit'));
create policy tkm_select on public.support_messages for select to authenticated using (
  exists (select 1 from public.support_tickets t where t.id = ticket_id and (
    private.has_permission(t.organization_id, 'support.view') or (t.requester_id = auth.uid() and not internal))));
create policy tkm_insert on public.support_messages for insert to authenticated with check (
  author_id = auth.uid() and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.organization_id = organization_id and (
    private.has_permission(t.organization_id, 'support.edit') or (t.requester_id = auth.uid() and not internal and t.status <> 'cerrado'))));

-- El solicitante que responde reabre un ticket en espera
create or replace function private.ticket_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  select * into t from public.support_tickets where id = new.ticket_id;
  if new.author_id = t.requester_id and t.status in ('esperando_usuario','resuelto') then
    update public.support_tickets set status = 'abierto' where id = t.id;
  elsif new.author_id <> t.requester_id and not new.internal then
    insert into public.notifications (organization_id, user_id, category, title, body, data)
    values (t.organization_id, t.requester_id, 'support', 'Respuesta a su ticket #' || t.number, left(new.body, 280), jsonb_build_object('ticket_id', t.id));
  end if;
  return null;
end $$;
create trigger trg_ticket_reply after insert on public.support_messages for each row execute function private.ticket_reply();

-- Nombres visibles para ambas partes (los perfiles ajenos no son legibles por RLS)
create or replace function private.fill_names() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'messages' then
    select full_name into new.sender_name from public.profiles where id = new.sender_id;
    select full_name into new.recipient_name from public.profiles where id = new.recipient_id;
  elsif tg_table_name = 'announcements' then
    select full_name into new.author_name from public.profiles where id = new.created_by;
  else
    select full_name into new.author_name from public.profiles where id = new.author_id;
  end if;
  return new;
end $$;
create trigger trg_msg_names before insert on public.messages for each row execute function private.fill_names();
create trigger trg_ann_names before insert on public.announcements for each row execute function private.fill_names();
create trigger trg_tkm_names before insert on public.support_messages for each row execute function private.fill_names();

-- Privilegios
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant select, insert, update on public.library_items to authenticated;
grant select on public.library_loans to authenticated;
grant select, insert on public.support_tickets to authenticated;
grant update (status, assigned_to, priority, closed_at) on public.support_tickets to authenticated;
grant select, insert on public.support_messages to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.announcements, public.messages, public.library_items, public.library_loans, public.support_tickets, public.support_messages to service_role;
grant execute on function public.message_recipients(uuid), public.library_loan(uuid, uuid, date), public.library_return(uuid), public.library_borrowers(uuid) to authenticated;
grant execute on function private.is_staff(uuid), private.can_see_announcement(public.announcements) to authenticated;
