-- Búsqueda global, gastos y balance mensual por programa/sección, edición de matrículas
-- e invitados externos a las aulas virtuales (enlace para compartir).

-- ============ 1. Búsqueda global (respeta los permisos: SECURITY INVOKER + RLS) ============
create or replace function public.search_norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑÀÈÌÒÙáéíóúüñàèìòù', 'AEIOUUNAEIOUaeiouunaeiou'))
$$;
grant execute on function public.search_norm(text) to authenticated;

create or replace function public.global_search(p_org uuid, p_q text, p_limit int default 40)
returns table (kind text, id uuid, title text, subtitle text, href text, rank int)
language plpgsql stable security invoker set search_path = '' as $$
declare
  q text := public.search_norm(btrim(coalesce(p_q, '')));
  pat text; d text; n bigint;
begin
  if length(q) < 2 or p_org is null then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  d := regexp_replace(q, '[^0-9k]', '', 'g');            -- RUT o pasaporte sin puntos ni guion
  n := case when q ~ '^[0-9]{1,15}$' then q::bigint end;  -- número de boleta
  return query
  select * from (
    (select 'Estudiante'::text, s.id, (s.last_names || ', ' || s.first_names)::text,
            concat_ws(' · ', s.student_code, s.id_document_number, s.email)::text, ('/app/estudiantes/' || s.id)::text, 1
       from public.students s
      where s.organization_id = p_org and (
            public.search_norm(s.first_names || ' ' || s.last_names) like pat
         or public.search_norm(s.last_names || ' ' || s.first_names) like pat
         or public.search_norm(s.student_code) like pat or public.search_norm(s.email) like pat
         or (length(d) >= 4 and regexp_replace(lower(coalesce(s.id_document_number, '')), '[^0-9k]', '', 'g') like '%' || d || '%'))
      order by s.last_names limit 8)
    union all
    (select 'Profesor', t.id, (t.last_names || ', ' || t.first_names), concat_ws(' · ', t.teacher_code, t.specialty, t.email), '/app/profesores', 2
       from public.teachers t
      where t.organization_id = p_org and (public.search_norm(t.first_names || ' ' || t.last_names) like pat
         or public.search_norm(t.last_names || ' ' || t.first_names) like pat or public.search_norm(t.email) like pat or public.search_norm(t.teacher_code) like pat)
      order by t.last_names limit 5)
    union all
    (select 'Funcionario', e.id, (e.last_names || ', ' || e.first_names), concat_ws(' · ', e.employee_code, e.position, e.email), '/app/personal', 3
       from public.employees e
      where e.organization_id = p_org and (public.search_norm(e.first_names || ' ' || e.last_names) like pat
         or public.search_norm(e.last_names || ' ' || e.first_names) like pat or public.search_norm(e.position) like pat or public.search_norm(e.email) like pat)
      order by e.last_names limit 5)
    union all
    (select 'Programa', p.id, p.name, concat_ws(' · ', p.code, p.level, p.modality), '/app/academico/programas/' || p.id, 4
       from public.programs p
      where p.organization_id = p_org and (public.search_norm(p.name) like pat or public.search_norm(p.code) like pat)
      order by p.name limit 5)
    union all
    (select 'Asignatura', c.id, c.name, c.code, '/app/academico?t=cursos', 5
       from public.courses c
      where c.organization_id = p_org and (public.search_norm(c.name) like pat or public.search_norm(c.code) like pat)
      order by c.name limit 5)
    union all
    (select 'Sección', s.id, (c.name || ' · ' || s.code), concat_ws(' · ', s.modality, s.status::text), '/app/secciones/' || s.id, 6
       from public.sections s join public.courses c on c.id = s.course_id
      where s.organization_id = p_org and (public.search_norm(s.code) like pat or public.search_norm(c.name) like pat or public.search_norm(c.code) like pat)
      order by c.name limit 6)
    union all
    (select 'Matrícula', e.id, (st.last_names || ', ' || st.first_names), concat_ws(' · ', pr.name, ap.name, e.status::text), '/app/matriculas/' || e.id, 7
       from public.enrollments e join public.students st on st.id = e.student_id
       join public.programs pr on pr.id = e.program_id left join public.academic_periods ap on ap.id = e.period_id
      where e.organization_id = p_org and (public.search_norm(st.first_names || ' ' || st.last_names) like pat
         or public.search_norm(st.last_names || ' ' || st.first_names) like pat or public.search_norm(st.student_code) like pat
         or (length(d) >= 4 and regexp_replace(lower(coalesce(st.id_document_number, '')), '[^0-9k]', '', 'g') like '%' || d || '%'))
      order by e.enrolled_at desc limit 5)
    union all
    (select 'Boleta', p.id, ('Boleta N° ' || case when p.kind = 'refund' then 'R-' else '' end || p.receipt_number),
            concat_ws(' · ', st.last_names || ', ' || st.first_names, p.currency || ' ' || p.amount::text, to_char(p.paid_at, 'DD-MM-YYYY')), '/app/finanzas/boleta/' || p.id, 8
       from public.payments p join public.students st on st.id = p.student_id
      where p.organization_id = p_org and (p.receipt_number = n or public.search_norm(p.external_reference) like pat)
      limit 5)
    union all
    (select 'Gasto', x.id, x.description, concat_ws(' · ', x.supplier, x.currency || ' ' || x.amount::text, to_char(x.spent_on, 'DD-MM-YYYY')), '/app/finanzas/gastos', 9
       from public.expenses x
      where x.organization_id = p_org and (public.search_norm(x.description) like pat or public.search_norm(x.supplier) like pat or public.search_norm(x.document_number) like pat)
      order by x.spent_on desc limit 5)
    union all
    (select 'Clase o reunión', cs.id, cs.title, to_char(cs.scheduled_start at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI'), '/app/conferencias/' || cs.id, 10
       from public.conference_sessions cs
      where cs.organization_id = p_org and public.search_norm(cs.title) like pat
      order by cs.scheduled_start desc limit 5)
    union all
    (select 'Biblioteca', l.id, l.title, concat_ws(' · ', l.author, l.category), '/app/biblioteca', 11
       from public.library_items l
      where l.organization_id = p_org and (public.search_norm(l.title) like pat or public.search_norm(l.author) like pat or public.search_norm(l.isbn) like pat)
      order by l.title limit 5)
    union all
    (select 'Archivo', f.id, f.name, coalesce(f.description, ''), '/app/archivos/ver/' || f.id, 12
       from public.user_files f
      where f.organization_id = p_org and f.deleted_at is null and (public.search_norm(f.name) like pat or public.search_norm(f.description) like pat)
      order by f.created_at desc limit 5)
    union all
    (select 'Certificado', c.id, c.title, concat_ws(' · ', c.recipient_name, 'N° ' || c.serial_number), '/app/certificados/' || c.id, 13
       from public.certificates c
      where c.organization_id = p_org and (public.search_norm(c.recipient_name) like pat or public.search_norm(c.title) like pat or c.serial_number::text = q)
      order by c.issued_at desc limit 5)
    union all
    (select 'Anuncio', a.id, a.title, '', '/app/anuncios', 14
       from public.announcements a
      where a.organization_id = p_org and public.search_norm(a.title) like pat
      order by a.created_at desc limit 3)
    union all
    (select 'Soporte', t.id, t.subject, t.status::text, '/app/soporte/' || t.id, 15
       from public.support_tickets t
      where t.organization_id = p_org and public.search_norm(t.subject) like pat
      order by t.created_at desc limit 3)
  ) r(kind, id, title, subtitle, href, rank)
  order by r.rank, r.title
  limit least(greatest(coalesce(p_limit, 40), 1), 80);
end $$;

-- ============ 2. Gastos ============
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  spent_on date not null default current_date,
  category text not null default 'otros' check (category in
    ('remuneraciones','honorarios','arriendo','servicios_basicos','internet_tecnologia','materiales','marketing','mantencion','impuestos','comisiones','capacitacion','otros')),
  description text not null check (length(btrim(description)) between 2 and 300),
  supplier text check (length(supplier) <= 200),
  document_number text check (length(document_number) <= 60),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'CLP',
  program_id uuid references public.programs(id) on delete set null,
  section_id uuid references public.sections(id) on delete set null,
  notes text check (length(notes) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_org_date_idx on public.expenses (organization_id, spent_on desc);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
grant select, insert, update, delete on public.expenses to authenticated;
drop policy if exists exp_read on public.expenses;
create policy exp_read on public.expenses for select to authenticated using (private.has_permission(organization_id, 'finance.view'));
drop policy if exists exp_insert on public.expenses;
create policy exp_insert on public.expenses for insert to authenticated with check (private.has_permission(organization_id, 'finance.create'));
drop policy if exists exp_update on public.expenses;
create policy exp_update on public.expenses for update to authenticated
  using (private.has_permission(organization_id, 'finance.edit') or private.has_permission(organization_id, 'finance.create'))
  with check (private.has_permission(organization_id, 'finance.edit') or private.has_permission(organization_id, 'finance.create'));
drop policy if exists exp_delete on public.expenses;
create policy exp_delete on public.expenses for delete to authenticated
  using (private.has_permission(organization_id, 'finance.void') or private.has_permission(organization_id, 'finance.edit') or private.has_permission(organization_id, 'finance.admin'));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_expenses') then
    create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function private.audit_row();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_expenses_updated') then
    create trigger trg_expenses_updated before update on public.expenses for each row execute function private.set_updated_at();
  end if;
end $$;

-- ============ 3. Balance: ingresos, gastos y saldo por mes, programa y sección ============
create or replace function public.finance_report(p_org uuid, p_from date, p_to date, p_currency text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cur text; tz text; res jsonb;
begin
  if not private.has_permission(p_org, 'finance.view') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then raise exception 'Rango de fechas inválido' using errcode = '22023'; end if;
  select coalesce(upper(p_currency), o.base_currency), coalesce(o.timezone, 'America/Santiago') into cur, tz from public.organizations o where o.id = p_org;

  with pay as (
    select p.id, p.kind, p.refund_of, p.amount, date_trunc('month', p.paid_at at time zone tz)::date as m
      from public.payments p
     where p.organization_id = p_org and p.status = 'confirmed' and p.currency = cur
       and (p.paid_at at time zone tz)::date between p_from and p_to),
  base as (select distinct coalesce(refund_of, id) as pid from pay),
  alloc as (
    select a.payment_id, c.enrollment_id, sum(a.amount) as amt
      from public.payment_allocations a
      join public.installments i on i.id = a.installment_id
      join public.charges c on c.id = i.charge_id
     where a.payment_id in (select pid from base)
     group by 1, 2),
  shares as (   -- fracción de cada pago que corresponde a cada matrícula (el resto queda «sin asignar»)
    select x.payment_id, x.enrollment_id, x.amt / p.amount as share
      from alloc x join public.payments p on p.id = x.payment_id
    union all
    select p.id, null::uuid, greatest(0, 1 - coalesce((select sum(amt) from alloc where payment_id = p.id), 0) / p.amount)
      from public.payments p where p.id in (select pid from base)),
  lines as (
    select pay.m, s.enrollment_id, case when pay.kind = 'refund' then -1 else 1 end * pay.amount * s.share as amt
      from pay join shares s on s.payment_id = coalesce(pay.refund_of, pay.id)
     where s.share > 0),
  inc as (select l.m, l.enrollment_id, e.program_id, l.amt from lines l left join public.enrollments e on e.id = l.enrollment_id),
  secs as (   -- ingreso por sección: si la matrícula tiene varias secciones se reparte en partes iguales
    select i.m, se.section_id, i.amt / count(*) over (partition by i.m, i.enrollment_id, i.amt) as amt
      from inc i join public.section_enrollments se on se.enrollment_id = i.enrollment_id and se.status <> 'dropped'),
  exp as (
    select date_trunc('month', x.spent_on)::date as m, x.program_id, x.section_id, x.category, x.amount as amt
      from public.expenses x
     where x.organization_id = p_org and x.currency = cur and x.spent_on between p_from and p_to),
  months as (select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m),
  prog_ids as (select program_id as id from inc where program_id is not null union select program_id from exp where program_id is not null),
  sec_ids as (select section_id as id from secs union select section_id from exp where section_id is not null)
  select jsonb_build_object(
    'currency', cur, 'from', p_from, 'to', p_to,
    'income', coalesce((select sum(amt) from inc), 0),
    'expenses', coalesce((select sum(amt) from exp), 0),
    'months', coalesce((select jsonb_agg(jsonb_build_object('m', mo.m,
        'income', coalesce((select sum(amt) from inc where inc.m = mo.m), 0),
        'expenses', coalesce((select sum(amt) from exp where exp.m = mo.m), 0)) order by mo.m) from months mo), '[]'),
    'programs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name,
        'students', (select count(*) from public.enrollments e where e.program_id = p.id and e.status = 'active'),
        'income', coalesce((select sum(amt) from inc where inc.program_id = p.id), 0),
        'expenses', coalesce((select sum(amt) from exp where exp.program_id = p.id), 0),
        'months', (select jsonb_object_agg(mo.m, coalesce((select sum(amt) from inc where inc.program_id = p.id and inc.m = mo.m), 0)) from months mo))
        order by p.name) from public.programs p where p.id in (select id from prog_ids)), '[]'),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', c.name,
        'students', (select count(*) from public.section_enrollments se where se.section_id = s.id and se.status = 'enrolled'),
        'income', coalesce((select sum(amt) from secs where secs.section_id = s.id), 0),
        'expenses', coalesce((select sum(amt) from exp where exp.section_id = s.id), 0),
        'months', (select jsonb_object_agg(mo.m, coalesce((select sum(amt) from secs where secs.section_id = s.id and secs.m = mo.m), 0)) from months mo))
        order by c.name, s.code) from public.sections s join public.courses c on c.id = s.course_id where s.id in (select id from sec_ids)), '[]'),
    'unassigned_income', coalesce((select sum(amt) from inc where program_id is null), 0),
    'general_expenses', coalesce((select sum(amt) from exp where program_id is null and section_id is null), 0),
    'categories', coalesce((select jsonb_object_agg(category, t) from (select category, sum(amt) t from exp group by 1) z), '{}')
  ) into res;
  return res;
