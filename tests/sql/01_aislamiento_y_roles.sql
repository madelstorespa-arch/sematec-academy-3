-- Criterios 01-05: autenticación, aislamiento entre instituciones, roles en BD
begin;

-- Sin sesión (anon) no se ve nada
select tests.anon(); set local role anon;
select tests.fails($q$ select * from public.students $q$, 'anon no puede leer estudiantes', '42501');
select tests.fails($q$ select * from public.organizations $q$, 'anon no puede leer instituciones', '42501');
reset role;

-- Propietario de A: ve solo su institución
select tests.login(tests.id('owner_a'), 'aal2'); set local role authenticated;
select tests.ok(tests.visible('select * from public.organizations') = 1, 'Propietario A ve solo 1 institución');
select tests.ok(tests.visible('select * from public.students') = 3, 'Propietario A ve sus 3 estudiantes');
select tests.ok(tests.visible($q$ select * from public.students where organization_id = tests.id('org_b') $q$) = 0,
                'Propietario A NO ve estudiantes de B');
select tests.fails($q$ insert into public.students (organization_id, student_code, first_names, last_names,
                     id_document_country, id_document_type, id_document_number)
                   values (tests.id('org_b'), 'X-1', 'Intruso', 'Cruzado', 'PE', 'DNI', 'TEST-9999') $q$,
                   'Propietario A no puede crear estudiantes en B', '42501');
select tests.ok(tests.visible($q$ select 1 from public.students where id = tests.id('estb1') $q$) = 0,
                'Lectura directa por id de B devuelve vacío');
update public.students set first_names = 'Hackeado' where id = tests.id('estb1');
reset role;
select tests.ok((select first_names from public.students where id = tests.id('estb1')) = 'Estudiante',
                'UPDATE cruzado no modificó el registro de B');

-- Validaciones de formulario en la base de datos
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.fails($q$ insert into public.students (organization_id, campus_id, student_code, first_names, last_names,
                     id_document_country, id_document_type, id_document_number, email)
                   values (tests.id('org_a'), tests.id('campus_a1'), 'EST-9', 'Mal', 'Correo', 'CL', 'RUN', 'TEST-77', 'no-es-correo') $q$,
                   'Correo inválido rechazado', '23514');
select tests.fails($q$ insert into public.students (organization_id, campus_id, student_code, first_names, last_names,
                     id_document_country, id_document_type, id_document_number)
                   values (tests.id('org_a'), tests.id('campus_a1'), 'EST-0001', 'Codigo', 'Repetido', 'CL', 'RUN', 'TEST-78') $q$,
                   'Código de estudiante duplicado rechazado', '23505');
select tests.fails($q$ insert into public.students (organization_id, campus_id, student_code, first_names, last_names,
                     id_document_country, id_document_type, id_document_number)
                   values (tests.id('org_a'), tests.id('campus_a1'), 'EST-10', 'Doc', 'Repetido', 'CL', 'RUN', 'TEST-1001') $q$,
                   'Documento de identidad duplicado rechazado', '23505');
insert into public.students (organization_id, campus_id, student_code, first_names, last_names,
                             id_document_country, id_document_type, id_document_number, email)
values (tests.id('org_a'), tests.id('campus_a1'), 'EST-0100', 'Nuevo', 'Alumno', 'CL', 'RUN', 'TEST-1100', 'nuevo@demo.sematec.test');
select tests.ok(tests.visible($q$ select 1 from public.students where student_code = 'EST-0100' $q$) = 1, 'Secretaría registra estudiante válido');
-- Restricción por sede: la secretaría es de Santiago
select tests.ok(tests.visible($q$ select 1 from public.students where id = tests.id('est3') $q$) = 0,
                'Secretaría de Santiago no ve estudiante de Valparaíso');
select tests.fails($q$ insert into public.students (organization_id, campus_id, student_code, first_names, last_names,
                     id_document_country, id_document_type, id_document_number)
                   values (tests.id('org_a'), tests.id('campus_a2'), 'EST-0101', 'Otra', 'Sede', 'CL', 'RUN', 'TEST-1101') $q$,
                   'Secretaría no registra en otra sede', '42501');
select tests.fails($q$ delete from public.students where student_code = 'EST-0100' $q$, 'No se permite borrar estudiantes', '42501');
reset role;

-- Estudiante: solo se ve a sí mismo
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 1, 'Estudiante ve solo su propio registro');
select tests.ok(tests.visible('select * from public.enrollments') = 1, 'Estudiante ve solo su matrícula');
select tests.ok(tests.visible('select * from public.payments') = 0, 'Estudiante no ve pagos ajenos');
update public.students set status = 'graduated' where id = tests.id('est1');  -- RLS: 0 filas afectadas
reset role;
select tests.ok((select status from public.students where id = tests.id('est1')) = 'active', 'Estudiante no puede editar su expediente (intacto)');

-- Profesor: ve a sus alumnos inscritos, no a todos
select tests.login(tests.id('prof2_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 0, 'Profesor sin alumnos inscritos no ve estudiantes');
select tests.fails($q$ select public.create_charge(tests.id('est1'), 'tuition', 1000, 'CLP', 1, current_date) $q$,
                   'Profesor no puede crear cargos', '42501');
reset role;

-- Soporte técnico: sin acceso automático a datos personales
select tests.login(tests.id('soporte_a'), 'aal2'); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 0, 'Soporte técnico no ve estudiantes');
select tests.ok(tests.visible('select * from public.payments') = 0, 'Soporte técnico no ve pagos');
select tests.ok(tests.visible('select * from public.organizations') = 1, 'Soporte técnico ve la configuración institucional');
reset role;

-- Cuenta suspendida pierde todo acceso al instante
update public.profiles set status = 'suspended' where id = tests.id('secretaria_a');
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 0, 'Cuenta suspendida no ve datos');
reset role;
update public.profiles set status = 'active' where id = tests.id('secretaria_a');

-- Membresía vencida
update public.memberships set valid_until = now() - interval '1 second', valid_from = now() - interval '1 day'
 where user_id = tests.id('secretaria_a');
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 0, 'Membresía vencida no da acceso');
reset role;

rollback;
