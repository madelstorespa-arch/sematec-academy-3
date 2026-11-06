-- =====================================================================
-- Migración 004 · Catálogo de permisos y roles base del sistema
-- §3 del documento maestro: perfiles iniciales y operaciones explícitas
-- (ver, crear, editar, aprobar, anular, exportar, administrar)
-- =====================================================================

insert into public.permissions (code, module, action, description)
select m.module || '.' || a.action, m.module, a.action, m.label || ' · ' || a.label
from (values
  ('organization', 'Institución, sedes y estructura'),
  ('settings',     'Configuración institucional'),
  ('security',     'Roles, membresías y cuentas'),
  ('users',        'Usuarios y perfiles'),
  ('audit',        'Auditoría y eventos'),
  ('admissions',   'CRM de admisión y postulaciones'),
  ('students',     'Estudiantes y expedientes'),
  ('teachers',     'Profesores'),
  ('employees',    'Personal y RR. HH.'),
  ('academic',     'Programas, mallas, cursos y periodos'),
  ('sections',     'Secciones y horarios'),
  ('enrollments',  'Matrículas e inscripciones'),
  ('attendance',   'Asistencia'),
  ('grades',       'Evaluaciones y calificaciones'),
  ('finance',      'Aranceles, cuotas y pagos'),
  ('certificates', 'Certificados'),
  ('conferences',  'Conferencias virtuales'),
  ('documents',    'Gestión documental'),
  ('reports',      'Reportes e indicadores')
) as m(module, label)
cross join (values
  ('view','Ver'), ('create','Crear'), ('edit','Editar'), ('approve','Aprobar'),
  ('void','Anular'), ('export','Exportar'), ('admin','Administrar')
) as a(action, label);

-- Roles plantilla (organization_id null). Cada institución puede crear roles propios.
insert into public.roles (organization_id, code, name, is_system, requires_mfa) values
  (null, 'propietario_institucional', 'Propietario institucional', true, true),
  (null, 'rector',               'Rector',                    true, true),
  (null, 'director_general',     'Director general',          true, true),
  (null, 'director_academico',   'Director académico',        true, true),
  (null, 'director_financiero',  'Director financiero',       true, true),
  (null, 'administrador_sede',   'Administrador de sede',     true, true),
  (null, 'coordinador',          'Coordinador académico',     true, false),
  (null, 'secretaria',           'Secretaría académica',      true, false),
  (null, 'admision',             'Admisión',                  true, false),
  (null, 'matriculas',           'Matrículas',                true, false),
  (null, 'contabilidad',         'Contabilidad',              true, true),
  (null, 'tesoreria',            'Tesorería',                 true, true),
  (null, 'recursos_humanos',     'Recursos humanos',          true, true),
  (null, 'profesor',             'Profesor',                  true, false),
  (null, 'tutor',                'Tutor',                     true, false),
  (null, 'bibliotecario',        'Bibliotecario',             true, false),
  (null, 'estudiante',           'Estudiante',                true, false),
  (null, 'postulante',           'Postulante',                true, false),
  (null, 'egresado',             'Egresado',                  true, false),
  (null, 'auditor',              'Auditor',                   true, true),
  (null, 'soporte_tecnico',      'Soporte técnico',           true, true),
  (null, 'organizador_eventos',  'Organizador de eventos',    true, false),
  (null, 'moderador',            'Moderador',                 true, false),
  (null, 'presentador',          'Presentador',               true, false);

-- Asignación de permisos por patrón: (rol, módulos, acciones)
with grants(role_code, modules, actions) as (values
  ('propietario_institucional', null::text[], null::text[]),          -- todos
  ('rector',              null, array['view','approve','export']),
  ('director_general',    array['organization','settings','users','academic','sections','students','teachers','employees','enrollments','attendance','grades','finance','certificates','conferences','documents','reports','admissions'], array['view','create','edit','approve','export']),
  ('director_academico',  array['academic','sections','students','teachers','enrollments','attendance','grades','certificates','conferences','documents','reports','admissions','users'], array['view','create','edit','approve','void','export']),
  ('director_financiero', array['finance','reports','students','enrollments'], array['view','create','edit','approve','void','export','admin']),
  ('administrador_sede',  array['organization','students','teachers','sections','enrollments','attendance','documents','conferences','reports','users'], array['view','create','edit','approve','export']),
  ('coordinador',         array['academic','sections','students','teachers','enrollments','attendance','grades','conferences','reports'], array['view','create','edit','export']),
  ('secretaria',          array['students','enrollments','attendance','documents','certificates','academic','sections'], array['view','create','edit']),
  ('admision',            array['admissions','students','documents'], array['view','create','edit','approve']),
  ('matriculas',          array['enrollments','students','sections','academic','finance'], array['view','create','edit']),
  ('contabilidad',        array['finance','reports'], array['view','export']),
  ('tesoreria',           array['finance','students'], array['view','create','edit','void','export']),
  ('recursos_humanos',    array['employees','teachers','users'], array['view','create','edit','export']),
  ('profesor',            array['conferences'], array['view','create']),
  ('tutor',               array['students','attendance'], array['view']),
  ('bibliotecario',       array['documents'], array['view','create','edit']),
  ('auditor',             null, array['view','export']),
  ('soporte_tecnico',     array['organization','settings','conferences'], array['view']),   -- sin datos personales
  ('organizador_eventos', array['conferences'], array['view','create','edit','admin']),
  ('moderador',           array['conferences'], array['view','edit']),
  ('presentador',         array['conferences'], array['view'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from grants g
join public.roles r on r.code = g.role_code and r.organization_id is null
join public.permissions p
  on (g.modules is null or p.module = any(g.modules))
 and (g.actions is null or p.action = any(g.actions));

-- Ajustes finos
delete from public.role_permissions rp using public.roles r
 where rp.role_id = r.id and r.organization_id is null
   and r.code in ('rector','auditor')
   and rp.permission_code in ('security.approve','security.export');
insert into public.role_permissions (role_id, permission_code)
select id, unnest(array['audit.view','audit.export']) from public.roles
 where organization_id is null and code in ('director_general','rector')
on conflict do nothing;
-- Administradores institucionales gestionan seguridad (con MFA obligatoria)
insert into public.role_permissions (role_id, permission_code)
select id, unnest(array['security.admin','users.view','users.create','users.edit','settings.admin','organization.admin'])
  from public.roles where organization_id is null and code in ('director_general')
on conflict do nothing;