end $$;
grant execute on function public.finance_report(uuid, date, date, text) to authenticated;

-- ============ 4. Editar una matrícula después de creada ============
create or replace function public.update_enrollment(p_enrollment uuid, p_program uuid, p_period uuid, p_campus uuid default null,
  p_curriculum uuid default null, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; v_curr uuid;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if not found then raise exception 'Matrícula inexistente' using errcode = 'P0002'; end if;
  if not (private.has_permission(e.organization_id, 'enrollments.edit', e.campus_id) or private.has_permission(e.organization_id, 'enrollments.admin', e.campus_id)
          or private.has_permission(e.organization_id, 'enrollments.create', e.campus_id)) then
    raise exception 'No autorizado para editar matrículas' using errcode = '42501';
  end if;
  if not exists (select 1 from public.programs where id = p_program and organization_id = e.organization_id) then
    raise exception 'Programa inválido' using errcode = '22023'; end if;
  if not exists (select 1 from public.academic_periods where id = p_period and organization_id = e.organization_id) then
    raise exception 'Periodo inválido' using errcode = '22023'; end if;
  if p_campus is not null and not exists (select 1 from public.campuses where id = p_campus and organization_id = e.organization_id) then
    raise exception 'Sede inválida' using errcode = '22023'; end if;
  if p_curriculum is not null and not exists (select 1 from public.curricula where id = p_curriculum and program_id = p_program) then
    -- Al cambiar de programa, la malla anterior no sirve: se usa la vigente del nuevo programa
    if p_program <> e.program_id then p_curriculum := null;
    else raise exception 'La malla no corresponde al programa' using errcode = '22023'; end if;
  end if;
  v_curr := case when p_curriculum is not null then p_curriculum
                 when p_program = e.program_id then e.curriculum_id
                 else (select c.id from public.curricula c where c.program_id = p_program and c.status = 'active' order by c.valid_from desc limit 1) end;
  if v_curr is null then raise exception 'El programa no tiene malla vigente' using errcode = '22023'; end if;
  if exists (select 1 from public.enrollments where student_id = e.student_id and program_id = p_program and period_id = p_period and id <> e.id) then
    raise exception 'El estudiante ya tiene una matrícula en ese programa y periodo' using errcode = '23505';
  end if;
  update public.enrollments
     set program_id = p_program, period_id = p_period, curriculum_id = v_curr, campus_id = coalesce(p_campus, campus_id),
         financial_terms = case when p_notes is null then financial_terms
                                else coalesce(financial_terms, '{}'::jsonb) || jsonb_build_object('notes', left(p_notes, 1000)) end
   where id = e.id;
end $$;
grant execute on function public.update_enrollment(uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- ============ 5. Invitados externos a una clase o reunión ============
create table if not exists public.conference_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.conference_sessions(id) on delete cascade,
  token text not null unique,
  label text check (length(label) <= 120),
  allow_share boolean not null default false,
  require_document boolean not null default true,
  max_uses int check (max_uses is null or max_uses between 1 and 1000),
  uses int not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists conf_invites_session_idx on public.conference_invites (session_id);

create table if not exists public.conference_guests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.conference_sessions(id) on delete cascade,
  invite_id uuid references public.conference_invites(id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 3 and 120),
  document_type text check (length(document_type) <= 20),
  document_number text check (length(document_number) <= 30),
  position text check (length(position) <= 120),
  institution text check (length(institution) <= 160),
  email text check (length(email) <= 200),
  phone text check (length(phone) <= 40),
  ip inet, user_agent text,
  token_issued_at timestamptz not null default now(),
  joined_at timestamptz, left_at timestamptz,
  removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists conf_guests_session_idx on public.conference_guests (session_id, created_at);

alter table public.conference_invites enable row level security;
alter table public.conference_guests enable row level security;
revoke all on public.conference_invites, public.conference_guests from anon;
grant select on public.conference_invites, public.conference_guests to authenticated;
drop policy if exists cinv_read on public.conference_invites;
create policy cinv_read on public.conference_invites for select to authenticated
  using (public.conference_is_moderator(session_id) or private.has_permission(organization_id, 'conferences.view'));
drop policy if exists cguest_read on public.conference_guests;
create policy cguest_read on public.conference_guests for select to authenticated
  using (public.conference_is_moderator(session_id) or private.has_permission(organization_id, 'conferences.view'));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_conference_invites') then
    create trigger audit_conference_invites after insert or update or delete on public.conference_invites for each row execute function private.audit_row();
  end if;
end $$;

create or replace function public.create_conference_invite(p_session uuid, p_hours int default 24, p_max_uses int default null,
  p_allow_share boolean default false, p_require_document boolean default true, p_label text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions; v public.conference_invites; v_exp timestamptz;
begin
  select * into s from public.conference_sessions where id = p_session;
  if not found then raise exception 'La sesión no existe' using errcode = 'P0002'; end if;
  if not public.conference_is_moderator(p_session) then raise exception 'Solo el anfitrión o un moderador puede invitar' using errcode = '42501'; end if;
  if s.status in ('ended', 'cancelled') then raise exception 'La sesión ya terminó o fue cancelada' using errcode = '22023'; end if;
  v_exp := least(now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 30))), s.scheduled_end + interval '60 minutes');
  if v_exp <= now() then v_exp := s.scheduled_end + interval '60 minutes'; end if;
  insert into public.conference_invites (organization_id, session_id, token, label, allow_share, require_document, max_uses, expires_at)
  values (s.organization_id, s.id, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'),
          nullif(btrim(coalesce(p_label, '')), ''), coalesce(p_allow_share, false), coalesce(p_require_document, true), p_max_uses, v_exp)
  returning * into v;
  return jsonb_build_object('id', v.id, 'token', v.token, 'expires_at', v.expires_at);
