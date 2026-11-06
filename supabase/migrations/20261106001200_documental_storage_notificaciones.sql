-- =====================================================================
-- Migración 012 · Gestión documental, Storage privado y notificaciones
-- RF-048 · §5 de ciberseguridad (versionado de documentos)
-- =====================================================================

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  campus_id       uuid,
  title           text not null,
  category        text not null,
  owner_type      text not null check (owner_type in ('organization','student','teacher','employee','enrollment')),
  owner_id        uuid,
  confidentiality text not null default 'internal' check (confidentiality in ('internal','restricted')),
  current_version integer not null default 0,
  retention_until date,
  status          public.record_status not null default 'active',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check ((owner_type = 'organization') = (owner_id is null)),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

create table public.document_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id     uuid not null,
  version_no      integer not null check (version_no >= 1),
  storage_bucket  text not null default 'institutional-documents',
  storage_path    text not null,
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint not null check (size_bytes between 1 and 52428800),
  mime_type       text not null,
  change_note     text,
  uploaded_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (document_id, version_no),
  check (split_part(storage_path, '/', 1) = organization_id::text),
  foreign key (organization_id, document_id) references public.documents(organization_id, id)
);

create table public.document_permissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id     uuid not null,
  grantee_user_id uuid references public.profiles(id),
  grantee_role_id uuid references public.roles(id),
  can_edit        boolean not null default false,
  granted_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(grantee_user_id, grantee_role_id) = 1),
  foreign key (organization_id, document_id) references public.documents(organization_id, id) on delete cascade
);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  user_id         uuid not null references public.profiles(id),
  channel         text not null default 'in_app' check (channel in ('in_app','email','push','sms')),
  category        text not null,
  title           text not null,
  body            text not null,
  data            jsonb not null default '{}'::jsonb,
  scheduled_for   timestamptz not null default now(),
  sent_at         timestamptz,
  read_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index on public.notifications (user_id, read_at, scheduled_for desc);
create index on public.notifications (sent_at) where sent_at is null;

create trigger trg_documents_updated before update on public.documents for each row execute function private.set_updated_at();
create trigger audit_documents    after insert or update or delete on public.documents for each row execute function private.audit_row();
create trigger audit_doc_versions after insert or update or delete on public.document_versions for each row execute function private.audit_row();
create trigger audit_doc_perms    after insert or update or delete on public.document_permissions for each row execute function private.audit_row();
create trigger trg_doc_versions_immutable before update or delete on public.document_versions
  for each row execute function private.block_audit_mutation();

create or replace function private.can_access_document(p_doc uuid, p_edit boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_doc and private.current_user_active() and (
      -- permiso por rol institucional
      (case when p_edit then private.has_permission(d.organization_id, 'documents.edit', d.campus_id)
            when d.confidentiality = 'restricted' then private.has_permission(d.organization_id, 'documents.approve', d.campus_id)
            else private.has_permission(d.organization_id, 'documents.view', d.campus_id) end)
      -- permiso explícito sobre el documento
      or exists (select 1 from public.document_permissions dp
                  where dp.document_id = d.id and (dp.can_edit or not p_edit)
                    and (dp.grantee_user_id = auth.uid()
                         or exists (select 1 from public.memberships m
                                     where m.user_id = auth.uid() and m.role_id = dp.grantee_role_id
                                       and m.organization_id = d.organization_id and m.status = 'active')))
      -- el estudiante ve sus propios documentos
      or (not p_edit and d.owner_type = 'student' and d.owner_id in (select private.my_student_ids()))
    ))
$$;

