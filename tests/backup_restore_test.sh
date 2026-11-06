#!/usr/bin/env bash
# Criterio 13: respaldo restaurable verificado.
# Respalda la base con pg_dump, la restaura en una base nueva y compara
# conteos de tablas críticas y la integridad de la cadena de auditoría.
set -euo pipefail
SRC="$1"; DST="${SRC}_restore"; DUMP="/tmp/${SRC}_$(date +%s).dump"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

pg_dump -Fc -d "$SRC" -f "$DUMP"
$PSQL -d postgres -c "drop database if exists $DST" -c "create database $DST" >/dev/null
pg_restore --no-owner -d "$DST" "$DUMP"

q="select string_agg(t || '=' || n, ',' order by t) from (
     select 'students' t, count(*) n from public.students union all
     select 'enrollments', count(*) from public.enrollments union all
     select 'memberships', count(*) from public.memberships union all
     select 'payments', count(*) from public.payments union all
     select 'audit_events', count(*) from public.audit_events union all
     select 'role_permissions', count(*) from public.role_permissions) x"
a=$($PSQL -d "$SRC" -tAc "$q"); b=$($PSQL -d "$DST" -tAc "$q")
echo "=== backup_restore ==="
echo "  Origen:     $a"
echo "  Restaurada: $b"
[ "$a" = "$b" ] || { echo "  FALLÓ: los conteos difieren"; exit 1; }

ok=$($PSQL -d "$DST" -tA -c "select tests.service()" -c "select bool_and(ok) from (
       select (public.verify_audit_chain(o.id)).ok from public.organizations o
       union all select (public.verify_audit_chain(null)).ok) x" | tail -1)
[ "$ok" = "t" ] || { echo "  FALLÓ: cadena de auditoría inválida tras restaurar"; exit 1; }
echo "  OK   Conteos idénticos y cadena de auditoría íntegra en la copia restaurada"
$PSQL -d postgres -c "drop database $DST" >/dev/null
rm -f "$DUMP"
