#!/bin/bash
# Instala/atualiza o Telinha numa VM Oracle Linux 9 (x86_64). Roda NA VM, como root.
# Normalmente quem chama é o deploy.sh (no seu PC), que já manda os arquivos pra /tmp/telinha-deploy.
#
#   DOMAIN=meu.duckdns.org DUCKDNS_TOKEN=xxxx bash install.sh
#
# Não usa dnf: na VM micro ele leva mais de 10 min e esgota a memória.
set -euo pipefail

DOMAIN="${DOMAIN:?defina DOMAIN, ex: colheitafartus.duckdns.org}"
STAGE=/tmp/telinha-deploy
APP=/opt/telinha
NODE_VERSION="${NODE_VERSION:-v24.11.1}"
CADDY_VERSION="${CADDY_VERSION:-2.10.2}"
MEDIA_PORT=50000

log() { printf '\n== %s\n' "$*"; }

log "Swap (a micro tem só 1 GB de RAM)"
# A imagem da Oracle às vezes já vem com swap (/.swapfile); só cria se não tiver nenhum
if [ -z "$(swapon --noheadings --show)" ]; then
  if [ ! -f /swapfile-telinha ]; then
    fallocate -l 1G /swapfile-telinha
    chmod 600 /swapfile-telinha
    mkswap /swapfile-telinha >/dev/null
    echo '/swapfile-telinha none swap defaults 0 0' >> /etc/fstab
  fi
  swapon /swapfile-telinha
fi

log "Desligando o dnf-makecache automático (usa ~500 MB e trava a micro)"
systemctl disable -q --now dnf-makecache.timer 2>/dev/null || true
systemctl stop dnf-makecache.service 2>/dev/null || true

log "Usuários e pastas"
id telinha >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /sbin/nologin telinha
id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home --shell /sbin/nologin caddy
mkdir -p "$APP/app" "$APP/bin" "$APP/data" /etc/telinha /etc/caddy
chmod 700 /etc/telinha

log "Node.js $NODE_VERSION (binário oficial, hash conferido)"
if [ "$("$APP/node/bin/node" --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  file="node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$APP/node" && mkdir -p "$APP/node"
  tar -xJf "$tmp/$file" -C "$APP/node" --strip-components=1
  rm -rf "$tmp"
fi

log "Caddy $CADDY_VERSION (HTTPS automático)"
if ! /usr/local/bin/caddy version 2>/dev/null | grep -q "v$CADDY_VERSION"; then
  tmp=$(mktemp -d)
  file="caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
  base="https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION"
  curl -fsSL -o "$tmp/$file" "$base/$file"
  curl -fsSL -o "$tmp/checksums.txt" "$base/caddy_${CADDY_VERSION}_checksums.txt"
  (cd "$tmp" && grep " $file\$" checksums.txt | sha512sum -c -)
  tar -xzf "$tmp/$file" -C "$tmp" caddy
  install -m 755 "$tmp/caddy" /usr/local/bin/caddy
  rm -rf "$tmp"
fi

log "Aplicação"
systemctl stop telinha-server telinha-sfu 2>/dev/null || true
rm -rf "$APP/app.new" && mkdir -p "$APP/app.new"
tar -xzf "$STAGE/app.tar.gz" -C "$APP/app.new"
rm -rf "$APP/app" && mv "$APP/app.new" "$APP/app"
install -m 755 "$STAGE/telinha-sfu" "$APP/bin/telinha-sfu"
chown -R telinha:telinha "$APP"

log "Segredos (gerados uma vez, ficam só na VM)"
if [ ! -f /etc/telinha/telinha.env ]; then
  echo "SFU_SECRET=$(openssl rand -hex 32)" > /etc/telinha/telinha.env
fi
# Senha de admin da sala (Configurações > Admin no app). Pra trocar: apague a linha e rode o deploy.
if ! grep -q '^ADMIN_KEY=' /etc/telinha/telinha.env; then
  echo "ADMIN_KEY=$(openssl rand -hex 4)" >> /etc/telinha/telinha.env
fi
if [ -n "${DUCKDNS_TOKEN:-}" ]; then
  printf 'DUCKDNS_DOMAIN=%s\nDUCKDNS_TOKEN=%s\n' "${DOMAIN%%.duckdns.org}" "$DUCKDNS_TOKEN" > /etc/telinha/duckdns.env
fi
chmod 600 /etc/telinha/*.env
PUBLIC_IP=$(curl -fsS https://api.ipify.org || true)

log "Serviços (systemd)"
cat > /etc/systemd/system/telinha-server.service <<EOF
[Unit]
Description=Telinha - servidor da sala (canais, chat, voz)
After=network-online.target
Wants=network-online.target

[Service]
User=telinha
WorkingDirectory=$APP/app
EnvironmentFile=/etc/telinha/telinha.env
Environment=PORT=8080
Environment=NODE_ENV=production
# Canais criados ficam aqui (fora de app/, que o deploy apaga e recria)
Environment=TELINHA_DATA_DIR=$APP/data
ExecStart=$APP/node/bin/node --max-old-space-size=192 server.js
Restart=always
RestartSec=2
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/telinha-sfu.service <<EOF
[Unit]
Description=Telinha - repassador de transmissões (SFU)
After=network-online.target
Wants=network-online.target

[Service]
User=telinha
EnvironmentFile=/etc/telinha/telinha.env
Environment=PORT=8081
Environment=MEDIA_PORT=$MEDIA_PORT
Environment=PUBLIC_IP=$PUBLIC_IP
ExecStart=$APP/bin/telinha-sfu
Restart=always
RestartSec=2
MemoryMax=200M

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	handle_path /sfu/* {
		reverse_proxy 127.0.0.1:8081
	}
	handle {
		reverse_proxy 127.0.0.1:8080
	}
}
EOF

cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy (HTTPS do Telinha)
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=2
MemoryMax=150M

[Install]
WantedBy=multi-user.target
EOF

# DuckDNS: mantém o domínio apontando pro IP da VM (a cada 30 min)
cat > /etc/systemd/system/duckdns.service <<'EOF'
[Unit]
Description=Atualiza o IP no DuckDNS

[Service]
Type=oneshot
EnvironmentFile=/etc/telinha/duckdns.env
ExecStart=/usr/bin/curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="
EOF
cat > /etc/systemd/system/duckdns.timer <<'EOF'
[Unit]
Description=Atualiza o IP no DuckDNS a cada 30 min

[Timer]
OnBootSec=1min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
EOF

log "Firewall da VM"
firewall-cmd -q --permanent --add-service=http
firewall-cmd -q --permanent --add-service=https
firewall-cmd -q --permanent --add-port=$MEDIA_PORT/udp
firewall-cmd -q --permanent --add-port=$MEDIA_PORT/tcp
firewall-cmd -q --reload

log "Subindo tudo"
systemctl daemon-reload
systemctl enable -q --now telinha-server telinha-sfu caddy
[ -f /etc/telinha/duckdns.env ] && systemctl enable -q --now duckdns.timer
systemctl restart telinha-server telinha-sfu
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 3
systemctl --no-pager --lines=0 status telinha-server telinha-sfu caddy | grep -E '●|Active:' || true
echo
echo "Pronto: https://$DOMAIN"
grep '^ADMIN_KEY=' /etc/telinha/telinha.env | sed 's/^ADMIN_KEY=/Senha de admin (Configurações > Admin no app): /'
