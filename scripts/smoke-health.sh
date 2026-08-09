#!/usr/bin/env bash
#
# Smoke test post-deploy: pega a /health y /ready y confirma que ambos
# responden 200. Por defecto apunta a la URL publica de produccion (Render);
# se puede apuntar a cualquier otra con BASE_URL.
#
# Uso:
#   bash scripts/smoke-health.sh
#   BASE_URL=http://localhost:3000 bash scripts/smoke-health.sh

BASE_URL="${BASE_URL:-https://turnity-backend-jbj9.onrender.com}"

pass=0
fail=0

check() {
  if [ "$2" = "$3" ]; then
    echo "  [PASS] $1 (HTTP $3)"; pass=$((pass + 1))
  else
    echo "  [FAIL] $1 -> esperado $2, obtenido $3"; fail=$((fail + 1))
  fi
}

echo "== Smoke health/ready =="
echo "Base: $BASE_URL"
echo

echo "A) liveness (el proceso esta arriba)"
st=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")
check "GET /health responde 200" "200" "$st"
echo

echo "B) readiness (conexion a la base de datos)"
st=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/ready")
check "GET /ready responde 200" "200" "$st"
echo

echo "== Resultado: $pass PASS, $fail FAIL =="
[ "$fail" -eq 0 ] && echo "OK" || echo "HAY FALLAS"
exit "$fail"
