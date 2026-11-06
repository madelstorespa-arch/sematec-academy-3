-- SEG-003 a SEG-010, criterio 14: MFA, anti-escalamiento, auditoría protegida
begin;

-- MFA obligatoria para roles administrativos
select tests.login(tests.id('owner_a'), 'aal1'); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 0, 'Propietario sin MFA (aal1) no accede a datos');
select tests.fails($q$ select public.grant_membership(tests.id('postulante'), tests.id('org_a'), 'secretaria') $q$,
                   'Sin MFA no puede otorgar roles', '42501');
reset role;

select tests.login(tests.id('owner_a'), 'aal2'); set local role authenticated;
select tests.ok(public.grant_membership(tests.id('postulante'), tests.id('org_a'), 'secretaria', tests.id('campus_a1')) is not null,
                'Con MFA el propietario otorga rol de secretaría');
select tests.fails($q$ select public.grant_membership(tests.id('owner_a'), tests.id('org_a'), 'auditor') $q$,
                   'Nadie se otorga roles a sí mismo', '42501');
select tests.fails($q$ insert into public.memberships (user_id, organization_id, role_id)
                   select tests.id('est1_u'), tests.id('org_a'), id from public.roles where code = 'propietario_institucional' $q$,
                   'Inserción directa de membresías prohibida', '42501');
select tests.fails($q$ select public.grant_membership(tests.id('est1_u'), tests.id('org_b'), 'secretaria') $q$,
                   'No puede otorgar roles en otra institución', '42501');
reset role;

-- Anti-escalamiento: un director general (tiene security.admin pero no finance.void)
-- no puede crear roles ni otorgar roles con permisos que él mismo no posee
select tests.login(tests.id('owner_a'), 'aal2'); set local role authenticated;
select public.grant_membership(tests.id('postulante'), tests.id('org_a'), 'director_general');
reset role;
select tests.login(tests.id('postulante'), 'aal2'); set local role authenticated;
select tests.fails($q$ select public.create_custom_role(tests.id('org_a'), 'falso_tesorero', 'Falso', array['finance.void']) $q$,
                   'No puede crear roles con permisos que no tiene', '42501');
select tests.fails($q$ select public.grant_membership(tests.id('est1_u'), tests.id('org_a'), 'tesoreria') $q$,
                   'No puede otorgar un rol con permisos superiores a los suyos', '42501');
select tests.ok(public.create_custom_role(tests.id('org_a'), 'asistente_reportes', 'Asistente de reportes', array['reports.view']) is not null,
                'Sí crea roles personalizados dentro de sus permisos');
reset role;

-- Un usuario no puede convertirse en superadministrador ni desbloquearse
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.fails($q$ update public.profiles set is_platform_admin = true where id = tests.id('est1_u') $q$,
                   'No puede marcarse como superadministrador', '42501');
select tests.fails($q$ update public.profiles set status = 'active' where id = tests.id('est1_u') $q$,
                   'No puede cambiar su propio estado de cuenta', '42501');
update public.profiles set full_name = 'Estudiante Uno Actualizado' where id = tests.id('est1_u');
select tests.ok((select full_name from public.profiles where id = tests.id('est1_u')) = 'Estudiante Uno Actualizado',
                'Sí puede actualizar su nombre');
select tests.fails($q$ select public.create_organization('pirata', 'Pirata', 'Pirata', 'CL', 'CLP', 'America/Santiago', tests.id('est1_u')) $q$,
                   'Solo superadmin crea instituciones', '42501');
reset role;

-- Superadministrador: requiere MFA y NO ve datos personales por defecto
select tests.login(tests.id('superadmin'), 'aal1'); set local role authenticated;
select tests.fails($q$ select public.create_organization('nueva-inst', 'Nueva Institución', 'Nueva', 'MX', 'MXN', 'America/Mexico_City', tests.id('owner_b')) $q$,
                   'Superadmin sin MFA no crea instituciones', '42501');
reset role;
select tests.login(tests.id('superadmin'), 'aal2'); set local role authenticated;
select tests.ok(public.create_organization('nueva-inst', 'Nueva Institución', 'Nueva', 'MX', 'MXN', 'America/Mexico_City', tests.id('owner_b')) is not null,
                'Superadmin con MFA crea institución con propietario (transacción única)');
select tests.ok(tests.visible('select * from public.students') = 0, 'Superadmin no ve estudiantes sin membresía');
reset role;

-- Bloqueo por intentos fallidos (SEG-010)
select tests.service(); set local role service_role;
select public.record_login_failure('estudiante2.a@demo.sematec.test', '203.0.113.7', 'test') from generate_series(1, 5);
reset role;
select tests.ok((select status from public.profiles where id = tests.id('est2_u')) = 'locked', 'Cuenta bloqueada tras 5 intentos fallidos');
select tests.ok(exists (select 1 from public.system_events where user_id = tests.id('est2_u') and event_type = 'account_locked'),
                'Evento crítico account_locked registrado');
select tests.login(tests.id('est2_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.students') = 0, 'Cuenta bloqueada no accede');
select tests.fails($q$ select public.record_login_failure('x@y.z', null, null) $q$, 'Usuarios no pueden invocar funciones del backend', '42501');
reset role;

-- Auditoría: cambios registrados, inmutable y encadenada
select tests.login(tests.id('owner_a'), 'aal2'); set local role authenticated;
update public.organizations set display_name = 'SEMATEC Chile (editado)' where id = tests.id('org_a');
reset role;
select tests.ok(exists (select 1 from public.audit_events where table_name = 'organizations' and operation = 'UPDATE'
                        and actor_id = tests.id('owner_a') and 'display_name' = any(changed_fields)),
                'Modificación auditada con actor y campos cambiados');
select tests.login(tests.id('auditor_a'), 'aal2'); set local role authenticated;
select tests.ok(tests.visible('select * from public.audit_events') > 0, 'Auditor lee la auditoría de su institución');
select tests.ok(tests.visible($q$ select * from public.audit_events where organization_id = tests.id('org_b') $q$) = 0,
                'Auditor no ve auditoría de otra institución');
select tests.ok((select ok from public.verify_audit_chain(tests.id('org_a'))), 'Cadena de auditoría de A íntegra');
select tests.fails($q$ delete from public.audit_events $q$, 'Auditor no puede borrar auditoría', '42501');
reset role;
-- Incluso el superusuario de la base de datos queda bloqueado por el disparador
select tests.fails($q$ update public.audit_events set reason = 'x' where id = (select min(id) from public.audit_events) $q$,
                   'Ni el superusuario puede editar la auditoría', '42501');
select tests.fails($q$ truncate public.audit_events $q$, 'Ni el superusuario puede vaciar la auditoría', '42501');
-- Si un atacante con acceso total desactiva el disparador y altera un registro, la cadena lo detecta
alter table public.audit_events disable trigger trg_audit_immutable;
update public.audit_events set new_data = jsonb_set(coalesce(new_data, '{}'), '{tampered}', 'true')
 where id = (select min(id) from public.audit_events where organization_id = tests.id('org_a'));
alter table public.audit_events enable trigger trg_audit_immutable;
select tests.service();
select tests.ok(not (select ok from public.verify_audit_chain(tests.id('org_a'))), 'Alteración de auditoría detectada por la cadena de hash');

rollback;
