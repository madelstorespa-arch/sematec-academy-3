-- Criterios 10-11 y RF-010/011/048/052: certificados, conferencias, documentos, Storage, postulaciones, reportes
begin;

-- Preparación: inscripciones en Bases de Datos y aprobación de est1
select tests.login(tests.id('matriculas_a')); set local role authenticated;
select public.register_section(tests.id('est1'), tests.id('sec_bdd101'));
select public.register_section(tests.id('est2'), tests.id('sec_bdd101'));
select public.register_section(tests.id('est3'), tests.id('sec_bdd101'));
reset role;
update public.academic_records set result = 'approved', final_grade = 6.5, closed_at = now()
 where student_id = tests.id('est1') and section_id = tests.id('sec_bdd101');

-- ============================ CERTIFICADOS ============================
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select set_config('t.cert', public.issue_certificate(tests.id('tpl_course'), tests.id('est1'), tests.id('bdd101'))::text, false);
select tests.ok((select title from public.certificates where id = current_setting('t.cert')::uuid) = 'Certificado de aprobación: Bases de Datos',
                'Certificado de aprobación emitido');
select tests.fails($q$ select public.issue_certificate(tests.id('tpl_course'), tests.id('est2'), tests.id('bdd101')) $q$,
                   'No se certifica una asignatura no aprobada', '23514');
select tests.fails($q$ select public.issue_certificate(tests.id('tpl_course'), tests.id('estb1'), tests.id('bdd101')) $q$,
                   'No se certifica a estudiantes de otra institución', '42501');
select tests.ok(public.issue_certificate(tests.id('tpl_regular'), tests.id('est2'), null,
                (select id from public.enrollments where student_id = tests.id('est2'))) is not null,
                'Certificado de alumno regular con matrícula activa');
reset role;
select set_config('t.code', (select verification_code from public.certificates where id = current_setting('t.cert')::uuid), false);

-- Configuración institucional sin código: bloquear certificados con deuda vencida
select tests.login(tests.id('tesoreria_a'), 'aal2'); set local role authenticated;
select public.create_charge(tests.id('est2'), 'tuition', 50000, 'CLP', 1, date '2026-01-10');
reset role;
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.fails($q$ select public.issue_certificate(tests.id('tpl_regular'), tests.id('est2'), null,
                     (select id from public.enrollments where student_id = tests.id('est2'))) $q$,
                   'Regla configurable: deuda vencida bloquea certificados', '23514');
reset role;

-- Verificación pública (QR) sin sesión
select tests.anon(); set local role anon;
select tests.ok((public.verify_certificate(current_setting('t.code')) ->> 'valid')::boolean, 'Verificación pública: certificado válido e íntegro');
select tests.ok(public.verify_certificate('AAAA-BBBB-CCCC-DDDD') ->> 'status' = 'not_found', 'Código inexistente: not_found');
select tests.fails($q$ select * from public.certificates $q$, 'Anónimo no lista certificados', '42501');
reset role;
select tests.ok((select count(*) from public.credential_verifications) = 2, 'Cada verificación queda registrada');

-- El certificado es inalterable; solo se revoca con permiso, MFA y motivo
select tests.fails($q$ update public.certificates set recipient_name = 'Otra Persona' where id = current_setting('t.cert')::uuid $q$,
                   'Ni el superusuario altera un certificado emitido', '42501');
select tests.fails($q$ delete from public.certificates where id = current_setting('t.cert')::uuid $q$, 'Certificados no se eliminan', '42501');
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.fails($q$ select public.revoke_certificate(current_setting('t.cert')::uuid, 'Error de emisión') $q$,
                   'Secretaría no puede revocar', '42501');
reset role;
select tests.login(tests.id('director_a'), 'aal2'); set local role authenticated;
select public.revoke_certificate(current_setting('t.cert')::uuid, 'Emitido con datos erróneos');
reset role;
select tests.anon(); set local role anon;
select tests.ok(public.verify_certificate(current_setting('t.code')) ->> 'status' = 'revoked', 'Verificación muestra certificado revocado');
reset role;
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.certificates') = 1, 'Estudiante ve su certificado');
reset role;

-- ============================ CONFERENCIAS ============================
select tests.login(tests.id('prof2_u')); set local role authenticated;
insert into public.class_sessions (id, organization_id, section_id, starts_at, ends_at, topic)
values ('0a000000-0000-4000-8000-0000000c5101', tests.id('org_a'), tests.id('sec_bdd101'),
        timestamptz '2026-09-08 10:00-03', timestamptz '2026-09-08 11:00-03', 'Clase virtual: normalización');
