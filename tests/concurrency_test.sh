#!/usr/bin/env bash
# Integridad bajo concurrencia real: dos conexiones simultáneas compiten por
# (1) el último cupo de una sección y (2) pagar la misma deuda dos veces.
set -uo pipefail
DB="$1"; PSQL="psql -X -q -d $DB"
echo "=== concurrencia ==="
$PSQL -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.sections set capacity = 1 where id = tests.id('sec_prg101');
delete from public.section_enrollments where section_id = tests.id('sec_prg101');
select tests.login(tests.id('tesoreria_a'), 'aal2'); set role authenticated;
select public.create_charge(tests.id('est3'), 'exam_fee', 100000, 'CLP', 1, date '2026-12-01', null, null, 'Concurrencia');
SQL

race() {  # $1 = usuario, $2 = aal, $3 = sentencia
  $PSQL <<SQL 2>&1
select tests.login(tests.id('$1'), '$2'); set role authenticated;
begin;
$3;
select pg_sleep(1.5);
commit;
SQL
}
# (1) Último cupo
race matriculas_a aal1 "select public.register_section(tests.id('est1'), tests.id('sec_prg101'))" > /tmp/c1.log &
sleep 0.3
race matriculas_a aal1 "select public.register_section(tests.id('est2'), tests.id('sec_prg101'))" > /tmp/c2.log &
# (2) Doble pago
race tesoreria_a aal2 "select public.register_payment(tests.id('est3'), 100000, 'CLP', 'cash', null, null, null, 'Caja 1')" > /tmp/c3.log &
sleep 0.3
race tesoreria_a aal2 "select public.register_payment(tests.id('est3'), 100000, 'CLP', 'cash', null, null, null, 'Caja 2')" > /tmp/c4.log &
wait

n=$($PSQL -tAc "select count(*) from public.section_enrollments where section_id = tests.id('sec_prg101') and status = 'enrolled'")
paid=$($PSQL -tAc "select coalesce(sum(amount),0)::int from public.payments where student_id = tests.id('est3') and status = 'confirmed'")
ok=0
if [ "$n" = "1" ] && grep -q "sin cupos" /tmp/c2.log; then
  echo "  OK   Dos inscripciones simultáneas al último cupo: 1 aceptada, 1 rechazada (sin sobrecupo)"
else echo "  FALLÓ: inscritos=$n"; cat /tmp/c1.log /tmp/c2.log; ok=1; fi
if [ "$paid" = "100000" ] && grep -q "supera la deuda" /tmp/c4.log; then
  echo "  OK   Dos pagos simultáneos de la misma deuda: 1 aceptado, 1 rechazado (sin doble cobro)"
else echo "  FALLÓ: pagado=$paid"; cat /tmp/c3.log /tmp/c4.log; ok=1; fi
exit $ok
