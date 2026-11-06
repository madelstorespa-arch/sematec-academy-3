-- =====================================================================
-- Migración 002 · Instituciones, sedes y configuración regional
-- Sistemas 01-03 (gobierno, red institucional, gestión internacional)
-- RF-001 a RF-008 · INT-001 a INT-008
-- =====================================================================

-- Catálogos globales -----------------------------------------------------
create table public.countries (
  code            char(2) primary key check (code ~ '^[A-Z]{2}$'),   -- ISO 3166-1 alfa-2
  name            text not null,
  default_currency public.currency_code not null,
  default_locale  text not null default 'es',
  default_timezone text not null,
  id_document_types jsonb not null default '[]'::jsonb,             -- INT-008
  created_at      timestamptz not null default now()
);

create table public.currencies (
  code       public.currency_code primary key,
  name       text not null,
  minor_units smallint not null default 2 check (minor_units between 0 and 4)
);

-- INT-006: tipos de cambio almacenados y auditables (nunca se sobrescriben)
create table public.exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  base_currency public.currency_code not null references public.currencies(code),
  quote_currency public.currency_code not null references public.currencies(code),
  rate          numeric(20,10) not null check (rate > 0),
  valid_on      date not null,
  source        text not null,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (base_currency, quote_currency, valid_on, source),
  check (base_currency <> quote_currency)
);

create table public.regional_settings (
  id             uuid primary key default gen_random_uuid(),
  country_code   char(2) not null references public.countries(code),
  key            text not null,
  value          jsonb not null,
  updated_at     timestamptz not null default now(),
  unique (country_code, key)
);

-- Instituciones ----------------------------------------------------------
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  legal_name      text not null check (length(trim(legal_name)) between 2 and 200),
  display_name    text not null,
  tax_id          text,
  country_code    char(2) not null references public.countries(code),
  base_currency   public.currency_code not null references public.currencies(code),
  default_locale  text not null default 'es',
  timezone        text not null,
  status          public.record_status not null default 'active',
  branding        jsonb not null default '{}'::jsonb,               -- RF-008
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (country_code, tax_id)
);

create table public.campuses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code            text not null,
  name            text not null,
  country_code    char(2) not null references public.countries(code),
  city            text,
  address         text,
  timezone        text not null,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)   -- permite FK compuestas (org, campus)
);

create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id       uuid,
  parent_id       uuid references public.departments(id),
  code            text not null,
  name            text not null,
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

-- Aulas, laboratorios y salas (RF-020, RF-045)
create table public.rooms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id       uuid not null,
  code            text not null,
  name            text not null,
  capacity        integer not null check (capacity > 0),
  room_type       text not null default 'classroom',
  status          public.record_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campus_id, code),
  unique (organization_id, id),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

-- Configuración institucional sin editar código (RF-008, requisito §5)
create table public.organization_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  key             text not null check (key ~ '^[a-z0-9_.]+$'),
  value           jsonb not null,
  description     text,
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

-- Autoridades y responsables (RF-005)
create table public.authorities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id       uuid,
  position        text not null,
  full_name       text not null,
  email           text,
  starts_on       date not null,
  ends_on         date,
  created_at      timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  foreign key (organization_id, campus_id) references public.campuses(organization_id, id)
);

create trigger trg_organizations_updated before update on public.organizations for each row execute function private.set_updated_at();
create trigger trg_campuses_updated      before update on public.campuses      for each row execute function private.set_updated_at();
create trigger trg_departments_updated   before update on public.departments   for each row execute function private.set_updated_at();
create trigger trg_rooms_updated         before update on public.rooms         for each row execute function private.set_updated_at();
create trigger trg_org_settings_updated  before update on public.organization_settings for each row execute function private.set_updated_at();

-- Lectura de configuración con valor por defecto (usado por reglas de negocio)
create or replace function private.org_setting(p_org uuid, p_key text, p_default jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.value from public.organization_settings s where s.organization_id = p_org and s.key = p_key),
    p_default)
$$;
