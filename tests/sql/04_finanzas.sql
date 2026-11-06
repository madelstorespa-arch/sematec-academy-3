-- Criterio 09: cuotas y pagos con trazabilidad; reversos sin borrado
begin;

-- Beneficio configurado por finanzas
insert into public.benefits (id, organization_id, code, name, percent_off)
values ('0a000000-0000-4000-8000-0000000be001', tests.id('org_a'), 'BECA10', 'Beca 10 %', 10);

select tests.login(tests.id('tesoreria_a'), 'aal2'); set local role authenticated;
-- Arancel 1.000.000 CLP con beca 10 % en 3 cuotas -> neto 900.000 = 300.000 x 3
select public.create_charge(tests.id('est1'), 'tuition', 1000000, 'CLP', 3, date '2026-08-05',
                            (select id from public.enrollments where student_id = tests.id('est1')),
                            '0a000000-0000-4000-8000-0000000be001', 'Arancel 2026-2');
select tests.ok((select net_amount from public.charges where student_id = tests.id('est1')) = 900000, 'Descuento aplicado: neto 900.000');
select tests.ok((select array_agg(amount::int order by number) from public.installments i join public.charges c on c.id = i.charge_id
                  where c.student_id = tests.id('est1')) = array[300000,300000,300000], 'Tres cuotas de 300.000');
-- Redondeo: 100.000 en 3 cuotas -> 33.333 + 33.333 + 33.334 (CLP sin decimales)
select public.create_charge(tests.id('est2'), 'enrollment_fee', 100000, 'CLP', 3, date '2026-12-05');
select tests.ok((select array_agg(amount::int order by number) from public.installments i join public.charges c on c.id = i.charge_id
                  where c.student_id = tests.id('est2')) = array[33333,33333,33334], 'Última cuota absorbe el redondeo; suma exacta');

-- Pago parcial (abono) se imputa a la cuota más antigua
select public.register_payment(tests.id('est1'), 450000, 'CLP', 'bank_transfer', 'banco_demo', 'TRX-0001');
select tests.ok((select array_agg(paid::int order by number) from public.installment_balances where student_id = tests.id('est1'))
                = array[300000,150000,0], 'Abono 450.000: cuota 1 pagada, cuota 2 parcial');
select tests.ok((select status from public.charges where student_id = tests.id('est1')) = 'partially_paid', 'Cargo parcialmente pagado');
select tests.ok((select receipt_number from public.payments where external_reference = 'TRX-0001') = 1, 'Recibo correlativo N° 1');
select tests.fails($q$ select public.register_payment(tests.id('est1'), 1000, 'CLP', 'bank_transfer', 'banco_demo', 'TRX-0001') $q$,
                   'Misma transacción del proveedor no se registra dos veces', '23505');
select tests.fails($q$ select public.register_payment(tests.id('est1'), 500000, 'CLP', 'cash') $q$,
                   'Pago mayor a la deuda rechazado', '23514');
select tests.fails($q$ select public.register_payment(tests.id('est1'), -5, 'CLP', 'cash') $q$, 'Monto negativo rechazado', '22023');

-- Integridad: no se borra ni se edita el monto
select tests.fails($q$ delete from public.payments $q$, 'Borrado de pagos prohibido', '42501');
select tests.fails($q$ update public.payments set amount = 1 $q$, 'Edición directa de pagos prohibida', '42501');
reset role;
select tests.fails($q$ delete from public.payments where external_reference = 'TRX-0001' $q$,
                   'Ni el superusuario borra pagos (disparador)', '42501');
select tests.fails($q$ update public.payments set amount = 1 where external_reference = 'TRX-0001' $q$,
                   'Ni el superusuario altera montos', '42501');

-- Reembolso parcial libera la cuota más reciente
select tests.login(tests.id('tesoreria_a'), 'aal2'); set local role authenticated;
select public.refund_payment((select id from public.payments where external_reference = 'TRX-0001'), 50000, 'bank_transfer',
                             'Devolución por pago duplicado parcial');
select tests.ok((select array_agg(paid::int order by number) from public.installment_balances where student_id = tests.id('est1'))
                = array[300000,100000,0], 'Reembolso 50.000 descontado de la cuota 2');
