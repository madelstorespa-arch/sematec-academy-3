-- Criterios 06-08: programa/curso/sección/horario, matrícula, asistencia y notas
begin;

-- Coordinación académica crea curso, sección y horario con control de choques
select tests.login(tests.id('director_a'), 'aal2'); set local role authenticated;
insert into public.courses (id, organization_id, code, name, credits, weekly_hours)
values ('0a000000-0000-4000-8000-00000000ac09', tests.id('org_a'), 'RED101', 'Redes I', 8, 4);
insert into public.sections (id, organization_id, campus_id, course_id, period_id, code, teacher_id, grade_scale_id, capacity)
values ('0a000000-0000-4000-8000-00000000ad09', tests.id('org_a'), tests.id('campus_a1'), '0a000000-0000-4000-8000-00000000ac09',
        tests.id('period_a'), 'S1', tests.id('prof1'), tests.id('scale_a'), 20);
select tests.fails($q$ insert into public.section_schedules (organization_id, section_id, weekday, time_slot, room_id)
                   values (tests.id('org_a'), '0a000000-0000-4000-8000-00000000ad09', 1, '[09:00,10:30)', tests.id('room_lab1')) $q$,
                   'Choque de horario del profesor rechazado', '23P01');
select tests.fails($q$ insert into public.section_schedules (organization_id, section_id, weekday, time_slot, room_id, teacher_id)
                   values (tests.id('org_a'), '0a000000-0000-4000-8000-00000000ad09', 1, '[09:00,10:30)', tests.id('room_a101'), tests.id('prof2')) $q$,
                   'Choque de sala rechazado', '23P01');
insert into public.section_schedules (organization_id, section_id, weekday, time_slot, room_id)
values (tests.id('org_a'), '0a000000-0000-4000-8000-00000000ad09', 1, '[10:00,11:30)', tests.id('room_a101'));
select tests.ok(true, 'Horario sin conflicto aceptado (bloque contiguo 10:00)');
insert into public.sections (id, organization_id, campus_id, course_id, period_id, code, teacher_id, grade_scale_id, capacity)
values ('0a000000-0000-4000-8000-00000000ad08', tests.id('org_a'), tests.id('campus_a1'), '0a000000-0000-4000-8000-00000000ac09',
        tests.id('period_a'), 'S2', tests.id('prof2'), tests.id('scale_a'), 20);
insert into public.section_schedules (organization_id, section_id, weekday, time_slot, room_id)
values (tests.id('org_a'), '0a000000-0000-4000-8000-00000000ad08', 1, '[09:00,10:00)', tests.id('room_lab1'));
select tests.fails($q$ insert into public.sections (organization_id, campus_id, course_id, period_id, code, grade_scale_id, capacity)
                   values (tests.id('org_a'), tests.id('campus_a1'), (select id from public.courses where organization_id = tests.id('org_a') limit 1),
                           tests.id('period_b'), 'X', tests.id('scale_a'), 10) $q$,
                   'Sección no puede apuntar a un periodo de otra institución', null);
reset role;

-- Inscripción con cupos (capacidad 2), duplicados, prerrequisitos y choques
select tests.login(tests.id('matriculas_a')); set local role authenticated;
select public.register_section(tests.id('est1'), tests.id('sec_prg101'));
select public.register_section(tests.id('est2'), tests.id('sec_prg101'));
select tests.ok((select count(*) from public.section_enrollments where section_id = tests.id('sec_prg101')) = 2, 'Dos alumnos inscritos');
select tests.fails($q$ select public.register_section(tests.id('est3'), tests.id('sec_prg101')) $q$, 'Sobrecupo rechazado', '23514');
select tests.fails($q$ select public.register_section(tests.id('est1'), tests.id('sec_prg101')) $q$, 'Inscripción duplicada rechazada', '23505');
select tests.fails($q$ select public.register_section(tests.id('est1'), tests.id('sec_prg201')) $q$, 'Prerrequisito pendiente rechazado', '23514');
select tests.fails($q$ select public.register_section(tests.id('est1'), '0a000000-0000-4000-8000-00000000ad08') $q$,
                   'Choque de horario del estudiante rechazado', '23P01');
select tests.fails($q$ select public.register_section(tests.id('estb1'), tests.id('sec_bdd101')) $q$,
                   'Estudiante de otra institución no se inscribe', null);
select public.register_section(tests.id('est1'), tests.id('sec_bdd101'));
select public.register_section(tests.id('est2'), tests.id('sec_bdd101'));
select public.register_section(tests.id('est3'), tests.id('sec_bdd101'));
reset role;

-- Autoinscripción del estudiante (periodo abierto)
select tests.login(tests.id('est3_u')); set local role authenticated;
select tests.fails($q$ select public.register_section(tests.id('est1'), '0a000000-0000-4000-8000-00000000ad09') $q$,
                   'Estudiante no inscribe a otro', '42501');
