#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
container system status >/dev/null
NETWORK_ARGS=()
if [ "${P1_NETWORK_PATCH:-0}" = 1 ]; then
  bash "$ROOT/.devcontainer/apple/network-check.sh"
  NETWORK_ARGS=(--network default --dns 192.168.64.1)
fi
ip() { container inspect "$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["status"]["networks"][0]["ipv4Address"].split("/")[0])'; }
exists() { container inspect "$1" >/dev/null 2>&1; }
start_existing() { if ! container inspect "$1" | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin)[0]["status"]["state"] == "running" else 1)'; then container start "$1" >/dev/null; fi; }
if ! exists p1-apple-db; then
  container volume create p1-apple-postgres
  container run "${NETWORK_ARGS[@]}" -d --name p1-apple-db -m 512M -e POSTGRES_PASSWORD=postgres -e PGDATA=/var/lib/postgresql/data/pgdata -v p1-apple-postgres:/var/lib/postgresql/data postgres:17-bookworm
else start_existing p1-apple-db; fi
for ((attempt = 0; attempt < 30; attempt++)); do
  if container exec p1-apple-db pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
container exec p1-apple-db pg_isready -U postgres
if ! container exec p1-apple-db psql -U postgres -tAc "SELECT to_regclass('public.registration_receipts')" | grep -q registration_receipts; then
  { printf '%s\n' 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role NOLOGIN BYPASSRLS;'; cat "$ROOT/supabase/migrations/0001_registration_receipts.sql"; } | container exec -i p1-apple-db psql -v ON_ERROR_STOP=1 -U postgres
fi
DB_IP="$(ip p1-apple-db)"
if ! exists p1-apple-rest; then
  container run "${NETWORK_ARGS[@]}" -d --name p1-apple-rest -m 256M -e "PGRST_DB_URI=postgres://postgres:postgres@$DB_IP:5432/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=service_role postgrest/postgrest:v12.2.12
else start_existing p1-apple-rest; fi
if ! exists p1-apple-dynamo; then
  container volume create p1-apple-dynamo-data
  container run "${NETWORK_ARGS[@]}" --rm --user root -v p1-apple-dynamo-data:/data --entrypoint chown amazon/dynamodb-local:3.3.0 -R 1000:1000 /data
  container run "${NETWORK_ARGS[@]}" -d --name p1-apple-dynamo -m 512M -v p1-apple-dynamo-data:/home/dynamodblocal/data amazon/dynamodb-local:3.3.0 -jar DynamoDBLocal.jar -sharedDb -dbPath ./data
else start_existing p1-apple-dynamo; fi
if ! exists p1-apple-edge; then
  container run "${NETWORK_ARGS[@]}" -d --name p1-apple-edge -m 1G -v "$ROOT:/workspaces/p1:ro" \
    -e "P1_REST_HOST=$(ip p1-apple-rest):3000" -e SUPABASE_URL=http://127.0.0.1:9000 \
    -e SUPABASE_SERVICE_ROLE_KEY=local-test-only \
    -e 'WEBHOOK_CREDENTIALS={"provider-1":{"tenantId":"tenant-1","secret":"provider-callback-contract-test-secret-32bytes"}}' \
    public.ecr.aws/supabase/edge-runtime:v1.77.4 start --main-service /workspaces/p1/.devcontainer/apple
else start_existing p1-apple-edge; fi
printf 'Apple Container services started. Run bash .devcontainer/apple/test.sh\n'
