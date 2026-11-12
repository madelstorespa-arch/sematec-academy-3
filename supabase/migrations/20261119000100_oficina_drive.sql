-- =====================================================================
-- SEMATEC Oficina · Drive: carpetas, compartir por persona (lector,
-- comentarista, editor) con caducidad, versiones restaurables,
-- comentarios, favoritos, recientes y control de conflictos al guardar.
-- =====================================================================

create table if not exists public.office_folders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id        uuid not null default auth.uid() references public.profiles(id),
  parent_id       uuid references public.office_folders(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists office_folders_owner_idx on public.office_folders (owner_id, parent_id);
alter table public.office_folders enable row level security;
drop policy if exists office_folders_own on public.office_folders;
create policy office_folders_own on public.office_folders for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and private.is_member(organization_id));
grant select, insert, update, delete on public.office_folders to authenticated;
grant all on public.office_folders to service_role;

alter table public.office_documents add column if not exists folder_id uuid references public.office_folders(id) on delete set null;
alter table public.office_documents add column if not exists version integer not null default 1;

create table if not exists public.office_shares (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_id     uuid not null references public.office_documents(id) on delete cascade,
  grantee_id      uuid not null references public.profiles(id) on delete cascade,
  permission      text not null check (permission in ('viewer','commenter','editor')),
  expires_at      timestamptz,
  created_by      uuid not null default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (document_id, grantee_id)
);
create index if not exists office_shares_grantee_idx on public.office_shares (grantee_id);

create table if not exists public.office_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_id     uuid not null references public.office_documents(id) on delete cascade,
  version         integer not null,
  title           text not null,
  content         jsonb not null,
  label           text check (label is null or length(label) <= 120),
  created_by      uuid not null default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists office_versions_doc_idx on public.office_versions (document_id, created_at desc);

create table if not exists public.office_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_id     uuid not null references public.office_documents(id) on delete cascade,
  parent_id       uuid references public.office_comments(id) on delete cascade,
  author_id       uuid not null default auth.uid() references public.profiles(id),
  body            text not null check (length(trim(body)) between 1 and 2000),
  quote           text check (quote is null or length(quote) <= 500),
  resolved        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists office_comments_doc_idx on public.office_comments (document_id, created_at);

create table if not exists public.office_marks (
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  document_id uuid not null references public.office_documents(id) on delete cascade,
  starred     boolean not null default false,
  opened_at   timestamptz,
  primary key (user_id, document_id)
);

-- Nivel de acceso de la persona actual a un documento: owner > editor > commenter > viewer
create or replace function private.office_access(p_doc uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when d.owner_id = auth.uid() then 'owner'
    when d.deleted_at is not null then null
    else (select x.p from (values
            ((select s.permission from public.office_shares s where s.document_id = d.id and s.grantee_id = auth.uid() and (s.expires_at is null or s.expires_at > now()))),
            (case d.shared when 'org_edit' then 'editor' when 'org_view' then 'viewer' end)) x(p)
          where x.p is not null
          order by case x.p when 'editor' then 1 when 'commenter' then 2 else 3 end limit 1)
  end
  from public.office_documents d
  where d.id = p_doc and private.is_member(d.organization_id)
$$;
grant execute on function private.office_access(uuid) to authenticated;

create or replace function public.office_my_access(p_doc uuid)
returns text language sql stable security definer set search_path = '' as $$ select private.office_access(p_doc) $$;
grant execute on function public.office_my_access(uuid) to authenticated;

-- Documentos: lectura por cualquier acceso; edición solo dueño o editor (también en la API)
drop policy if exists office_read on public.office_documents;
-- (el dueño se comprueba en la misma fila: así funciona también al crear el documento)
create policy office_read on public.office_documents for select to authenticated using (owner_id = auth.uid() or private.office_access(id) is not null);
drop policy if exists office_update on public.office_documents;
create policy office_update on public.office_documents for update to authenticated
  using (private.office_access(id) in ('owner','editor')) with check (private.is_member(organization_id));

create or replace function private.office_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id or new.organization_id <> old.organization_id then
    raise exception 'No se puede cambiar el dueño del documento' using errcode = '42501';
  end if;
  if (new.shared is distinct from old.shared or new.deleted_at is distinct from old.deleted_at or new.folder_id is distinct from old.folder_id)
     and old.owner_id <> auth.uid() then
    raise exception 'Solo el dueño puede compartir, mover o eliminar el documento' using errcode = '42501';
  end if;
  if new.content is distinct from old.content or new.title is distinct from old.title then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  -- El servidor de ONLYOFFICE guarda con la clave de servicio e indica quién editó
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- Compartidos: los gestiona el dueño; el invitado ve su propia invitación
alter table public.office_shares enable row level security;
drop policy if exists office_shares_read on public.office_shares;
create policy office_shares_read on public.office_shares for select to authenticated
  using (grantee_id = auth.uid() or private.office_access(document_id) = 'owner');
drop policy if exists office_shares_write on public.office_shares;
create policy office_shares_write on public.office_shares for all to authenticated
  using (private.office_access(document_id) = 'owner')
  with check (private.office_access(document_id) = 'owner' and created_by = auth.uid());
grant select, insert, update, delete on public.office_shares to authenticated;
grant all on public.office_shares to service_role;

create or replace function private.office_share_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.office_documents where id = new.document_id;
  new.organization_id := v_org;
  if new.grantee_id = (select owner_id from public.office_documents where id = new.document_id) then
    raise exception 'El dueño ya tiene acceso' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships m where m.user_id = new.grantee_id and m.organization_id = v_org and m.status = 'active') then
    raise exception 'Solo se puede compartir con personas de la misma institución' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_office_share_check on public.office_shares;
