#!/bin/bash
# Local macOS policy extension. Verify only; never alter PF or bypass DNS.
set -euo pipefail
container network list | awk '$1 == "default" && $2 == "192.168.64.0/24" { ok=1 } END { exit !ok }' || {
  echo 'Required Apple Container default subnet: 192.168.64.0/24' >&2; exit 1;
}
/usr/sbin/lsof -nP -iUDP:5300 -iTCP:5300 | grep -q '127.0.0.1:5300' || {
  echo 'Required host encrypted DNS listener: 127.0.0.1:5300' >&2; exit 1;
}
RULES="$(sudo -n /sbin/pfctl -a com.apple/container-dnscrypt -sn)" || {
  echo 'Cannot verify privileged PF DNS forwarding. Run this preflight with an authorized sudo session.' >&2; exit 1;
}
printf '%s\n' "$RULES" | grep -E '192\.168\.64\.0/24.*127\.0\.0\.1.*5300' >/dev/null || {
  echo 'Required PF redirect from 192.168.64.0/24 DNS to 127.0.0.1 port 5300 is absent.' >&2; exit 1;
}
/usr/bin/dig @127.0.0.1 -p 5300 registry.npmjs.org +short | grep -q .
