-- =====================================================================
-- SEMATEC GLOBAL 10.0 · Datos seguros de prueba (SOLO desarrollo/pruebas)
-- Personas y documentos ficticios. NO cargar en producción.
-- Supabase lo ejecuta automáticamente con `supabase db reset` (entorno local).
-- =====================================================================

-- Usuarios de prueba. Para poder iniciar sesión con ellos, ejecute ANTES
-- `npm run demo:usuarios` (los crea en Supabase Auth con contraseña).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'superadmin@demo.sematec.test', '{"full_name":"Superadministrador Demo"}'),
  ('00000000-0000-4000-8000-000000000010', 'propietario.a@demo.sematec.test', '{"full_name":"Propietaria Institución A"}'),
  ('00000000-0000-4000-8000-000000000011', 'secretaria.a@demo.sematec.test',  '{"full_name":"Secretaria Académica A"}'),
  ('00000000-0000-4000-8000-000000000012', 'tesoreria.a@demo.sematec.test',   '{"full_name":"Tesorero A"}'),
  ('00000000-0000-4000-8000-000000000013', 'director.a@demo.sematec.test',    '{"full_name":"Director Académico A"}'),
  ('00000000-0000-4000-8000-000000000014', 'auditor.a@demo.sematec.test',     '{"full_name":"Auditora A"}'),
  ('00000000-0000-4000-8000-000000000015', 'soporte.a@demo.sematec.test',     '{"full_name":"Soporte Técnico A"}'),
  ('00000000-0000-4000-8000-000000000016', 'matriculas.a@demo.sematec.test',  '{"full_name":"Matrículas A"}'),
  ('00000000-0000-4000-8000-000000000020', 'profesor1.a@demo.sematec.test',   '{"full_name":"Profesor Uno"}'),
  ('00000000-0000-4000-8000-000000000021', 'profesor2.a@demo.sematec.test',   '{"full_name":"Profesora Dos"}'),
  ('00000000-0000-4000-8000-000000000030', 'estudiante1.a@demo.sematec.test', '{"full_name":"Estudiante Uno"}'),
  ('00000000-0000-4000-8000-000000000031', 'estudiante2.a@demo.sematec.test', '{"full_name":"Estudiante Dos"}'),
  ('00000000-0000-4000-8000-000000000032', 'estudiante3.a@demo.sematec.test', '{"full_name":"Estudiante Tres"}'),
  ('00000000-0000-4000-8000-000000000040', 'postulante@demo.sematec.test',    '{"full_name":"Postulante Externo"}'),
  ('00000000-0000-4000-8000-000000000050', 'propietario.b@demo.sematec.test', '{"full_name":"Propietario Institución B"}'),
  ('00000000-0000-4000-8000-000000000051', 'estudiante1.b@demo.sematec.test', '{"full_name":"Estudiante B Uno"}')
on conflict (id) do nothing;  -- si ya fueron creados con contraseña por scripts/crear-usuarios-demo.mjs

update public.profiles set is_platform_admin = true where id = '00000000-0000-4000-8000-000000000001';

-- Instituciones
insert into public.organizations (id, slug, legal_name, display_name, tax_id, country_code, base_currency, timezone) values
  ('0a000000-0000-4000-8000-000000000001', 'sematec-demo-cl', 'Instituto SEMATEC Demo Chile', 'SEMATEC Chile', '76.000.000-0', 'CL', 'CLP', 'America/Santiago'),
  ('0b000000-0000-4000-8000-000000000001', 'sematec-demo-pe', 'Instituto SEMATEC Demo Perú',  'SEMATEC Perú',  '20000000001',  'PE', 'PEN', 'America/Lima');

insert into public.campuses (id, organization_id, code, name, country_code, city, timezone) values
  ('0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-000000000001', 'STGO', 'Sede Santiago', 'CL', 'Santiago', 'America/Santiago'),
  ('0a000000-0000-4000-8000-0000000000c2', '0a000000-0000-4000-8000-000000000001', 'VALP', 'Sede Valparaíso', 'CL', 'Valparaíso', 'America/Santiago'),
  ('0b000000-0000-4000-8000-0000000000c1', '0b000000-0000-4000-8000-000000000001', 'LIMA', 'Sede Lima', 'PE', 'Lima', 'America/Lima');

