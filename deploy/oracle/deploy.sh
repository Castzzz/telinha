#!/bin/bash
# Atualiza o servidor do Telinha na VM da Oracle. Roda no SEU PC:
#
#   npm run deploy:oracle
#
# Primeira vez (ou pra trocar o token do DuckDNS): DUCKDNS_TOKEN=xxxx npm run deploy:oracle
# VM, DOMAIN e SSH_KEY vêm do deploy/oracle/config.sh (ou da linha de comando).
set -euo pipefail
cd "$(dirname "$0")/../.."

source deploy/oracle/config.sh
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "$VM")
GO="${GO:-$(command -v go || echo "$HOME/.local/go/bin/go")}"
ENABLE_MUSIC="${ENABLE_MUSIC:-1}"
YTDLP_VERSION="${YTDLP_VERSION:-2026.10.26}"
[[ "$ENABLE_MUSIC" =~ ^[01]$ ]] || { echo "ENABLE_MUSIC precisa ser 0 ou 1." >&2; exit 1; }
[[ "$YTDLP_VERSION" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$ ]] || { echo "Versão do yt-dlp inválida." >&2; exit 1; }

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

echo "== Conferindo a arquitetura de $VM"
case "$("${SSH[@]}" uname -m)" in
  x86_64) SFU_GOARCH=amd64 ;;
  aarch64|arm64) SFU_GOARCH=arm64 ;;
  *) echo "❌ Arquitetura da VM não suportada." >&2; exit 1 ;;
esac
echo "== Compilando o SFU (linux/$SFU_GOARCH)"
CGO_ENABLED=0 GOOS=linux GOARCH="$SFU_GOARCH" "$GO" build -trimpath -ldflags="-s -w" -o "$stage/telinha-sfu" ./sfu
if [ "$ENABLE_MUSIC" = 1 ]; then
  echo "== Compilando a ponte de música (linux/$SFU_GOARCH)"
  CGO_ENABLED=0 GOOS=linux GOARCH="$SFU_GOARCH" "$GO" build -trimpath -ldflags="-s -w" -o "$stage/telinha-music-publisher" ./cmd/music-publisher
  echo "== Baixando yt-dlp $YTDLP_VERSION (SHA-256 oficial)"
  base="https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION"
  curl -fsSL --max-time 120 -o "$stage/yt-dlp" "$base/yt-dlp"
  curl -fsSL --max-time 60 -o "$stage/SHA2-256SUMS" "$base/SHA2-256SUMS"
  (cd "$stage" && grep -E ' [*]?yt-dlp$' SHA2-256SUMS | sha256sum -c -)
fi

echo "== Empacotando o servidor (sem as dependências do app desktop)"
mkdir -p "$stage/app"
cp -r server.js channel-extras.js daily-call-store.js permission-store.js account-store.js accounts-protocol.js dice-store.js package.json package-lock.json public music "$stage/app/"
mkdir -p "$stage/app/scripts"
cp scripts/configurar-dono.mjs "$stage/app/scripts/"
(cd "$stage/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)
tar -czf "$stage/app.tar.gz" -C "$stage/app" .

echo "== Versões mais novas do Node (LTS) e do Caddy"
NODE_VERSION=${NODE_VERSION:-$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(r['version'] for r in json.load(sys.stdin) if r['lts']))")}
CADDY_VERSION=${CADDY_VERSION:-$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'].lstrip('v'))")}
echo "   Node $NODE_VERSION, Caddy $CADDY_VERSION"

echo "== Backup dos dados da sala antes de mexer (pule com SKIP_BACKUP=1)"
if [ -z "${SKIP_BACKUP:-}" ]; then
  VM="$VM" SSH_KEY="$SSH_KEY" bash deploy/oracle/backup.sh || echo "   ⚠️ Backup falhou (primeira instalação?); seguindo com o deploy."
fi

echo "== Enviando pra $VM"
"${SSH[@]}" 'rm -rf /tmp/telinha-deploy && mkdir -p /tmp/telinha-deploy'
scp -q -i "$SSH_KEY" -o BatchMode=yes "$stage/app.tar.gz" "$stage/telinha-sfu" deploy/oracle/install.sh "$VM:/tmp/telinha-deploy/"
if [ "$ENABLE_MUSIC" = 1 ]; then
  scp -q -i "$SSH_KEY" -o BatchMode=yes "$stage/telinha-music-publisher" "$stage/yt-dlp" "$VM:/tmp/telinha-deploy/"
fi

echo "== Instalando"
# O token vai pelo stdin (não aparece na lista de processos da VM)
printf '%s\n' "${DUCKDNS_TOKEN:-}" | "${SSH[@]}" \
  "read -r t; sudo env DOMAIN='$DOMAIN' NODE_VERSION='$NODE_VERSION' CADDY_VERSION='$CADDY_VERSION' ENABLE_MUSIC='$ENABLE_MUSIC' ACTIVATE_DUCKDNS='${ACTIVATE_DUCKDNS:-1}' DUCKDNS_TOKEN=\"\$t\" bash /tmp/telinha-deploy/install.sh"