create trigger trg_office_share_check before insert or update on public.office_shares for each row execute function private.office_share_check();

-- Versiones
alter table public.office_versions enable row level security;
drop policy if exists office_versions_read on public.office_versions;
create policy office_versions_read on public.office_versions for select to authenticated using (private.office_access(document_id) is not null);
drop policy if exists office_versions_insert on public.office_versions;
create policy office_versions_insert on public.office_versions for insert to authenticated
  with check (created_by = auth.uid() and private.office_access(document_id) in ('owner','editor'));
drop policy if exists office_versions_delete on public.office_versions;
create policy office_versions_delete on public.office_versions for delete to authenticated using (private.office_access(document_id) = 'owner');
grant select, insert, delete on public.office_versions to authenticated;
grant all on public.office_versions to service_role;

-- Comentarios
alter table public.office_comments enable row level security;
drop policy if exists office_comments_read on public.office_comments;
create policy office_comments_read on public.office_comments for select to authenticated using (private.office_access(document_id) is not null);
drop policy if exists office_comments_insert on public.office_comments;
create policy office_comments_insert on public.office_comments for insert to authenticated
  with check (author_id = auth.uid() and private.office_access(document_id) in ('owner','editor','commenter'));
drop policy if exists office_comments_update on public.office_comments;
create policy office_comments_update on public.office_comments for update to authenticated
  using (author_id = auth.uid() or private.office_access(document_id) in ('owner','editor'))
  with check (private.office_access(document_id) is not null);
drop policy if exists office_comments_delete on public.office_comments;
create policy office_comments_delete on public.office_comments for delete to authenticated
  using (author_id = auth.uid() or private.office_access(document_id) = 'owner');
grant select, insert, update, delete on public.office_comments to authenticated;
grant all on public.office_comments to service_role;

create or replace function private.office_child_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.organization_id := (select organization_id from public.office_documents where id = new.document_id);
  return new;
end $$;
drop trigger if exists trg_office_versions_org on public.office_versions;
create trigger trg_office_versions_org before insert on public.office_versions for each row execute function private.office_child_org();
drop trigger if exists trg_office_comments_org on public.office_comments;
create trigger trg_office_comments_org before insert on public.office_comments for each row execute function private.office_child_org();

-- Favoritos y recientes (por persona)
alter table public.office_marks enable row level security;
drop policy if exists office_marks_own on public.office_marks;
create policy office_marks_own on public.office_marks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.office_access(document_id) is not null);
grant select, insert, update, delete on public.office_marks to authenticated;
grant all on public.office_marks to service_role;

-- Auditoría de documentos y compartidos
drop trigger if exists trg_office_documents_audit on public.office_documents;
create trigger trg_office_documents_audit after insert or delete or update of shared, deleted_at, folder_id, owner_id on public.office_documents
  for each row execute function private.audit_row();
drop trigger if exists trg_office_shares_audit on public.office_shares;
create trigger trg_office_shares_audit after insert or update or delete on public.office_shares for each row execute function private.audit_row();

-- Personas de la institución para compartir (solo para miembros)
create or replace function public.office_people(p_org uuid, p_q text)
returns table (id uuid, full_name text, email text) language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email from public.profiles p
  where private.is_member(p_org) and p.id <> auth.uid()
    and exists (select 1 from public.memberships m where m.user_id = p.id and m.organization_id = p_org and m.status = 'active')
    and (coalesce(trim(p_q), '') = '' or p.full_name ilike '%' || trim(p_q) || '%' or p.email ilike '%' || trim(p_q) || '%')
  order by p.full_name limit 15
$$;
grant execute on function public.office_people(uuid, text) to authenticated;

-- Espacio usado por la persona (documentos de la Oficina + Mis archivos)
create or replace function public.office_usage()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'office', coalesce((select sum(octet_length(content::text)) from public.office_documents where owner_id = auth.uid() and deleted_at is null), 0),
    'files', coalesce((select sum(size_bytes) from public.user_files where owner_id = auth.uid() and deleted_at is null), 0))
$$;
grant execute on function public.office_usage() to authenticated;

-- Quién más tiene el documento abierto (latido de los últimos 45 segundos)
create or replace function public.office_present(p_doc uuid)
returns table (full_name text) language sql stable security definer set search_path = '' as $$
  select p.full_name from public.office_marks m join public.profiles p on p.id = m.user_id
  where m.document_id = p_doc and m.user_id <> auth.uid() and m.opened_at > now() - interval '45 seconds'
    and private.office_access(p_doc) is not null
  order by p.full_name limit 20
$$;
grant execute on function public.office_present(uuid) to authenticated;

-- Intento de abrir un documento sin permiso (p. ej. de otra institución): queda registrado para seguridad
create or replace function public.office_log_denied(p_doc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null or private.office_access(p_doc) is not null then return; end if;
  select organization_id into v_org from public.office_documents where id = p_doc;
  if v_org is null then return; end if;
  -- como máximo un registro por persona y documento cada 10 minutos
  if exists (select 1 from public.system_events e where e.event_type = 'office_access_denied' and e.user_id = auth.uid()
              and e.details ->> 'document_id' = p_doc::text and e.occurred_at > now() - interval '10 minutes') then return; end if;
  insert into public.system_events (organization_id, user_id, event_type, severity, details)
  values (v_org, auth.uid(), 'office_access_denied', 'warning', jsonb_build_object('document_id', p_doc));
end $$;
grant execute on function public.office_log_denied(uuid) to authenticated;
