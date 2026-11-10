-- =====================================================================
-- Aula pro: configuración de la sala por el anfitrión (se aplica en el
-- servidor de video, no solo en la pantalla) e informe de asistencia.
-- =====================================================================

alter table public.conference_sessions add column if not exists room_policy jsonb not null default '{}'::jsonb
  check (jsonb_typeof(room_policy) = 'object');

/**
 * Guarda la configuración de la sala. Claves (sí/no): mic, camera, share, chat, private_chat, reactions, rename.
 * Solo el anfitrión o un moderador. «share» también actualiza la opción «los estudiantes pueden compartir pantalla».
 */
create or replace function public.conference_set_policy(p_session uuid, p_policy jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb := '{}'::jsonb;
begin
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión puede configurar la sala' using errcode = '42501'; end if;
  if jsonb_typeof(p_policy) <> 'object' then raise exception 'Configuración inválida' using errcode = '22023'; end if;
  foreach k in array array['mic','camera','share','chat','private_chat','reactions','rename'] loop
    if p_policy ? k then
      if jsonb_typeof(p_policy -> k) <> 'boolean' then raise exception 'Valor inválido en %', k using errcode = '22023'; end if;
      v := v || jsonb_build_object(k, p_policy -> k);
    end if;
  end loop;
  update public.conference_sessions set room_policy = room_policy || v,
         students_can_share = coalesce((v ->> 'share')::boolean, students_can_share)
   where id = p_session;
  return (select room_policy from public.conference_sessions where id = p_session);
end $$;
grant execute on function public.conference_set_policy(uuid, jsonb) to authenticated;

/** 📋 Asistencia de la sesión: quién entró, cuándo, cuánto tiempo (solo anfitrión o moderador). */
create or replace function public.conference_attendance_report(p_session uuid)
returns table (user_id uuid, full_name text, email text, first_join timestamptz, last_leave timestamptz, minutes numeric, connections bigint, online boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión puede ver la asistencia' using errcode = '42501'; end if;
  return query
  select a.user_id, p.full_name, p.email, min(a.joined_at), max(a.left_at),
         round(sum(extract(epoch from (coalesce(a.left_at, now()) - a.joined_at))) / 60, 1),
         count(*), bool_or(a.left_at is null)
    from public.conference_attendance a join public.profiles p on p.id = a.user_id
   where a.session_id = p_session
   group by a.user_id, p.full_name, p.email
   order by p.full_name;
end $$;
grant execute on function public.conference_attendance_report(uuid) to authenticated;
