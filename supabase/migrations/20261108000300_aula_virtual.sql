-- =====================================================================
-- Aula virtual tipo Zoom / Collaborate: opciones de la sesión, moderación
-- y grabaciones guardadas en almacenamiento privado (Supabase Storage).
-- =====================================================================

alter table public.conference_sessions
  add column if not exists students_can_share boolean not null default false,
  add column if not exists chat_enabled boolean not null default true,
  add column if not exists waiting_message text check (length(waiting_message) <= 500);

-- ¿El usuario actual modera esta sesión? (organizador, moderador, profesor o permiso de conferencias)
create or replace function public.conference_is_moderator(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conference_participants p
                 where p.session_id = p_session and p.user_id = auth.uid() and not p.banned
                   and p.role in ('organizer','moderator','teacher'))
      or exists (select 1 from public.conference_sessions s
                 where s.id = p_session and private.has_permission(s.organization_id, 'conferences.edit'))
$$;
revoke all on function public.conference_is_moderator(uuid) from public, anon;
grant execute on function public.conference_is_moderator(uuid) to authenticated;

-- ¿Puede ver las grabaciones? participantes de la sesión (no bloqueados), alumnos de la sección o personal
create or replace function private.can_view_session(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.conference_role_of(p_session) is not null
      or exists (select 1 from public.conference_sessions s join public.conference_rooms r on r.id = s.room_id
                 where s.id = p_session and r.section_id is not null and private.enrolled_in_section(r.section_id))
      or exists (select 1 from public.conference_sessions s where s.id = p_session and private.has_permission(s.organization_id, 'conferences.view'))
$$;
grant execute on function private.can_view_session(uuid) to authenticated;

-- La tabla de grabaciones ya existe (diseñada para grabación en servidor); se completa para
-- grabaciones hechas desde el navegador del anfitrión y subidas al almacenamiento privado.
alter table public.conference_recordings
  add column if not exists filename text,
  add column if not exists mime_type text not null default 'video/webm',
  add column if not exists duration_sec int,
  add column if not exists created_by uuid references public.profiles(id);
drop policy if exists crec_read on public.conference_recordings;
create policy crec_read on public.conference_recordings for select to authenticated
  using (status = 'available' and private.can_view_session(session_id)
         and (visibility = 'participants' or public.conference_is_moderator(session_id)));
grant select on public.conference_recordings to authenticated;
grant all on public.conference_recordings to service_role;

-- Bucket privado existente: se aceptan además los videos WebM que graba el navegador
update storage.buckets set allowed_mime_types = array['video/mp4','video/webm','audio/webm','audio/ogg','application/x-mpegURL']
 where id = 'conference-recordings';

-- Opciones de la sesión que puede cambiar el anfitrión
create or replace function public.set_conference_options(p_session uuid, p_students_share boolean, p_chat boolean, p_recording boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión puede cambiar las opciones' using errcode = '42501'; end if;
  update public.conference_sessions set students_can_share = p_students_share, chat_enabled = p_chat, recording_enabled = p_recording
   where id = p_session and status in ('scheduled','live');
  if not found then raise exception 'La sesión ya terminó' using errcode = '22023'; end if;
end $$;
revoke all on function public.set_conference_options(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_conference_options(uuid, boolean, boolean, boolean) to authenticated;
