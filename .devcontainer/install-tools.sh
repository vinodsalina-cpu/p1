#!/bin/sh
set -eu
if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
        node -e "const fs = require('node:fs'); fs.mkdirSync('/etc/ssl/certs', { recursive: true }); fs.writeFileSync('/etc/ssl/certs/ca-certificates.crt', require('node:tls').rootCertificates.join('\\n') + '\\n');";
    fi
sed -i 's|http:|https:|g' /etc/apt/sources.list.d/debian.sources
apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update
apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends ca-certificates git openssh-client
rm -rf /var/lib/apt/lists/*
corepack disable
npm install --global pnpm@10.34.6
git config --system --add safe.directory /workspaces/p1
mkdir -p /workspaces/p1/node_modules /home/node/.local/share/pnpm/store
chown -R node:node /workspaces /home/node/.local