end $$;

create or replace function public.revoke_conference_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.conference_invites;
begin
  select * into v from public.conference_invites where id = p_invite;
  if not found then raise exception 'Enlace inexistente' using errcode = 'P0002'; end if;
  if not public.conference_is_moderator(v.session_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.conference_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite;
end $$;
grant execute on function public.create_conference_invite(uuid, int, int, boolean, boolean, text), public.revoke_conference_invite(uuid) to authenticated;

/** Estado de un enlace de invitado (solo el servidor de la plataforma). */
create or replace function public.guest_invite_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.conference_invites; s public.conference_sessions; o public.organizations; reason text;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into v from public.conference_invites where token = p_token;
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  select * into s from public.conference_sessions where id = v.session_id;
  select * into o from public.organizations where id = v.organization_id;
  reason := case when v.revoked_at is not null then 'revoked'
                 when v.expires_at < now() then 'expired'
                 when s.status in ('ended', 'cancelled') or now() > s.scheduled_end + interval '60 minutes' then 'ended'
                 when v.max_uses is not null and v.uses >= v.max_uses then 'full'
                 when now() < s.scheduled_start - interval '15 minutes' then 'too_early' end;
  return jsonb_build_object('valid', reason is null, 'reason', reason, 'title', s.title, 'org', o.display_name,
    'starts', s.scheduled_start, 'ends', s.scheduled_end, 'require_document', v.require_document, 'session_type', s.session_type,
    'org_id', o.id, 'tz', coalesce(o.timezone, 'America/Santiago'));
end $$;

/** Registra al invitado (nombre, documento, cargo) y entrega los datos para su acceso temporal. */
create or replace function public.guest_join(p_token text, p_name text, p_doc_type text, p_doc_number text, p_position text,
  p_institution text, p_email text, p_phone text, p_ip inet default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.conference_invites; s public.conference_sessions; r public.conference_rooms; info jsonb; g uuid; v_conn int; v_exp timestamptz;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  info := public.guest_invite_info(p_token);
  if not (info ->> 'valid')::boolean then return jsonb_build_object('allowed', false, 'reason', info ->> 'reason'); end if;
  select * into v from public.conference_invites where token = p_token for update;
  select * into s from public.conference_sessions where id = v.session_id;
  select * into r from public.conference_rooms where id = s.room_id;
  if length(btrim(coalesce(p_name, ''))) < 3 then return jsonb_build_object('allowed', false, 'reason', 'name'); end if;
  if v.require_document and length(btrim(coalesce(p_doc_number, ''))) < 3 then return jsonb_build_object('allowed', false, 'reason', 'document'); end if;
  select (select count(distinct user_id) from public.conference_attendance where session_id = s.id and left_at is null)
       + (select count(*) from public.conference_guests where session_id = s.id and joined_at is not null and left_at is null and not removed)
    into v_conn;
  if v_conn >= r.max_participants then return jsonb_build_object('allowed', false, 'reason', 'room_full'); end if;
  update public.conference_invites set uses = uses + 1 where id = v.id;
  insert into public.conference_guests (organization_id, session_id, invite_id, full_name, document_type, document_number, position, institution, email, phone, ip, user_agent)
  values (s.organization_id, s.id, v.id, left(btrim(p_name), 120), nullif(p_doc_type, ''), nullif(upper(btrim(coalesce(p_doc_number, ''))), ''),
          nullif(left(btrim(coalesce(p_position, '')), 120), ''), nullif(left(btrim(coalesce(p_institution, '')), 160), ''),
          nullif(left(lower(btrim(coalesce(p_email, ''))), 200), ''), nullif(left(btrim(coalesce(p_phone, '')), 40), ''), p_ip, left(p_ua, 300))
  returning id into g;
  v_exp := least(s.scheduled_end + interval '60 minutes', now() + interval '3 hours');
  return jsonb_build_object('allowed', true, 'guest_id', g, 'room', s.livekit_room_name, 'allow_share', v.allow_share,
    'expires_at', v_exp, 'title', s.title, 'session_id', s.id, 'org_id', s.organization_id, 'chat', coalesce(s.chat_enabled, true));
end $$;

/** Entradas y salidas de invitados (webhook de LiveKit). */
create or replace function public.record_guest_event(p_room_name text, p_event text, p_guest uuid, p_at timestamptz, p_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.conference_sessions;
begin
  if not private.is_service() then raise exception 'Solo el backend' using errcode = '42501'; end if;
  select * into s from public.conference_sessions where livekit_room_name = p_room_name;
  if not found then return; end if;
  insert into public.integration_events (organization_id, provider, event_type, idempotency_key, payload, processed_at)
  values (s.organization_id, 'livekit', p_event, p_event_id, jsonb_build_object('guest', p_guest), now())
  on conflict (provider, idempotency_key) do nothing;
  if not found then return; end if;
  if p_event = 'participant_joined' then
    update public.conference_guests set joined_at = coalesce(joined_at, p_at), left_at = null where id = p_guest and session_id = s.id;
  elsif p_event = 'participant_left' then
    update public.conference_guests set left_at = p_at where id = p_guest and session_id = s.id;
  end if;
end $$;

/** El anfitrión saca a un invitado: queda marcado y no puede volver a entrar con ese acceso. */
create or replace function public.remove_conference_guest(p_guest uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.conference_guests;
begin
  select * into g from public.conference_guests where id = p_guest;
  if not found then return; end if;
  if not public.conference_is_moderator(g.session_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.conference_guests set removed = true, left_at = coalesce(left_at, now()) where id = p_guest;
end $$;

/** Límite de intentos para el ingreso de invitados (por IP), solo para el servidor. */
create or replace function public.guest_rate_limited(p_key text, p_max int default 20)
returns boolean language sql security definer set search_path = '' as $$
  select private.rate_limited('guest_join', p_key, p_max, interval '10 minutes')
$$;
revoke all on function public.guest_rate_limited(text, int) from public, anon, authenticated;
grant execute on function public.guest_rate_limited(text, int) to service_role;

revoke all on function public.guest_invite_info(text), public.guest_join(text, text, text, text, text, text, text, text, inet, text),
  public.record_guest_event(text, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.guest_invite_info(text), public.guest_join(text, text, text, text, text, text, text, text, inet, text),
  public.record_guest_event(text, text, uuid, timestamptz, text) to service_role;
grant execute on function public.remove_conference_guest(uuid) to authenticated;
grant execute on function public.global_search(uuid, text, int) to authenticated;
