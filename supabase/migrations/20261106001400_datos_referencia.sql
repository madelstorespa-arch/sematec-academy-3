-- =====================================================================
-- Migración 014 · Datos de referencia (necesarios también en producción)
-- Monedas y países iniciales; se amplían desde el panel del superadmin.
-- =====================================================================

insert into public.currencies (code, name, minor_units) values
  ('CLP', 'Peso chileno', 0), ('PEN', 'Sol peruano', 2), ('ARS', 'Peso argentino', 2),
  ('MXN', 'Peso mexicano', 2), ('COP', 'Peso colombiano', 0), ('USD', 'Dólar estadounidense', 2),
  ('EUR', 'Euro', 2), ('BOB', 'Boliviano', 2), ('UYU', 'Peso uruguayo', 2), ('PYG', 'Guaraní', 0)
on conflict (code) do nothing;

insert into public.countries (code, name, default_currency, default_locale, default_timezone, id_document_types) values
  ('CL', 'Chile',          'CLP', 'es-CL', 'America/Santiago',     '["RUN","PASAPORTE"]'),
  ('PE', 'Perú',           'PEN', 'es-PE', 'America/Lima',         '["DNI","CE","PASAPORTE"]'),
  ('AR', 'Argentina',      'ARS', 'es-AR', 'America/Argentina/Buenos_Aires', '["DNI","PASAPORTE"]'),
  ('MX', 'México',         'MXN', 'es-MX', 'America/Mexico_City',  '["CURP","INE","PASAPORTE"]'),
  ('CO', 'Colombia',       'COP', 'es-CO', 'America/Bogota',       '["CC","CE","PASAPORTE"]'),
  ('BO', 'Bolivia',        'BOB', 'es-BO', 'America/La_Paz',       '["CI","PASAPORTE"]'),
  ('UY', 'Uruguay',        'UYU', 'es-UY', 'America/Montevideo',   '["CI","PASAPORTE"]'),
  ('PY', 'Paraguay',       'PYG', 'es-PY', 'America/Asuncion',     '["CI","PASAPORTE"]'),
  ('ES', 'España',         'EUR', 'es-ES', 'Europe/Madrid',        '["DNI","NIE","PASAPORTE"]'),
  ('US', 'Estados Unidos', 'USD', 'en-US', 'America/New_York',     '["STATE_ID","PASSPORT"]')
on conflict (code) do nothing;
