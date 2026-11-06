-- =====================================================================
-- Migración 011 · Sistema 51: SEMATEC GLOBAL CONFERENCE
-- RF-057 a RF-064 · VID-001 a VID-016
-- La base de datos guarda salas, sesiones, permisos, participación y
-- grabaciones. El audio/video lo procesa LiveKit; el token firmado lo
-- emite una Edge Function SOLO si authorize_conference_join() lo permite.
-- =====================================================================

create table public.conference_rooms (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  campus_id        uuid,
  section_id       uuid,                                  -- sala de clases de una sección (RF-064)
  name             text not null,
  room_type        public.conference_type not null default 'class',
  max_participants integer not null default 150 check (max_participants between 2 and 1000),
  status           public.record_status not null default 'active',
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, campus_id)  references public.campuses(organization_id, id),
  foreign key (organization_id, section_id) references public.sections(organization_id, id)
);

create table public.conference_sessions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  room_id            uuid not null,
  title              text not null,
  session_type       public.conference_type not null,
  scheduled_start    timestamptz not null,
  scheduled_end      timestamptz not null,
  timezone           text not null,                         -- VID-003
  livekit_room_name  text not null unique,
  status             public.conference_status not null default 'scheduled',
  recording_enabled  boolean not null default false,
  min_attendance_pct numeric(5,2) not null default 75 check (min_attendance_pct between 0 and 100),
  class_session_id   uuid,
  actual_start       timestamptz,
  actual_end         timestamptz,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  unique (organization_id, id),
  check (scheduled_end > scheduled_start),
  check (scheduled_end - scheduled_start <= interval '12 hours'),
  foreign key (organization_id, room_id)          references public.conference_rooms(organization_id, id),
  foreign key (organization_id, class_session_id) references public.class_sessions(organization_id, id)
);
create index on public.conference_sessions (organization_id, scheduled_start);

create table public.conference_participants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id      uuid not null,
  user_id         uuid not null references public.profiles(id),
  role            public.conference_role not null default 'attendee',
  banned          boolean not null default false,
  banned_reason   text,
  banned_by       uuid references public.profiles(id),
  connected_seconds integer not null default 0,
  attended        boolean not null default false,
  added_by        uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (session_id, user_id),
  check (not banned or banned_reason is not null),
  foreign key (organization_id, session_id) references public.conference_sessions(organization_id, id)
);

-- VID-008: entradas y salidas (alimentado por el webhook de LiveKit)
create table public.conference_attendance (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id      uuid not null,
  user_id         uuid not null references public.profiles(id),
  participant_sid text not null,
  joined_at       timestamptz not null,
  left_at         timestamptz,
  unique (session_id, participant_sid),
  check (left_at is null or left_at >= joined_at),
  foreign key (organization_id, session_id) references public.conference_sessions(organization_id, id)
);
create index on public.conference_attendance (session_id, user_id);

-- VID-004: registro de cada autorización de token emitida
create table public.conference_access_grants (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  session_id      uuid not null,
  user_id         uuid not null,
  role            public.conference_role not null,
  grants          jsonb not null,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  foreign key (organization_id, session_id) references public.conference_sessions(organization_id, id)
);

-- VID-010/011: grabaciones privadas
create table public.conference_recordings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  session_id      uuid not null,
  egress_id       text unique,
  storage_bucket  text not null default 'conference-recordings',
  storage_path    text,
  status          text not null default 'recording' check (status in ('recording','processing','available','failed','deleted')),
  visibility      text not null default 'participants' check (visibility in ('participants','staff')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  size_bytes      bigint,
  created_at      timestamptz not null default now(),
  check (storage_path is null or split_part(storage_path, '/', 1) = organization_id::text),
  foreign key (organization_id, session_id) references public.conference_sessions(organization_id, id)
);

alter table public.class_sessions add constraint class_sessions_conference_fk
  foreign key (organization_id, conference_session_id) references public.conference_sessions(organization_id, id);
alter table public.certificates add constraint certificates_conference_fk
  foreign key (organization_id, conference_session_id) references public.conference_sessions(organization_id, id);

create trigger audit_conf_rooms    after insert or update or delete on public.conference_rooms    for each row execute function private.audit_row();
create trigger audit_conf_sessions after insert or update or delete on public.conference_sessions for each row execute function private.audit_row();
create trigger audit_conf_parts    after insert or update or delete on public.conference_participants for each row execute function private.audit_row();
create trigger audit_conf_recs     after insert or update or delete on public.conference_recordings for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Autorización
-- ---------------------------------------------------------------------
create or replace function private.conference_role_of(p_session uuid)
returns public.conference_role language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select cp.role from public.conference_participants cp
      where cp.session_id = p_session and cp.user_id = auth.uid() and not cp.banned),
    (select case when private.teaches_section(r.section_id) then 'teacher'
                 when private.enrolled_in_section(r.section_id) then 'student' end::public.conference_role
       from public.conference_sessions s join public.conference_rooms r on r.id = s.room_id
      where s.id = p_session and r.section_id is not null
        and not exists (select 1 from public.conference_participants b
                         where b.session_id = s.id and b.user_id = auth.uid() and b.banned)))