-- Nueva versión: nunca sobrescribe; incrementa current_version en la misma transacción
create or replace function public.add_document_version(
  p_document uuid, p_storage_path text, p_sha256 text, p_size bigint, p_mime text, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare d public.documents; v_no integer;
begin
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'Documento inexistente' using errcode = 'P0002'; end if;
  if not private.can_access_document(p_document, true) then raise exception 'No autorizado' using errcode = '42501'; end if;
  v_no := d.current_version + 1;
  insert into public.document_versions (organization_id, document_id, version_no, storage_path, sha256, size_bytes,
                                        mime_type, change_note, uploaded_by)
  values (d.organization_id, d.id, v_no, p_storage_path, p_sha256, p_size, p_mime, p_note, auth.uid());
  update public.documents set current_version = v_no where id = d.id;
  return v_no;
end $$;

alter table public.documents            enable row level security;
alter table public.document_versions    enable row level security;
alter table public.document_permissions enable row level security;
alter table public.notifications        enable row level security;

create policy doc_read on public.documents for select to authenticated using (private.can_access_document(id, false));
create policy doc_ins  on public.documents for insert to authenticated
  with check (private.has_permission(organization_id, 'documents.create', campus_id) and current_version = 0);
create policy doc_upd  on public.documents for update to authenticated
  using (private.can_access_document(id, true)) with check (private.has_permission(organization_id, 'documents.edit', campus_id));
create policy docv_read on public.document_versions for select to authenticated using (private.can_access_document(document_id, false));
create policy docp_read on public.document_permissions for select to authenticated
  using (private.has_permission(organization_id, 'documents.admin') or grantee_user_id = (select auth.uid()));
create policy docp_write on public.document_permissions for insert to authenticated
  with check (private.has_permission(organization_id, 'documents.admin'));
create policy docp_del on public.document_permissions for delete to authenticated
  using (private.has_permission(organization_id, 'documents.admin'));

create policy notif_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notif_mark on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Storage privado (Supabase Storage). Ruta obligatoria: <organization_id>/...
-- El acceso a cada objeto se decide con los mismos permisos que su registro.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('enrollment-documents',    'enrollment-documents',    false, 20971520,   array['application/pdf','image/jpeg','image/png']),
  ('institutional-documents', 'institutional-documents', false, 52428800,   null),
  ('class-materials',         'class-materials',         false, 104857600,  null),
  ('certificates',            'certificates',            false, 10485760,   array['application/pdf']),
  ('conference-recordings',   'conference-recordings',   false, 5368709120, array['video/mp4','audio/ogg','application/x-mpegURL'])
on conflict (id) do nothing;

create or replace function private.storage_can_read(p_bucket text, p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  begin v_org := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  return case p_bucket
    when 'enrollment-documents' then exists (
      select 1 from public.enrollment_documents d where d.storage_path = p_name and d.organization_id = v_org
        and (private.has_permission(v_org, 'admissions.view') or private.has_permission(v_org, 'enrollments.view')
             or d.uploaded_by = auth.uid()))
    when 'institutional-documents' then exists (
      select 1 from public.document_versions v where v.storage_path = p_name and v.organization_id = v_org
        and private.can_access_document(v.document_id, false))
    when 'class-materials' then exists (
      select 1 from public.class_materials m where m.storage_path = p_name and m.organization_id = v_org
        and (private.teaches_section(m.section_id) or private.has_permission(v_org, 'sections.view')
             or (m.published and private.enrolled_in_section(m.section_id))))
    when 'certificates' then exists (
      select 1 from public.certificates c where c.pdf_storage_path = p_name and c.organization_id = v_org
        and (private.has_permission(v_org, 'certificates.view') or c.student_id in (select private.my_student_ids())
             or c.recipient_user_id = auth.uid()))
    when 'conference-recordings' then exists (
      select 1 from public.conference_recordings r where r.storage_path = p_name and r.organization_id = v_org
        and r.status = 'available'
        and (private.can_moderate(r.session_id)
             or (r.visibility = 'participants' and private.conference_role_of(r.session_id) is not null)))
    else false end;
end $$;

-- Subidas: solo dentro de la carpeta de una institución donde se tiene permiso.
-- Los postulantes suben en <org>/applications/<application_id>/ de su postulación.
create or replace function private.storage_can_write(p_bucket text, p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_parts text[] := string_to_array(p_name, '/');
begin
  begin v_org := v_parts[1]::uuid; exception when others then return false; end;
  return case p_bucket
    when 'enrollment-documents' then
      private.has_permission(v_org, 'admissions.create')
      or (v_parts[2] = 'applications' and exists (
            select 1 from public.applications a where a.id::text = v_parts[3] and a.organization_id = v_org
              and a.applicant_user_id = auth.uid() and a.status in ('draft','submitted')))
    when 'institutional-documents' then private.has_permission(v_org, 'documents.create')
    when 'class-materials' then private.has_permission(v_org, 'sections.edit')
      or (v_parts[2] = 'sections' and private.teaches_section(nullif(v_parts[3], '')::uuid))
    when 'certificates' then private.has_permission(v_org, 'certificates.create')
    else false end;    -- las grabaciones solo las escribe el backend (service_role)
end $$;

do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute 'drop policy if exists sematec_read on storage.objects';
    execute 'drop policy if exists sematec_insert on storage.objects';
    execute $p$create policy sematec_read on storage.objects for select to authenticated
             using (bucket_id in ('enrollment-documents','institutional-documents','class-materials','certificates','conference-recordings')
                    and private.storage_can_read(bucket_id, name))$p$;
    execute $p$create policy sematec_insert on storage.objects for insert to authenticated
             with check (bucket_id in ('enrollment-documents','institutional-documents','class-materials','certificates')
                         and private.storage_can_write(bucket_id, name))$p$;
    -- Sin políticas de UPDATE/DELETE: los archivos no se reemplazan ni se borran desde el cliente.
  end if;
end $$;
