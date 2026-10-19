#!/bin/bash
# Atualiza o servidor do Telinha na VM da Oracle. Roda no SEU PC:
#
#   npm run deploy:oracle
#
# Primeira vez (ou pra trocar o token do DuckDNS): DUCKDNS_TOKEN=xxxx npm run deploy:oracle
# Variáveis: VM (padrão opc@163.176.189.41), DOMAIN, SSH_KEY.
set -euo pipefail
cd "$(dirname "$0")/../.."

VM="${VM:-opc@163.176.189.41}"
DOMAIN="${DOMAIN:-colheitafartus.duckdns.org}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oracle_telinha}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "$VM")
GO="${GO:-$(command -v go || echo "$HOME/.local/go/bin/go")}"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

echo "== Compilando o SFU (linux/amd64)"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$GO" build -trimpath -ldflags="-s -w" -o "$stage/telinha-sfu" ./sfu

echo "== Empacotando o servidor (sem as dependências do app desktop)"
mkdir -p "$stage/app"
cp -r server.js package.json package-lock.json public "$stage/app/"
(cd "$stage/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)
tar -czf "$stage/app.tar.gz" -C "$stage/app" .

echo "== Versões mais novas do Node (LTS) e do Caddy"
NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(r['version'] for r in json.load(sys.stdin) if r['lts']))")
CADDY_VERSION=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'].lstrip('v'))")
echo "   Node $NODE_VERSION, Caddy $CADDY_VERSION"

echo "== Enviando pra $VM"
"${SSH[@]}" 'rm -rf /tmp/telinha-deploy && mkdir -p /tmp/telinha-deploy'
scp -q -i "$SSH_KEY" -o BatchMode=yes "$stage/app.tar.gz" "$stage/telinha-sfu" deploy/oracle/install.sh "$VM:/tmp/telinha-deploy/"

echo "== Instalando"
# O token vai pelo stdin (não aparece na lista de processos da VM)
printf '%s\n' "${DUCKDNS_TOKEN:-}" | "${SSH[@]}" \
  "read -r t; sudo env DOMAIN='$DOMAIN' NODE_VERSION='$NODE_VERSION' CADDY_VERSION='$CADDY_VERSION' DUCKDNS_TOKEN=\"\$t\" bash /tmp/telinha-deploy/install.sh"
