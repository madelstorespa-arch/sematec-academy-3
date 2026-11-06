-- =====================================================================
-- SEMATEC GLOBAL 10.0 · Migración 001 · Fundación
-- Extensiones, esquemas, tipos enumerados y utilidades comunes.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Esquema "private": funciones internas de seguridad. NO se expone en la API
-- de Supabase (solo se exponen los esquemas configurados, por defecto public).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
create type public.record_status        as enum ('active', 'inactive', 'archived');
create type public.membership_status    as enum ('active', 'suspended', 'revoked');
create type public.profile_status       as enum ('active', 'suspended', 'locked');
create type public.person_status        as enum ('active', 'inactive', 'graduated', 'withdrawn', 'suspended');
create type public.application_status   as enum ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn');
create type public.enrollment_status    as enum ('active', 'suspended', 'withdrawn', 'completed', 'cancelled');
create type public.section_enr_status   as enum ('enrolled', 'dropped', 'completed');
create type public.attendance_status    as enum ('present', 'absent', 'late', 'excused');
create type public.record_result        as enum ('in_progress', 'approved', 'failed', 'withdrawn');
create type public.charge_status        as enum ('pending', 'partially_paid', 'paid', 'cancelled');
create type public.payment_status       as enum ('confirmed', 'voided');
create type public.certificate_status   as enum ('issued', 'revoked');
create type public.conference_type      as enum ('class', 'meeting', 'webinar', 'congress', 'tutoring');
create type public.conference_status    as enum ('scheduled', 'live', 'ended', 'cancelled');
create type public.conference_role      as enum ('organizer', 'presenter', 'moderator', 'teacher', 'student', 'attendee');
create type public.period_status        as enum ('planned', 'open', 'closed');

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Valida que un texto sea un código ISO de moneda de 3 letras mayúsculas
create domain public.currency_code as char(3) check (value ~ '^[A-Z]{3}$');
-- Montos monetarios: 4 decimales para soportar monedas con subunidades finas
create domain public.money_amount as numeric(18,4);
