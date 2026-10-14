#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NETWORK_ARGS=()
if [ "${P1_NETWORK_PATCH:-0}" = 1 ]; then
  bash "$ROOT/.devcontainer/apple/network-check.sh"
  NETWORK_ARGS=(--network default --dns 192.168.64.1)
fi
ip() { container inspect "$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["status"]["networks"][0]["ipv4Address"].split("/")[0])'; }
container run "${NETWORK_ARGS[@]}" --rm --name "p1-apple-tests-$$" -m 2G -c 4 \
  -v "$ROOT:/workspaces/p1" -v p1-apple-node-modules:/workspaces/p1/node_modules \
  -v p1-apple-pnpm-store:/home/node/.local/share/pnpm/store \
  -e "P1_DB_HOST=$(ip p1-apple-db)" -e "P1_DYNAMO_HOST=$(ip p1-apple-dynamo)" -e "P1_EDGE_HOST=$(ip p1-apple-edge)" \
  --user root p1-sup-aws:latest sh -c 'pnpm install --frozen-lockfile && node .devcontainer/apple/test-proxy.mjs'