insert into public.rooms (id, organization_id, campus_id, code, name, capacity) values
  ('0a000000-0000-4000-8000-00000000aa01', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1', 'A101', 'Sala A101', 40),
  ('0a000000-0000-4000-8000-00000000aa02', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1', 'LAB1', 'Laboratorio 1', 25);

insert into public.organization_settings (organization_id, key, value, description) values
  ('0a000000-0000-4000-8000-000000000001', 'certificates.block_if_overdue', 'true', 'Bloquear certificados con deuda vencida'),
  ('0a000000-0000-4000-8000-000000000001', 'conferences.min_attendance_pct', '75', 'Asistencia mínima en conferencias');

-- Membresías (roles)
insert into public.memberships (user_id, organization_id, role_id, campus_id)
select u.uid::uuid, u.org::uuid, r.id, u.campus::uuid
from (values
  ('00000000-0000-4000-8000-000000000010', '0a000000-0000-4000-8000-000000000001', 'propietario_institucional', null),
  ('00000000-0000-4000-8000-000000000011', '0a000000-0000-4000-8000-000000000001', 'secretaria', '0a000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-000000000012', '0a000000-0000-4000-8000-000000000001', 'tesoreria', null),
  ('00000000-0000-4000-8000-000000000013', '0a000000-0000-4000-8000-000000000001', 'director_academico', null),
  ('00000000-0000-4000-8000-000000000014', '0a000000-0000-4000-8000-000000000001', 'auditor', null),
  ('00000000-0000-4000-8000-000000000015', '0a000000-0000-4000-8000-000000000001', 'soporte_tecnico', null),
  ('00000000-0000-4000-8000-000000000016', '0a000000-0000-4000-8000-000000000001', 'matriculas', null),
  ('00000000-0000-4000-8000-000000000020', '0a000000-0000-4000-8000-000000000001', 'profesor', null),
  ('00000000-0000-4000-8000-000000000021', '0a000000-0000-4000-8000-000000000001', 'profesor', null),
  ('00000000-0000-4000-8000-000000000030', '0a000000-0000-4000-8000-000000000001', 'estudiante', null),
  ('00000000-0000-4000-8000-000000000031', '0a000000-0000-4000-8000-000000000001', 'estudiante', null),
  ('00000000-0000-4000-8000-000000000032', '0a000000-0000-4000-8000-000000000001', 'estudiante', null),
  ('00000000-0000-4000-8000-000000000050', '0b000000-0000-4000-8000-000000000001', 'propietario_institucional', null),
  ('00000000-0000-4000-8000-000000000051', '0b000000-0000-4000-8000-000000000001', 'estudiante', null)
) as u(uid, org, role_code, campus)
join public.roles r on r.code = u.role_code and r.organization_id is null;

-- Académico institución A
insert into public.grade_scales (id, organization_id, name, min_grade, max_grade, passing_grade, decimals) values
  ('0a000000-0000-4000-8000-00000000a5c1', '0a000000-0000-4000-8000-000000000001', 'Chile 1.0 - 7.0', 1.0, 7.0, 4.0, 1),
  ('0b000000-0000-4000-8000-00000000b5c1', '0b000000-0000-4000-8000-000000000001', 'Perú 0 - 20', 0, 20, 11, 0);

insert into public.programs (id, organization_id, code, name, level, duration_terms, grade_scale_id) values
  ('0a000000-0000-4000-8000-00000000a9a1', '0a000000-0000-4000-8000-000000000001', 'TIN', 'Técnico en Informática', 'technical', 4, '0a000000-0000-4000-8000-00000000a5c1'),
  ('0b000000-0000-4000-8000-00000000b9a1', '0b000000-0000-4000-8000-000000000001', 'ADM', 'Administración', 'technical', 6, '0b000000-0000-4000-8000-00000000b5c1');

insert into public.curricula (id, organization_id, program_id, version, valid_from, total_credits) values
  ('0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000a9a1', '2026', '2026-01-01', 30),
  ('0b000000-0000-4000-8000-00000000bcc1', '0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000b9a1', '2026', '2026-01-01', 40);

insert into public.courses (id, organization_id, code, name, credits, weekly_hours) values
  ('0a000000-0000-4000-8000-00000000ac01', '0a000000-0000-4000-8000-000000000001', 'PRG101', 'Programación I', 10, 6),
  ('0a000000-0000-4000-8000-00000000ac02', '0a000000-0000-4000-8000-000000000001', 'PRG201', 'Programación II', 10, 6),
  ('0a000000-0000-4000-8000-00000000ac03', '0a000000-0000-4000-8000-000000000001', 'BDD101', 'Bases de Datos', 10, 4);

insert into public.curriculum_courses (curriculum_id, course_id, term_number) values
  ('0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-00000000ac01', 1),
  ('0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-00000000ac02', 2),
  ('0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-00000000ac03', 1);
insert into public.course_prerequisites (course_id, prerequisite_id) values
  ('0a000000-0000-4000-8000-00000000ac02', '0a000000-0000-4000-8000-00000000ac01');

insert into public.academic_periods (id, organization_id, code, name, starts_on, ends_on, enrollment_opens_on, enrollment_closes_on, status) values
  ('0a000000-0000-4000-8000-00000000ae01', '0a000000-0000-4000-8000-000000000001', '2026-2', 'Segundo semestre 2026',
   date '2026-08-01', date '2026-12-20', date '2026-07-01', date '2026-12-15', 'open'),
  ('0b000000-0000-4000-8000-00000000be01', '0b000000-0000-4000-8000-000000000001', '2026-2', 'Ciclo 2026-II',
   date '2026-08-01', date '2026-12-20', null, null, 'open');

insert into public.teachers (id, organization_id, campus_id, user_id, teacher_code, first_names, last_names,
                             id_document_country, id_document_type, id_document_number, email) values
  ('0a000000-0000-4000-8000-00000000a701', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-000000000020', 'DOC-001', 'Profesor', 'Uno', 'CL', 'RUN', 'TEST-0001', 'profesor1.a@demo.sematec.test'),
  ('0a000000-0000-4000-8000-00000000a702', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-000000000021', 'DOC-002', 'Profesora', 'Dos', 'CL', 'RUN', 'TEST-0002', 'profesor2.a@demo.sematec.test');

insert into public.sections (id, organization_id, campus_id, course_id, period_id, code, teacher_id, grade_scale_id, capacity) values
  ('0a000000-0000-4000-8000-00000000ad01', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '0a000000-0000-4000-8000-00000000ac01', '0a000000-0000-4000-8000-00000000ae01', 'S1', '0a000000-0000-4000-8000-00000000a701', '0a000000-0000-4000-8000-00000000a5c1', 2),
  ('0a000000-0000-4000-8000-00000000ad02', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '0a000000-0000-4000-8000-00000000ac02', '0a000000-0000-4000-8000-00000000ae01', 'S1', '0a000000-0000-4000-8000-00000000a701', '0a000000-0000-4000-8000-00000000a5c1', 30),
  ('0a000000-0000-4000-8000-00000000ad03', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '0a000000-0000-4000-8000-00000000ac03', '0a000000-0000-4000-8000-00000000ae01', 'S1', '0a000000-0000-4000-8000-00000000a702', '0a000000-0000-4000-8000-00000000a5c1', 30);

insert into public.section_schedules (organization_id, section_id, weekday, time_slot, room_id) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000ad01', 1, '[08:30,10:00)', '0a000000-0000-4000-8000-00000000aa01'),
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000ad03', 2, '[10:00,11:30)', '0a000000-0000-4000-8000-00000000aa02');

-- Estudiantes ficticios
insert into public.students (id, organization_id, campus_id, user_id, student_code, first_names, last_names,
                             id_document_country, id_document_type, id_document_number, email, birth_date) values
  ('0a000000-0000-4000-8000-00000000a501', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-000000000030', 'EST-0001', 'Estudiante', 'Uno', 'CL', 'RUN', 'TEST-1001', 'estudiante1.a@demo.sematec.test', '2004-03-10'),
  ('0a000000-0000-4000-8000-00000000a502', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-000000000031', 'EST-0002', 'Estudiante', 'Dos', 'CL', 'RUN', 'TEST-1002', 'estudiante2.a@demo.sematec.test', '2003-07-21'),
  ('0a000000-0000-4000-8000-00000000a503', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c2',
   '00000000-0000-4000-8000-000000000032', 'EST-0003', 'Estudiante', 'Tres', 'CL', 'RUN', 'TEST-1003', 'estudiante3.a@demo.sematec.test', '2005-01-05'),
  ('0b000000-0000-4000-8000-00000000b501', '0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-000000000051', 'EST-B001', 'Estudiante', 'B Uno', 'PE', 'DNI', 'TEST-2001', 'estudiante1.b@demo.sematec.test', '2002-11-30');

insert into public.enrollments (organization_id, campus_id, student_id, program_id, curriculum_id, period_id) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-00000000a501', '0a000000-0000-4000-8000-00000000a9a1', '0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-00000000ae01'),
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-00000000a502', '0a000000-0000-4000-8000-00000000a9a1', '0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-00000000ae01'),
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c2', '0a000000-0000-4000-8000-00000000a503', '0a000000-0000-4000-8000-00000000a9a1', '0a000000-0000-4000-8000-00000000acc1', '0a000000-0000-4000-8000-00000000ae01'),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000c1', '0b000000-0000-4000-8000-00000000b501', '0b000000-0000-4000-8000-00000000b9a1', '0b000000-0000-4000-8000-00000000bcc1', '0b000000-0000-4000-8000-00000000be01');

insert into public.certificate_templates (id, organization_id, code, name, certificate_type, title_template) values
  ('0a000000-0000-4000-8000-00000000ce01', '0a000000-0000-4000-8000-000000000001', 'APROB-ASIG', 'Aprobación de asignatura', 'course_completion', 'Certificado de aprobación: {{course}}'),
  ('0a000000-0000-4000-8000-00000000ce02', '0a000000-0000-4000-8000-000000000001', 'ALUMNO-REG', 'Alumno regular', 'enrollment', 'Certificado de alumno regular: {{program}}'),
  ('0a000000-0000-4000-8000-00000000ce03', '0a000000-0000-4000-8000-000000000001', 'ASIST-CONF', 'Asistencia a conferencia', 'conference_attendance', 'Certificado de asistencia');

insert into public.conference_rooms (id, organization_id, campus_id, section_id, name, room_type, max_participants) values
  ('0a000000-0000-4000-8000-00000000cf01', '0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c1',
   '0a000000-0000-4000-8000-00000000ad03', 'Aula virtual Bases de Datos', 'class', 3);

-- Sitio web público y catálogo de demostración (institución A)
insert into public.site_settings (organization_id, site_name, tagline, hero_title, hero_subtitle, about_text, mission, vision, highlights,
  contact_email, contact_phone, whatsapp, address, office_hours, social_links, terms_text, privacy_text, is_published)
values ('0a000000-0000-4000-8000-000000000001', 'SEMATEC ACADEMY', 'Formación técnica y profesional con certificación verificable',
  'Aprende tecnología con docentes de la industria', 'Cursos en línea y presenciales, clases en vivo, notas y certificados en una sola plataforma.',
  'SEMATEC ACADEMY es una institución dedicada a la formación técnica en informática, bases de datos y gestión. Nuestros cursos combinan clases en vivo, material en línea y evaluación continua.',
  'Formar profesionales competentes, éticos y preparados para el mundo digital.', 'Ser referentes en formación técnica en Latinoamérica.',
  '[{"title":"Clases en vivo","text":"Aulas virtuales con audio, video y pantalla compartida."},{"title":"Certificados verificables","text":"Cada certificado tiene código QR comprobable en línea."},{"title":"Pago seguro","text":"Webpay, Mercado Pago, Flow o tarjeta internacional."}]',
  'contacto@demo.sematec.test', '+56 2 2345 6789', '+56 9 1234 5678', 'Av. Demo 123, Santiago', 'Lunes a viernes 9:00 a 18:00',
  '{"instagram":"https://instagram.com/","facebook":"https://facebook.com/"}',
  'Términos de prueba: la inscripción se confirma con el pago aprobado.', 'Los datos personales se usan solo para fines académicos y administrativos.', true)
on conflict (organization_id) do nothing;

insert into public.catalog_offerings (organization_id, slug, title, summary, description, category, modality, duration_text, schedule_text,
  starts_on, price, currency, admission_mode, program_id, period_id, is_published, sort_order) values
 ('0a000000-0000-4000-8000-000000000001', 'sql-desde-cero', 'SQL desde cero', 'Consultas, joins y modelado relacional con ejercicios reales.',
  'Curso práctico de SQL: SELECT, filtros, agregaciones, JOIN, subconsultas y diseño de tablas. Incluye clases en vivo y certificado.',
  'Curso', 'online', '6 semanas · 24 horas', 'Martes y jueves 19:00', '2026-12-01', 89000, 'CLP', 'direct',
  '0a000000-0000-4000-8000-00000000a9a1', '0a000000-0000-4000-8000-00000000ae01', true, 1),
 ('0a000000-0000-4000-8000-000000000001', 'tecnico-informatica', 'Técnico en Informática', 'Carrera técnica de 4 semestres con admisión.',
  'Programa completo con malla curricular, prácticas y titulación. Requiere postulación.',
  'Carrera', 'hybrid', '4 semestres', 'Vespertino', '2027-03-01', 450000, 'CLP', 'application',
  '0a000000-0000-4000-8000-00000000a9a1', '0a000000-0000-4000-8000-00000000ae01', true, 2)
on conflict do nothing;
