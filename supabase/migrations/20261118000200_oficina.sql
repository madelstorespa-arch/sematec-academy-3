-- =====================================================================
-- SEMATEC Oficina: documentos, hojas de cálculo, presentaciones y publicaciones
-- creados y editados dentro de la plataforma (compatibles con Word, Excel y PowerPoint).
-- =====================================================================

create table if not exists public.office_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id        uuid not null default auth.uid() references public.profiles(id),
  kind            text not null check (kind in ('doc','sheet','slides','pub')),
  title           text not null default 'Sin título' check (length(trim(title)) between 1 and 200),
  content         jsonb not null default '{}'::jsonb check (octet_length(content::text) < 25000000),
  shared          text not null default 'private' check (shared in ('private','org_view','org_edit')),
  updated_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists office_documents_owner_idx on public.office_documents (owner_id, updated_at desc) where deleted_at is null;
create index if not exists office_documents_org_idx on public.office_documents (organization_id, updated_at desc) where deleted_at is null and shared <> 'private';
drop trigger if exists trg_office_documents_updated on public.office_documents;
create trigger trg_office_documents_updated before update on public.office_documents for each row execute function private.set_updated_at();

alter table public.office_documents enable row level security;
drop policy if exists office_read on public.office_documents;
create policy office_read on public.office_documents for select to authenticated
  using (owner_id = auth.uid() or (shared <> 'private' and deleted_at is null and private.is_member(organization_id)));
drop policy if exists office_insert on public.office_documents;
create policy office_insert on public.office_documents for insert to authenticated
  with check (owner_id = auth.uid() and private.is_member(organization_id));
drop policy if exists office_update on public.office_documents;
create policy office_update on public.office_documents for update to authenticated
  using (owner_id = auth.uid() or (shared = 'org_edit' and deleted_at is null and private.is_member(organization_id)))
  with check (private.is_member(organization_id));
drop policy if exists office_delete on public.office_documents;
create policy office_delete on public.office_documents for delete to authenticated using (owner_id = auth.uid());
grant select, insert, update, delete on public.office_documents to authenticated;
grant all on public.office_documents to service_role;

-- Solo el dueño cambia con quién se comparte o envía a la papelera
create or replace function private.office_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id or new.organization_id <> old.organization_id then
    raise exception 'No se puede cambiar el dueño del documento' using errcode = '42501';
  end if;
  if (new.shared is distinct from old.shared or new.deleted_at is distinct from old.deleted_at) and old.owner_id <> auth.uid() then
    raise exception 'Solo el dueño puede compartir o eliminar el documento' using errcode = '42501';
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_office_guard on public.office_documents;
create trigger trg_office_guard before update on public.office_documents for each row execute function private.office_guard();