$$;

create or replace function private.can_moderate(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.conference_role_of(p_session) in ('organizer','moderator','teacher')
      or exists (select 1 from public.conference_sessions s where s.id = p_session
                   and private.has_permission(s.organization_id, 'conferences.edit'))
$$;

-- VID-001/003: crear sesión (personal autorizado o profesor de la sección)
create or replace function public.create_conference_session(
  p_room uuid, p_title text, p_type public.conference_type, p_start timestamptz, p_end timestamptz,
  p_timezone text, p_recording boolean default false, p_class_session uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.conference_rooms; v_id uuid := gen_random_uuid(); v_min jsonb;
begin
  select * into r from public.conference_rooms where id = p_room and status = 'active';
  if not found then raise exception 'Sala inexistente' using errcode = 'P0002'; end if;
  if not (private.has_permission(r.organization_id, 'conferences.create', r.campus_id)
          or (r.section_id is not null and private.teaches_section(r.section_id))) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Zona horaria inválida: %', p_timezone using errcode = '22023';
  end if;
  v_min := private.org_setting(r.organization_id, 'conferences.min_attendance_pct', '75'::jsonb);
  insert into public.conference_sessions (id, organization_id, room_id, title, session_type, scheduled_start, scheduled_end,
      timezone, livekit_room_name, recording_enabled, min_attendance_pct, class_session_id, created_by)
  values (v_id, r.organization_id, r.id, p_title, p_type, p_start, p_end, p_timezone,
      'sg_' || replace(r.organization_id::text, '-', '') || '_' || replace(v_id::text, '-', ''),
      p_recording, v_min::text::numeric, p_class_session, auth.uid());
  insert into public.conference_participants (organization_id, session_id, user_id, role, added_by)
  values (r.organization_id, v_id, auth.uid(), 'organizer', auth.uid());
  return v_id;
end $$;

-- VID-002/015: agregar participante (solo usuarios de la misma institución)
create or replace function public.add_conference_participant(p_session uuid, p_user uuid, p_role public.conference_role)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions;
begin
  select * into s from public.conference_sessions where id = p_session;
  if not found then raise exception 'Sesión inexistente' using errcode = 'P0002'; end if;
  if not private.can_moderate(p_session) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_role = 'organizer' and private.conference_role_of(p_session) is distinct from 'organizer'
     and not private.has_permission(s.organization_id, 'conferences.admin') then
    raise exception 'Solo un organizador puede designar organizadores' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m where m.user_id = p_user and m.organization_id = s.organization_id
                   and m.status = 'active' and (m.valid_until is null or m.valid_until > now())) then
    raise exception 'El usuario no pertenece a la institución' using errcode = '42501';
  end if;
  insert into public.conference_participants (organization_id, session_id, user_id, role, added_by)
  values (s.organization_id, p_session, p_user, p_role, auth.uid())
  on conflict (session_id, user_id) do update set role = excluded.role
   where not public.conference_participants.banned;
end $$;

-- VID-013: expulsar y bloquear
create or replace function public.ban_conference_participant(p_session uuid, p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions;
begin
  select * into s from public.conference_sessions where id = p_session;
  if not found then raise exception 'Sesión inexistente' using errcode = 'P0002'; end if;
  if not private.can_moderate(p_session) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'No puede bloquearse a sí mismo' using errcode = '22023'; end if;
  insert into public.conference_participants (organization_id, session_id, user_id, role, banned, banned_reason, banned_by, added_by)
  values (s.organization_id, p_session, p_user, 'attendee', true, p_reason, auth.uid(), auth.uid())
  on conflict (session_id, user_id) do update set banned = true, banned_reason = p_reason, banned_by = auth.uid();
end $$;

-- VID-004/005/007/015: decide si se emite un token y con qué permisos.
-- La Edge Function la llama con el JWT del usuario y, si allowed = true,
-- firma el token LiveKit con exactamente estos grants y expires_at.
create or replace function public.authorize_conference_join(p_session uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.conference_sessions; r public.conference_rooms; v_role public.conference_role;
  v_connected int; v_grants jsonb; v_exp timestamptz; v_admin boolean; v_publish boolean;
begin
  if not private.current_user_active() then
    return jsonb_build_object('allowed', false, 'reason', 'account_inactive');
  end if;
  select * into s from public.conference_sessions where id = p_session;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_found'); end if;
  select * into r from public.conference_rooms where id = s.room_id;
  if not private.is_member(s.organization_id) then
    return jsonb_build_object('allowed', false, 'reason', 'not_member');
  end if;
  if exists (select 1 from public.conference_participants b where b.session_id = s.id and b.user_id = auth.uid() and b.banned) then
    return jsonb_build_object('allowed', false, 'reason', 'banned');
  end if;
  v_role := private.conference_role_of(p_session);
  if v_role is null then return jsonb_build_object('allowed', false, 'reason', 'not_invited'); end if;
  if s.status in ('ended','cancelled') then return jsonb_build_object('allowed', false, 'reason', 'session_' || s.status); end if;
  if now() < s.scheduled_start - interval '15 minutes' and v_role not in ('organizer','moderator','teacher') then
    return jsonb_build_object('allowed', false, 'reason', 'too_early');
  end if;
  if now() > s.scheduled_end + interval '60 minutes' then return jsonb_build_object('allowed', false, 'reason', 'expired'); end if;
  select count(distinct user_id) into v_connected from public.conference_attendance
   where session_id = s.id and left_at is null and user_id <> auth.uid();
  if v_connected >= r.max_participants then return jsonb_build_object('allowed', false, 'reason', 'room_full'); end if;

  -- Si no estaba registrado (alumno de la sección), queda inscrito como participante
  insert into public.conference_participants (organization_id, session_id, user_id, role)
  values (s.organization_id, s.id, auth.uid(), v_role) on conflict (session_id, user_id) do nothing;

  v_admin := v_role in ('organizer','moderator','teacher');
  v_publish := v_admin or v_role = 'presenter' or s.session_type in ('class','meeting','tutoring');
  v_grants := jsonb_build_object(
    'room', s.livekit_room_name, 'roomJoin', true, 'roomAdmin', v_admin, 'roomRecord', v_admin and s.recording_enabled,
    'canSubscribe', true, 'canPublish', v_publish, 'canPublishData', true,
    'canPublishSources', case when v_publish then
        (case when v_admin or v_role = 'presenter' then '["camera","microphone","screen_share","screen_share_audio"]'
              else '["camera","microphone"]' end)::jsonb else '[]'::jsonb end);
  v_exp := least(s.scheduled_end + interval '60 minutes', now() + interval '2 hours');
  insert into public.conference_access_grants (organization_id, session_id, user_id, role, grants, expires_at)
  values (s.organization_id, s.id, auth.uid(), v_role, v_grants, v_exp);
  return jsonb_build_object('allowed', true, 'identity', auth.uid(), 'role', v_role, 'grants', v_grants,
                            'expires_at', v_exp, 'max_participants', r.max_participants);
end $$;

-- VID-008/016: eventos del webhook de LiveKit (solo service_role), idempotentes
create or replace function public.record_conference_event(
  p_room_name text, p_event text, p_user uuid, p_participant_sid text, p_at timestamptz, p_event_id text, p_payload jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions;
begin
  if not private.is_service() then raise exception 'Solo el backend puede registrar eventos' using errcode = '42501'; end if;
  select * into s from public.conference_sessions where livekit_room_name = p_room_name;
  if not found then raise exception 'Sala desconocida' using errcode = 'P0002'; end if;
  insert into public.integration_events (organization_id, provider, event_type, idempotency_key, payload, processed_at)
  values (s.organization_id, 'livekit', p_event, p_event_id, p_payload, now())
  on conflict (provider, idempotency_key) do nothing;
  if not found then return; end if;            -- evento repetido: ya procesado
  case p_event
    when 'room_started' then
      update public.conference_sessions set status = 'live', actual_start = coalesce(actual_start, p_at) where id = s.id;
    when 'participant_joined' then
      insert into public.conference_attendance (organization_id, session_id, user_id, participant_sid, joined_at)
      values (s.organization_id, s.id, p_user, p_participant_sid, p_at)
      on conflict (session_id, participant_sid) do nothing;
    when 'participant_left' then
      update public.conference_attendance set left_at = p_at
       where session_id = s.id and participant_sid = p_participant_sid and left_at is null;
    when 'room_finished' then
      perform private.finalize_conference(s.id, p_at);
    else
      insert into public.system_events (organization_id, event_type, severity, details)
      values (s.organization_id, 'conference_' || p_event, 'info', p_payload);
  end case;
end $$;

-- VID-009 / RF-064: cálculo de asistencia y traspaso al libro de clases
create or replace function private.finalize_conference(p_session uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions; v_total numeric;
begin
  select * into s from public.conference_sessions where id = p_session for update;
  update public.conference_attendance set left_at = p_at where session_id = p_session and left_at is null;
  update public.conference_sessions set status = 'ended', actual_end = p_at where id = p_session;
  v_total := extract(epoch from (s.scheduled_end - s.scheduled_start));
  -- Quien se conectó sin registro previo (p. ej. alumno de la sección) queda como participante
  insert into public.conference_participants (organization_id, session_id, user_id, role)
  select distinct s.organization_id, p_session, a.user_id,
         case when exists (select 1 from public.conference_rooms r
                             join public.section_enrollments se on se.section_id = r.section_id and se.status <> 'dropped'
                             join public.students st on st.id = se.student_id
                            where r.id = s.room_id and st.user_id = a.user_id)
              then 'student' else 'attendee' end::public.conference_role
    from public.conference_attendance a where a.session_id = p_session
  on conflict (session_id, user_id) do nothing;
  -- Segundos efectivos por usuario (uniendo intervalos solapados de reconexiones)
  with iv as (
    select user_id, greatest(joined_at, s.scheduled_start) as a, least(left_at, s.scheduled_end) as b
      from public.conference_attendance where session_id = p_session
  ), clipped as (select * from iv where b > a),
  merged as (
    select user_id, range_agg(tstzrange(a, b)) as r from clipped group by user_id
  ), secs as (
    select user_id, sum(extract(epoch from upper(x) - lower(x)))::int as sec
      from merged, unnest(r) x group by user_id
  )
  update public.conference_participants cp
     set connected_seconds = coalesce((select x.sec from secs x where x.user_id = cp.user_id), 0),
         attended = coalesce((select x.sec from secs x where x.user_id = cp.user_id), 0) >= v_total * s.min_attendance_pct / 100
   where cp.session_id = p_session;
  -- Clase virtual vinculada: registra asistencia de los alumnos inscritos
  if s.class_session_id is not null then
    insert into public.attendance_records (organization_id, class_session_id, student_id, status, notes)
    select s.organization_id, s.class_session_id, st.id,
           case when cp.attended then 'present' else 'absent' end::public.attendance_status,
           'Registrado automáticamente desde SEMATEC GLOBAL CONFERENCE'
      from public.class_sessions cs
      join public.section_enrollments se on se.section_id = cs.section_id and se.status = 'enrolled'
      join public.students st on st.id = se.student_id
      left join public.conference_participants cp on cp.session_id = p_session and cp.user_id = st.user_id
     where cs.id = s.class_session_id
    on conflict (class_session_id, student_id) do nothing;
  end if;
end $$;

-- Cierre manual por el organizador
create or replace function public.end_conference_session(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_moderate(p_session) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if (select status from public.conference_sessions where id = p_session) in ('ended','cancelled') then
    raise exception 'La sesión ya terminó' using errcode = '22023';
  end if;
  perform private.finalize_conference(p_session, now());
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.conference_rooms         enable row level security;
alter table public.conference_sessions      enable row level security;
alter table public.conference_participants  enable row level security;
alter table public.conference_attendance    enable row level security;
alter table public.conference_access_grants enable row level security;
alter table public.conference_recordings    enable row level security;

create policy croom_read on public.conference_rooms for select to authenticated
  using (private.has_permission(organization_id, 'conferences.view')
         or (section_id is not null and (private.teaches_section(section_id) or private.enrolled_in_section(section_id))));
create policy croom_ins on public.conference_rooms for insert to authenticated
  with check (private.has_permission(organization_id, 'conferences.create', campus_id)
              or (section_id is not null and private.teaches_section(section_id)));
create policy croom_upd on public.conference_rooms for update to authenticated
  using (private.has_permission(organization_id, 'conferences.edit', campus_id))
  with check (private.has_permission(organization_id, 'conferences.edit', campus_id));

create policy csess_read on public.conference_sessions for select to authenticated
  using (private.has_permission(organization_id, 'conferences.view') or private.conference_role_of(id) is not null);
create policy csess_upd on public.conference_sessions for update to authenticated
  using (private.can_moderate(id) and status in ('scheduled','live'))
  with check (private.can_moderate(id));

create policy cpart_read on public.conference_participants for select to authenticated
  using (user_id = (select auth.uid()) or private.can_moderate(session_id)
         or private.has_permission(organization_id, 'conferences.view'));
create policy catt_read on public.conference_attendance for select to authenticated
  using (user_id = (select auth.uid()) or private.can_moderate(session_id)
         or private.has_permission(organization_id, 'conferences.view'));
create policy cgrant_read on public.conference_access_grants for select to authenticated
  using (private.has_permission(organization_id, 'audit.view'));
create policy crec_read on public.conference_recordings for select to authenticated
  using (status = 'available' and (
           private.can_moderate(session_id)
           or (visibility = 'participants' and private.conference_role_of(session_id) is not null)));
