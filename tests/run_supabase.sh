#!/usr/bin/env bash
# =====================================================================
# Ejecuta las pruebas contra el entorno LOCAL de Supabase (supabase start).
#   1) supabase db reset        -> aplica migraciones + seed.sql
#   2) tests/run_supabase.sh    -> corre las pruebas
# NUNCA ejecutar contra el proyecto de producción: las pruebas crean datos.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in *supabase.co*|*pooler.supabase.com*) echo "Abortado: DB_URL apunta a un proyecto en la nube"; exit 1;; esac
PSQL="psql -X -q -v ON_ERROR_STOP=1 $DB_URL"

$PSQL -f tests/sql/00_helpers.sql >/dev/null
fail=0
for t in tests/sql/0[1-9]_*.sql; do
  if out=$($PSQL -f "$t" 2>&1); then
    echo "✔ $(basename "$t") ($(grep -c 'OK   ' <<<"$out") verificaciones)"
  else
    echo "✘ $(basename "$t")"; grep -E "FALLÓ|ERROR" <<<"$out" | head -5; fail=1
  fi
done
exit $fail
