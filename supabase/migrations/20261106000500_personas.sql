-- =====================================================================
-- Migración 005 · Personas: estudiantes, profesores, personal, prospectos
-- Sistemas 06, 08, 21, 22, 23 · RF-009, RF-015, RF-041
-- =====================================================================

create table public.students (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  campus_id           uuid,
  user_id             uuid references public.profiles(id) on delete restrict,
  student_code        text not null,
  first_names         text not null check (length(trim(first_names)) between 1 and 120),
  last_names          text not null check (length(trim(last_names)) between 1 and 120),
  id_document_country char(2) not null references public.countries(code),
  id_document_type    text not null,
  id_document_number  text not null check (length(trim(id_document_number)) between 3 and 40),
  birth_date          date check (birth_date between date '1900-01-01' and current_date),
  email               text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text check (phone ~ '^\+?[0-9 ()-]{6,20}$'),
  nationality         char(2) references public.countries(code),
  status              public.person_status not null default 'active',
  admitted_on         date not null default current_date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, student_code),
  unique (organization_id, id_document_country, id_document_type, id_document_number),
  unique (organization_id, user_id),
  unique (organization_id, id),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

create table public.teachers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  campus_id           uuid,
  user_id             uuid references public.profiles(id) on delete restrict,
  teacher_code        text not null,
  first_names         text not null check (length(trim(first_names)) between 1 and 120),
  last_names          text not null check (length(trim(last_names)) between 1 and 120),
  id_document_country char(2) not null references public.countries(code),
  id_document_type    text not null,
  id_document_number  text not null,
  email               text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  academic_degree     text,
  specialty           text,
  status              public.person_status not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, teacher_code),
  unique (organization_id, id_document_country, id_document_type, id_document_number),
  unique (organization_id, user_id),
  unique (organization_id, id),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

create table public.employees (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  campus_id           uuid,
  department_id       uuid references public.departments(id),
  user_id             uuid references public.profiles(id) on delete restrict,
  employee_code       text not null,
  first_names         text not null,
  last_names          text not null,
  id_document_country char(2) not null references public.countries(code),
  id_document_type    text not null,
  id_document_number  text not null,
  email               text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  position            text not null,
  status              public.person_status not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, employee_code),
  unique (organization_id, id_document_country, id_document_type, id_document_number),
  unique (organization_id, id),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

create table public.employment_contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  employee_id     uuid,
  teacher_id      uuid,
  contract_type   text not null check (contract_type in ('indefinite','fixed_term','hourly','fee')),
  starts_on       date not null,
  ends_on         date,
  salary_amount   public.money_amount check (salary_amount >= 0),
  currency        public.currency_code references public.currencies(code),
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  check (num_nonnulls(employee_id, teacher_id) = 1),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id),
  foreign key (organization_id, teacher_id)  references public.teachers(organization_id, id),
  check (ends_on is null or ends_on >= starts_on)
);

-- CRM de admisión (RF-009)
create table public.contacts (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  campus_id           uuid,
  full_name           text not null,
  email               text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text,
  country_code        char(2) references public.countries(code),
  source              text not null default 'web',
  stage               text not null default 'lead' check (stage in ('lead','contacted','interested','applied','enrolled','lost')),
  interest_program_id uuid,
  owner_user_id       uuid references public.profiles(id),
  consent_marketing   boolean not null default false,
  consent_at          timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (email is not null or phone is not null),
  check (not consent_marketing or consent_at is not null),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

create trigger trg_students_updated  before update on public.students  for each row execute function private.set_updated_at();
create trigger trg_teachers_updated  before update on public.teachers  for each row execute function private.set_updated_at();
create trigger trg_employees_updated before update on public.employees for each row execute function private.set_updated_at();
create trigger trg_contacts_updated  before update on public.contacts  for each row execute function private.set_updated_at();

create trigger audit_students  after insert or update or delete on public.students  for each row execute function private.audit_row();
create trigger audit_teachers  after insert or update or delete on public.teachers  for each row execute function private.audit_row();
create trigger audit_employees after insert or update or delete on public.employees for each row execute function private.audit_row();
create trigger audit_contracts after insert or update or delete on public.employment_contracts for each row execute function private.audit_row();
create trigger audit_contacts  after insert or update or delete on public.contacts  for each row execute function private.audit_row();

-- Identificadores del usuario actual
create or replace function private.my_student_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.students s where s.user_id = auth.uid() and private.current_user_active()
$$;
create or replace function private.my_teacher_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select t.id from public.teachers t where t.user_id = auth.uid() and t.status = 'active' and private.current_user_active()
$$;

-- RLS -------------------------------------------------------------------
alter table public.students             enable row level security;
alter table public.teachers             enable row level security;
alter table public.employees            enable row level security;
alter table public.employment_contracts enable row level security;
alter table public.contacts             enable row level security;

create policy students_read on public.students for select to authenticated
  using (private.has_permission(organization_id, 'students.view', campus_id)
         or id in (select private.my_student_ids()));
create policy students_ins on public.students for insert to authenticated
  with check (private.has_permission(organization_id, 'students.create', campus_id));
create policy students_upd on public.students for update to authenticated
  using (private.has_permission(organization_id, 'students.edit', campus_id))
  with check (private.has_permission(organization_id, 'students.edit', campus_id));

create policy teachers_read on public.teachers for select to authenticated
  using (private.has_permission(organization_id, 'teachers.view', campus_id) or user_id = (select auth.uid()));
create policy teachers_ins on public.teachers for insert to authenticated
  with check (private.has_permission(organization_id, 'teachers.create', campus_id));
create policy teachers_upd on public.teachers for update to authenticated
  using (private.has_permission(organization_id, 'teachers.edit', campus_id))
  with check (private.has_permission(organization_id, 'teachers.edit', campus_id));

create policy employees_read on public.employees for select to authenticated
  using (private.has_permission(organization_id, 'employees.view', campus_id) or user_id = (select auth.uid()));
create policy employees_ins on public.employees for insert to authenticated
  with check (private.has_permission(organization_id, 'employees.create', campus_id));
create policy employees_upd on public.employees for update to authenticated
  using (private.has_permission(organization_id, 'employees.edit', campus_id))
  with check (private.has_permission(organization_id, 'employees.edit', campus_id));

-- Contratos (contienen remuneración): solo RR. HH. con edición
create policy contracts_read on public.employment_contracts for select to authenticated
  using (private.has_permission(organization_id, 'employees.edit'));
create policy contracts_ins on public.employment_contracts for insert to authenticated
  with check (private.has_permission(organization_id, 'employees.create'));
create policy contracts_upd on public.employment_contracts for update to authenticated
  using (private.has_permission(organization_id, 'employees.edit'))
  with check (private.has_permission(organization_id, 'employees.edit'));

create policy contacts_read on public.contacts for select to authenticated
  using (private.has_permission(organization_id, 'admissions.view', campus_id));
create policy contacts_ins on public.contacts for insert to authenticated
  with check (private.has_permission(organization_id, 'admissions.create', campus_id));
create policy contacts_upd on public.contacts for update to authenticated
  using (private.has_permission(organization_id, 'admissions.edit', campus_id))
  with check (private.has_permission(organization_id, 'admissions.edit', campus_id));