-- Anulación requiere MFA (se usa el id real del pago, conocido por el atacante)
reset role;
select set_config('t.pay', (select id::text from public.payments where external_reference = 'TRX-0001'), false);
select tests.login(tests.id('tesoreria_a'), 'aal1'); set local role authenticated;
select tests.fails($q$ select public.void_payment(current_setting('t.pay')::uuid, 'Error de prueba') $q$,
                   'Anulación sin MFA rechazada', '42501');
reset role;
select tests.login(tests.id('tesoreria_a'), 'aal2'); set local role authenticated;
select tests.fails($q$ select public.void_payment((select id from public.payments where external_reference = 'TRX-0001'), 'Pago rechazado por el banco') $q$,
                   'No se anula un pago con reembolsos vigentes', '22023');
-- Segundo pago y su anulación (reverso total)
select public.register_payment(tests.id('est1'), 200000, 'CLP', 'cash', null, null, null, 'Pago en caja');
select public.void_payment((select id from public.payments where notes = 'Pago en caja'), 'Billetes rechazados en arqueo');
select tests.ok((select status from public.payments where notes = 'Pago en caja') = 'voided', 'Pago anulado (no borrado)');
select tests.ok((select count(*) from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
                  where p.notes = 'Pago en caja' and pa.amount < 0) > 0, 'Anulación genera asientos de reverso');
select tests.ok((select array_agg(paid::int order by number) from public.installment_balances where student_id = tests.id('est1'))
                = array[300000,100000,0], 'Saldos vuelven al estado previo tras el reverso');
select tests.fails($q$ select public.void_payment((select id from public.payments where notes = 'Pago en caja'), 'Otra vez') $q$,
                   'Pago anulado no se anula dos veces', '22023');
-- Saldo de cuenta
select tests.ok((select outstanding::int from public.account_balances where student_id = tests.id('est1')) = 500000,
                'Saldo pendiente 500.000 (900.000 - 450.000 + 50.000 reembolso)');
reset role;

-- Conciliación con proveedor
select tests.login(tests.id('owner_a'), 'aal2'); set local role authenticated;
select tests.ok((select array_agg(status order by external_reference) from public.reconcile_provider_payments(tests.id('org_a'), 'banco_demo',
                 '[{"reference":"TRX-0001","amount":450000},{"reference":"TRX-0099","amount":1000}]'))
                = array['ok','missing_in_sematec'], 'Conciliación detecta transacción faltante');
-- Reporte financiero basado en datos almacenados
select tests.ok((select collected::int from public.report_finance_summary(tests.id('org_a')) where currency = 'CLP') = 400000,
                'Reporte: recaudado neto 400.000');
reset role;

-- Visibilidad: el estudiante ve su estado de cuenta, no el de otros
select tests.login(tests.id('est1_u')); set local role authenticated;
select tests.ok(tests.visible('select * from public.installment_balances') = 3, 'Estudiante ve sus 3 cuotas');
select tests.ok(tests.visible($q$ select * from public.charges where student_id = tests.id('est2') $q$) = 0, 'No ve cargos de otro estudiante');
select tests.fails($q$ select public.register_payment(tests.id('est1'), 1000, 'CLP', 'cash') $q$, 'Estudiante no registra pagos', '42501');
reset role;

-- Secretaría no ve finanzas; tesorería de A no ve cuentas de B
select tests.login(tests.id('secretaria_a')); set local role authenticated;
select tests.ok(tests.visible('select * from public.payments') = 0, 'Secretaría no accede a pagos');
reset role;
select tests.login(tests.id('owner_b'), 'aal2'); set local role authenticated;
select tests.ok(tests.visible('select * from public.payments') = 0, 'Institución B no ve pagos de A');
select tests.fails($q$ select public.register_payment(tests.id('est1'), 1000, 'CLP', 'cash') $q$, 'B no registra pagos a estudiantes de A', '42501');
reset role;

-- Trazabilidad: todos los movimientos están en la auditoría
select tests.ok((select count(*) from public.audit_events where table_name = 'payments' and organization_id = tests.id('org_a')) >= 4,
                'Pagos, reembolso y anulación auditados');
select tests.ok(exists (select 1 from public.audit_events where table_name = 'payments' and reason = 'Billetes rechazados en arqueo'),
                'Motivo de anulación registrado en la auditoría');

rollback;