select tests.fails($q$ select public.create_conference_session(tests.id('croom_bdd'), 'X', 'class', now(), now() + interval '1 hour', 'Marte/Olympus') $q$,
                   'Zona horaria inválida rechazada', '22023');
-- Sesión en curso (para autorizaciones de ingreso)
select set_config('t.live', public.create_conference_session(tests.id('croom_bdd'), 'Clase en vivo', 'class',
                  now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true)::text, false);
-- Sesión histórica vinculada al libro de clases (para cálculo de asistencia)
select set_config('t.past', public.create_conference_session(tests.id('croom_bdd'), 'Normalización', 'class',
                  timestamptz '2026-09-08 10:00-03', timestamptz '2026-09-08 11:00-03', 'America/Santiago', false,
                  '0a000000-0000-4000-8000-0000000c5101')::text, false);
select public.ban_conference_participant(current_setting('t.live')::uuid, tests.id('est2_u'), 'Conducta inapropiada en el chat');
select tests.fails($q$ select public.add_conference_participant(current_setting('t.live')::uuid, tests.id('estb1_u'), 'attendee') $q$,
                   'No se invita a usuarios de otra institución', '42501');
reset role;

select tests.login(tests.id('est1_u')); set local role authenticated;
select set_config('t.auth', public.authorize_conference_join(current_setting('t.live')::uuid)::text, false);
select tests.ok((current_setting('t.auth')::jsonb ->> 'allowed')::boolean and current_setting('t.auth')::jsonb ->> 'role' = 'student',
                'Alumno inscrito autorizado como student');