select public.register_section(tests.id('est3'), '0a000000-0000-4000-8000-00000000ad09');
select tests.ok(tests.visible('select * from public.section_enrollments') = 2, 'Estudiante se autoinscribe y ve solo sus inscripciones');
reset role;

-- Profesor: libro de clases y asistencia de su sección
select tests.login(tests.id('prof2_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 3, 'Profesor ve a sus 3 alumnos inscritos');
insert into public.class_sessions (id, organization_id, section_id, starts_at, ends_at, topic)
select ('0a000000-0000-4000-8000-0000000c500' || n)::uuid, tests.id('org_a'), tests.id('sec_bdd101'),
       timestamptz '2026-09-01 10:00-03' + (n || ' weeks')::interval, timestamptz '2026-09-01 11:30-03' + (n || ' weeks')::interval,
       'Clase ' || n
from generate_series(1, 4) n;
-- est1: 4 presentes = 100 %; est2: 2 presentes, 1 atraso, 1 ausente = 75 %; est3: 1 presente, 3 ausentes = 25 %
insert into public.attendance_records (organization_id, class_session_id, student_id, status)
select tests.id('org_a'), ('0a000000-0000-4000-8000-0000000c500' || n)::uuid, st, s::public.attendance_status
from (values
  (1, tests.id('est1'), 'present'), (2, tests.id('est1'), 'present'), (3, tests.id('est1'), 'present'), (4, tests.id('est1'), 'present'),
  (1, tests.id('est2'), 'present'), (2, tests.id('est2'), 'late'),    (3, tests.id('est2'), 'absent'),  (4, tests.id('est2'), 'present'),
  (1, tests.id('est3'), 'present'), (2, tests.id('est3'), 'absent'),  (3, tests.id('est3'), 'absent'),  (4, tests.id('est3'), 'absent')
) v(n, st, s);
select tests.ok(public.attendance_pct(tests.id('sec_bdd101'), tests.id('est2')) = 75.00, 'Asistencia calculada: 75 %');
select tests.fails($q$ insert into public.attendance_records (organization_id, class_session_id, student_id, status)
                   values (tests.id('org_a'), '0a000000-0000-4000-8000-0000000c5001', tests.id('estb1'), 'present') $q$,
                   'No se registra asistencia de alumno no inscrito', null);

-- Evaluaciones: ponderaciones y notas dentro de escala
insert into public.assessments (id, organization_id, section_id, name, weight_pct, published) values
  ('0a000000-0000-4000-8000-0000000e5001', tests.id('org_a'), tests.id('sec_bdd101'), 'Prueba 1', 30, true),
  ('0a000000-0000-4000-8000-0000000e5002', tests.id('org_a'), tests.id('sec_bdd101'), 'Prueba 2', 30, true),
  ('0a000000-0000-4000-8000-0000000e5003', tests.id('org_a'), tests.id('sec_bdd101'), 'Proyecto', 40, false);
select tests.fails($q$ insert into public.assessments (organization_id, section_id, name, weight_pct)
                   values (tests.id('org_a'), tests.id('sec_bdd101'), 'Extra', 10) $q$, 'Ponderaciones > 100 % rechazadas', '23514');
select tests.fails($q$ insert into public.grades (organization_id, assessment_id, student_id, grade)
                   values (tests.id('org_a'), '0a000000-0000-4000-8000-0000000e5001', tests.id('est1'), 7.5) $q$,
                   'Nota fuera de la escala 1.0-7.0 rechazada', '23514');
insert into public.grades (organization_id, assessment_id, student_id, grade)
select tests.id('org_a'), a::uuid, st, g from (values
  ('0a000000-0000-4000-8000-0000000e5001', tests.id('est1'), 6.0), ('0a000000-0000-4000-8000-0000000e5002', tests.id('est1'), 5.0), ('0a000000-0000-4000-8000-0000000e5003', tests.id('est1'), 6.5),
  ('0a000000-0000-4000-8000-0000000e5001', tests.id('est2'), 4.0), ('0a000000-0000-4000-8000-0000000e5002', tests.id('est2'), 3.0), ('0a000000-0000-4000-8000-0000000e5003', tests.id('est2'), 4.5),
  ('0a000000-0000-4000-8000-0000000e5001', tests.id('est3'), 6.0), ('0a000000-0000-4000-8000-0000000e5002', tests.id('est3'), 6.0)
) v(a, st, g);
select tests.fails($q$ select public.close_section_grades(tests.id('sec_bdd101')) $q$, 'Acta no cierra con notas faltantes', '23514');
insert into public.grades (organization_id, assessment_id, student_id, grade)
values (tests.id('org_a'), '0a000000-0000-4000-8000-0000000e5003', tests.id('est3'), 6.0);
update public.grades set grade = 6.8 where assessment_id = '0a000000-0000-4000-8000-0000000e5003' and student_id = tests.id('est1');
reset role;

-- Otro profesor no puede calificar esta sección
select tests.login(tests.id('prof1_u')); set local role authenticated;
update public.grades set grade = 1.0 where student_id = tests.id('est1');
select tests.ok(tests.visible($q$ select 1 from public.grades where assessment_id = '0a000000-0000-4000-8000-0000000e5001' $q$) = 0,
                'Profesor ajeno no ve ni modifica notas de otra sección');
reset role;

-- El estudiante ve solo sus notas publicadas
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.grades') = 2, 'Estudiante ve solo sus 2 notas publicadas (proyecto oculto)');
select tests.fails($q$ insert into public.grades (organization_id, assessment_id, student_id, grade)
                   values (tests.id('org_a'), '0a000000-0000-4000-8000-0000000e5003', tests.id('est1'), 7.0) $q$,
                   'Estudiante no puede ponerse notas', '42501');
reset role;

-- Cierre de acta: promedio ponderado, asistencia y resultado
select tests.login(tests.id('prof2_u')); set local role authenticated;
select * from public.close_section_grades(tests.id('sec_bdd101'));
reset role;
-- est1: 6.0*0.3 + 5.0*0.3 + 6.8*0.4 = 6.02 -> 6.0 aprobado
-- est2: 4.0*0.3 + 3.0*0.3 + 4.5*0.4 = 3.9 -> reprobado
-- est3: 6.0 promedio, 25 % asistencia -> reprobado por asistencia
select tests.ok((select final_grade from public.academic_records where student_id = tests.id('est1') and section_id = tests.id('sec_bdd101')) = 6.0
            and (select result from public.academic_records where student_id = tests.id('est1') and section_id = tests.id('sec_bdd101')) = 'approved',
                'est1: nota final 6.0 aprobado');
select tests.ok((select final_grade from public.academic_records where student_id = tests.id('est2') and section_id = tests.id('sec_bdd101')) = 3.9
            and (select result from public.academic_records where student_id = tests.id('est2') and section_id = tests.id('sec_bdd101')) = 'failed',
                'est2: nota final 3.9 reprobado');
select tests.ok((select result from public.academic_records where student_id = tests.id('est3') and section_id = tests.id('sec_bdd101')) = 'failed'
            and (select attendance_pct from public.academic_records where student_id = tests.id('est3') and section_id = tests.id('sec_bdd101')) = 25.00,
                'est3: reprobado por asistencia 25 % (< 75 %)');

-- Acta cerrada: el profesor ya no puede modificar
select tests.login(tests.id('prof2_u')); set local role authenticated;
select tests.fails($q$ update public.grades set grade = 7.0 where student_id = tests.id('est2') $q$, 'Acta cerrada bloquea cambios del profesor', '42501');
select tests.fails($q$ update public.attendance_records set status = 'present' where student_id = tests.id('est3') $q$,
                   'Acta cerrada bloquea cambios de asistencia', '42501');
select tests.fails($q$ select public.amend_grade((select id from public.grades where student_id = tests.id('est2') limit 1), 7.0, 'Quiero cambiarla') $q$,
                   'Profesor no puede rectificar sin permiso', '42501');
reset role;

-- Rectificación autorizada (director con MFA y motivo) deja historial
select tests.login(tests.id('director_a'), 'aal2'); set local role authenticated;
select public.amend_grade((select id from public.grades where student_id = tests.id('est2') and assessment_id = '0a000000-0000-4000-8000-0000000e5002'),
                          4.0, 'Error de digitación verificado con la prueba física');
reset role;
select tests.ok((select final_grade from public.academic_records where student_id = tests.id('est2') and section_id = tests.id('sec_bdd101')) = 4.2
            and (select result from public.academic_records where student_id = tests.id('est2') and section_id = tests.id('sec_bdd101')) = 'approved',
                'Rectificación recalcula: est2 4.2 aprobado');
select tests.ok((select count(*) from public.grade_history gh join public.grades g on g.id = gh.grade_id
                  where g.student_id = tests.id('est2') and g.assessment_id = '0a000000-0000-4000-8000-0000000e5002') = 2
            and exists (select 1 from public.grade_history where reason like 'Error de digitación%'),
                'Historial de notas conserva valor anterior y motivo');
select tests.fails($q$ delete from public.grade_history $q$, 'Historial de notas inmutable', '42501');

-- Requisitos de egreso y prerrequisito ya aprobado habilita PRG201
select tests.login(tests.id('director_a'), 'aal2'); set local role authenticated;
select tests.ok(not (select eligible from public.graduation_status(
                       (select id from public.enrollments where student_id = tests.id('est1')))),
                'est1 aún no cumple requisitos de egreso (faltan asignaturas)');
select tests.ok((select missing_courses from public.graduation_status(
                       (select id from public.enrollments where student_id = tests.id('est1')))) = array['PRG101','PRG201'],
                'Lista de asignaturas pendientes correcta');
reset role;

rollback;
