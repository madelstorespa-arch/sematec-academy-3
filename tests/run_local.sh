#!/usr/bin/env bash
# =====================================================================
# Ejecuta TODAS las pruebas en un PostgreSQL local limpio.
#   PGHOST/PGPORT/PGUSER apuntan a un servidor PostgreSQL 15+ (superusuario).
#   Uso: tests/run_local.sh
# Para el entorno local de Supabase (supabase start) use tests/run_supabase.sh
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-sematec_test}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

echo "▶ Creando base de datos de prueba '$DB'"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null

echo "▶ Emulación local de Supabase (auth, roles, storage)"
$PSQL -d "$DB" -f tests/local/00_supabase_shim.sql >/dev/null

echo "▶ Migraciones"
for f in supabase/migrations/*.sql; do
  echo "   · $(basename "$f")"
  $PSQL -d "$DB" -f "$f" >/dev/null
done

echo "▶ Datos de prueba"
$PSQL -d "$DB" -f supabase/seed.sql >/dev/null
$PSQL -d "$DB" -f tests/sql/00_helpers.sql >/dev/null

pass=0; fail=0; report="tests/resultados_pruebas.txt"
echo "Resultados de pruebas SEMATEC GLOBAL 10.0 — $(date -u '+%Y-%m-%d %H:%M UTC')" > "$report"
echo "Servidor: $($PSQL -d "$DB" -tAc 'select version()')" >> "$report"
for t in tests/sql/[0-9][1-9]_*.sql tests/sql/[1-9][0-9]_*.sql; do
  [ -f "$t" ] || continue
  name=$(basename "$t")
  out=$($PSQL -d "$DB" -f "$t" 2>&1) && status=0 || status=$?
  oks=$(grep -c "OK   " <<<"$out" || true)
  echo "" >> "$report"; echo "=== $name ===" >> "$report"
  grep -oE "(OK   .*|FALLÓ.*|ERROR.*)" <<<"$out" | sed 's/^/  /' >> "$report" || true
  if [ $status -eq 0 ]; then
    pass=$((pass+oks)); echo "✔ $name ($oks verificaciones)"
  else
    fail=$((fail+1)); pass=$((pass+oks)); echo "✘ $name"; grep -E "FALLÓ|ERROR" <<<"$out" | head -5
  fi
done

echo "▶ Concurrencia (dos conexiones simultáneas)"
if bash tests/concurrency_test.sh "$DB" >> "$report" 2>&1; then
  echo "✔ concurrencia (2 verificaciones)"; pass=$((pass+2))
else
  echo "✘ concurrencia"; fail=$((fail+1)); tail -5 "$report"
fi

echo "▶ Respaldo y restauración (pg_dump → base nueva → verificación)"
if bash tests/backup_restore_test.sh "$DB" >> "$report" 2>&1; then
  echo "✔ backup_restore"; pass=$((pass+1))
else
  echo "✘ backup_restore"; fail=$((fail+1))
fi

echo ""
echo "Verificaciones exitosas: $pass · Archivos con fallas: $fail" | tee -a "$report"
[ $fail -eq 0 ]