select tests.ok((current_setting('t.auth')::jsonb #>> '{grants,roomAdmin}')::boolean = false
            and current_setting('t.auth')::jsonb #> '{grants,canPublishSources}' = '["camera","microphone"]'::jsonb,
                'Alumno: audio/video sí, administración y pantalla no');
select tests.ok((current_setting('t.auth')::jsonb ->> 'expires_at')::timestamptz <= now() + interval '2 hours', 'Token temporal (máx. 2 h)');
select tests.fails($q$ select public.ban_conference_participant(current_setting('t.live')::uuid, tests.id('est3_u'), 'x') $q$,
                   'Alumno no puede expulsar participantes', '42501');
select tests.ok(tests.visible('select * from public.conference_access_grants') = 0, 'Alumno no lee registros de tokens');
reset role;
select tests.login(tests.id('prof2_u')); set local role authenticated;
select tests.ok((public.authorize_conference_join(current_setting('t.live')::uuid) #>> '{grants,roomAdmin}')::boolean,
                'Profesor de la sección recibe permisos de moderación');
reset role;
select tests.login(tests.id('est2_u')); set local role authenticated;
select tests.ok(public.authorize_conference_join(current_setting('t.live')::uuid) ->> 'reason' = 'banned', 'Participante bloqueado no ingresa');
reset role;
select tests.login(tests.id('estb1_u')); set local role authenticated;
select tests.ok(public.authorize_conference_join(current_setting('t.live')::uuid) ->> 'reason' = 'not_member', 'Usuario de otra institución no ingresa');
reset role;
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.ok(public.authorize_conference_join(current_setting('t.past')::uuid) ->> 'reason' = 'expired', 'Sesión vencida no emite token');
reset role;

-- Webhook de LiveKit (service_role): eventos idempotentes
select tests.service(); set local role service_role;
select set_config('t.room', (select livekit_room_name from public.conference_sessions where id = current_setting('t.live')::uuid), false);
select public.record_conference_event(current_setting('t.room'), 'participant_joined', tests.id('prof2_u'), 'PA_p2', now(), 'ev-1');
select public.record_conference_event(current_setting('t.room'), 'participant_joined', tests.id('est1_u'),  'PA_e1', now(), 'ev-2');
select public.record_conference_event(current_setting('t.room'), 'participant_joined', tests.id('est3_u'),  'PA_e3', now(), 'ev-3');
select public.record_conference_event(current_setting('t.room'), 'participant_joined', tests.id('est3_u'),  'PA_e3', now(), 'ev-3');
reset role;
select tests.ok((select count(*) from public.conference_attendance where session_id = current_setting('t.live')::uuid) = 3,
                'Evento repetido del webhook no duplica la asistencia');
select tests.login(tests.id('prof2_u')); set local role authenticated;
select public.add_conference_participant(current_setting('t.live')::uuid, tests.id('director_a'), 'attendee');
reset role;
select tests.login(tests.id('director_a'), 'aal2'); set local role authenticated;
select tests.ok(public.authorize_conference_join(current_setting('t.live')::uuid) ->> 'reason' = 'room_full', 'Sala llena (capacidad 3) rechaza ingreso');
reset role;
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.fails($q$ select public.record_conference_event('x', 'room_finished', null, null, now(), 'ev-x') $q$,
                   'Usuarios no pueden falsificar eventos del webhook', '42501');
reset role;

-- Sesión histórica: est1 conectado 50 de 60 min (con una reconexión solapada), est3 10 min
select tests.service(); set local role service_role;
select set_config('t.room2', (select livekit_room_name from public.conference_sessions where id = current_setting('t.past')::uuid), false);
select public.record_conference_event(current_setting('t.room2'), 'room_started', null, null, timestamptz '2026-09-08 09:58-03', 'r2-0');
select public.record_conference_event(current_setting('t.room2'), 'participant_joined', tests.id('est1_u'), 'S1', timestamptz '2026-09-08 10:00-03', 'r2-1');
select public.record_conference_event(current_setting('t.room2'), 'participant_left',   tests.id('est1_u'), 'S1', timestamptz '2026-09-08 10:30-03', 'r2-2');
select public.record_conference_event(current_setting('t.room2'), 'participant_joined', tests.id('est1_u'), 'S2', timestamptz '2026-09-08 10:25-03', 'r2-3');
select public.record_conference_event(current_setting('t.room2'), 'participant_left',   tests.id('est1_u'), 'S2', timestamptz '2026-09-08 10:50-03', 'r2-4');
select public.record_conference_event(current_setting('t.room2'), 'participant_joined', tests.id('est3_u'), 'S3', timestamptz '2026-09-08 10:00-03', 'r2-5');
select public.record_conference_event(current_setting('t.room2'), 'participant_left',   tests.id('est3_u'), 'S3', timestamptz '2026-09-08 10:10-03', 'r2-6');
select public.record_conference_event(current_setting('t.room2'), 'room_finished', null, null, timestamptz '2026-09-08 11:01-03', 'r2-7');
reset role;
select tests.ok((select connected_seconds from public.conference_participants
                  where session_id = current_setting('t.past')::uuid and user_id = tests.id('est1_u')) = 3000,
                'Tiempo conectado est1 = 50 min (intervalos solapados unidos)');
select tests.ok((select attended from public.conference_participants where session_id = current_setting('t.past')::uuid and user_id = tests.id('est1_u'))
            and not (select attended from public.conference_participants where session_id = current_setting('t.past')::uuid and user_id = tests.id('est3_u')),
                'Asistencia por regla configurable (75 %): est1 sí, est3 no');
select tests.ok((select array_agg(status::text order by student_id) from public.attendance_records
                  where class_session_id = '0a000000-0000-4000-8000-0000000c5101') = array['present','absent','absent'],
                'Asistencia traspasada automáticamente al libro de clases');
select tests.ok((select status from public.conference_sessions where id = current_setting('t.past')::uuid) = 'ended', 'Sesión finalizada');
-- Certificado de asistencia a conferencia
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.ok(public.issue_certificate(tests.id('tpl_conf'), null, null, null, current_setting('t.past')::uuid, tests.id('est1_u')) is not null,
                'Certificado de asistencia emitido a quien cumplió');
select tests.fails($q$ select public.issue_certificate(tests.id('tpl_conf'), null, null, null, current_setting('t.past')::uuid, tests.id('est3_u')) $q$,
                   'Sin asistencia suficiente no hay certificado', '23514');
reset role;

-- ====================== DOCUMENTOS Y STORAGE ==========================
select tests.login(tests.id('secretaria_a')); set local role authenticated;
insert into public.documents (id, organization_id, campus_id, title, category, owner_type)
values ('0a000000-0000-4000-8000-0000000d0c01', tests.id('org_a'), tests.id('campus_a1'), 'Reglamento académico', 'reglamento', 'organization');
select public.add_document_version('0a000000-0000-4000-8000-0000000d0c01', '0a000000-0000-4000-8000-000000000001/docs/reglamento_v1.pdf',
                                   repeat('a', 64), 120000, 'application/pdf', 'Versión inicial');
select tests.ok(public.add_document_version('0a000000-0000-4000-8000-0000000d0c01', '0a000000-0000-4000-8000-000000000001/docs/reglamento_v2.pdf',
                                   repeat('b', 64), 125000, 'application/pdf', 'Actualización 2026') = 2, 'Versionado: versión 2 sin sobrescribir la 1');
select tests.fails($q$ select public.add_document_version('0a000000-0000-4000-8000-0000000d0c01', '0b000000-0000-4000-8000-000000000001/robado.pdf',
                     repeat('c', 64), 1, 'application/pdf') $q$, 'Ruta de archivo de otra institución rechazada', '23514');
insert into storage.objects (bucket_id, name) values ('institutional-documents', '0a000000-0000-4000-8000-000000000001/docs/reglamento_v1.pdf');
select tests.fails($q$ insert into storage.objects (bucket_id, name) values ('institutional-documents', '0b000000-0000-4000-8000-000000000001/x.pdf') $q$,
                   'Storage: no se sube a la carpeta de otra institución', '42501');
select tests.ok(tests.visible($q$ select 1 from storage.objects where name like '%reglamento_v1.pdf' $q$) = 1, 'Storage: archivo legible por personal autorizado');
reset role;
select tests.fails($q$ update public.document_versions set storage_path = 'x' $q$, 'Versiones de documentos inmutables', '42501');
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.documents') = 0, 'Estudiante no ve documentos internos');
select tests.ok(tests.visible($q$ select 1 from storage.objects where name like '%reglamento_v1.pdf' $q$) = 0, 'Storage: estudiante no lee el archivo');
select tests.fails($q$ insert into storage.objects (bucket_id, name) values ('institutional-documents', '0a000000-0000-4000-8000-000000000001/virus.exe') $q$,
                   'Storage: estudiante no sube archivos institucionales', '42501');
reset role;

-- ========================= POSTULACIONES ==============================
select tests.login(tests.id('postulante')); set local role authenticated;
insert into public.applications (id, organization_id, campus_id, program_id, period_id, applicant_user_id, form_data)
values ('0a000000-0000-4000-8000-0000000a9901', tests.id('org_a'), tests.id('campus_a1'), tests.id('prog_a'), tests.id('period_a'),
        tests.id('postulante'), '{"motivacion":"Quiero estudiar informática"}');
insert into storage.objects (bucket_id, name)
values ('enrollment-documents', '0a000000-0000-4000-8000-000000000001/applications/0a000000-0000-4000-8000-0000000a9901/identidad.pdf');
insert into public.enrollment_documents (organization_id, application_id, document_type, storage_path, mime_type, size_bytes, uploaded_by)
values (tests.id('org_a'), '0a000000-0000-4000-8000-0000000a9901', 'identidad',
        '0a000000-0000-4000-8000-000000000001/applications/0a000000-0000-4000-8000-0000000a9901/identidad.pdf', 'application/pdf', 3000, tests.id('postulante'));
select tests.fails($q$ insert into public.enrollment_documents (organization_id, application_id, document_type, storage_path, mime_type, size_bytes, uploaded_by)
                     values (tests.id('org_a'), '0a000000-0000-4000-8000-0000000a9901', 'x',
                     '0a000000-0000-4000-8000-000000000001/applications/0a000000-0000-4000-8000-0000000a9901/x.exe', 'application/x-msdownload', 10, tests.id('postulante')) $q$,
                   'Tipo de archivo no permitido rechazado', '23514');
update public.applications set status = 'submitted', submitted_at = now() where id = '0a000000-0000-4000-8000-0000000a9901';
update public.applications set status = 'approved' where id = '0a000000-0000-4000-8000-0000000a9901';
select tests.ok(tests.visible($q$ select 1 from public.applications where status = 'submitted' $q$) = 1, 'Postulante envía, pero no puede autoaprobarse');
select tests.ok(tests.visible('select * from public.students') = 0, 'Postulante no ve estudiantes');
reset role;
select tests.login(tests.id('director_a'), 'aal2'); set local role authenticated;
select public.decide_application('0a000000-0000-4000-8000-0000000a9901', true, 'Cumple requisitos');
select tests.ok((select status from public.applications where id = '0a000000-0000-4000-8000-0000000a9901') = 'approved', 'Postulación aprobada por admisión');
select tests.ok(tests.visible($q$ select 1 from storage.objects where name like '%identidad.pdf' $q$) = 1, 'Admisión lee el documento del postulante');
-- Reportes basados en información almacenada
select tests.ok((select active from public.report_enrollment_summary(tests.id('org_a'), tests.id('period_a')) where program_code = 'TIN') = 3,
                'Reporte de matrícula: 3 activos en TIN');
reset role;
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.fails($q$ select * from public.report_enrollment_summary(tests.id('org_a'), tests.id('period_a')) $q$, 'Estudiante no accede a reportes', '42501');
reset role;

rollback;
