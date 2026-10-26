#!/bin/bash
# Instala/atualiza o Telinha em Oracle Linux ou Ubuntu (x86_64/ARM64), como root.
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
ACTIVATE_DUCKDNS="${ACTIVATE_DUCKDNS:-1}"

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64; CADDY_ARCH=amd64 ;;
  aarch64|arm64) NODE_ARCH=arm64; CADDY_ARCH=arm64 ;;
  *) echo "Arquitetura da VM não suportada." >&2; exit 1 ;;
esac
case "$ACTIVATE_DUCKDNS" in
  0|1) ;;
  *) echo "ACTIVATE_DUCKDNS precisa ser 0 ou 1." >&2; exit 1 ;;
esac
# A imagem Ubuntu da Oracle usa iptables persistente, sem ufw instalado.
if command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then
  FIREWALL=firewalld
elif command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  FIREWALL=ufw
elif command -v iptables >/dev/null && command -v netfilter-persistent >/dev/null; then
  FIREWALL=iptables
else
  echo "Firewall não suportado; configure firewalld, ufw ativo ou iptables-persistent." >&2
  exit 1
fi

log() { printf '\n== %s\n' "$*"; }

log "Swap de apoio (cria 1 GB se não existir)"
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
  file="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
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
  file="caddy_${CADDY_VERSION}_linux_${CADDY_ARCH}.tar.gz"
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
# A chave antiga só mantém compatibilidade de entrada; não concede propriedade.
if ! grep -q '^ADMIN_KEY=' /etc/telinha/telinha.env; then
  echo "ADMIN_KEY=$(openssl rand -hex 4)" >> /etc/telinha/telinha.env
fi
# Independente da antiga senha compartilhada; nunca imprimir a chave de recuperação.
if ! grep -q '^OWNER_KEY=' /etc/telinha/telinha.env; then
  echo "OWNER_KEY=$(openssl rand -hex 32)" >> /etc/telinha/telinha.env
fi
if [ -f /etc/telinha/owner-bootstrap.json ]; then
  log "Vinculando o dono à identidade confirmada (serviços parados)"
  chmod 600 /etc/telinha/owner-bootstrap.json
  TELINHA_DATA_DIR="$APP/data" "$APP/node/bin/node" "$APP/app/scripts/configurar-dono.mjs" < /etc/telinha/owner-bootstrap.json
  chown telinha:telinha "$APP/data/permissions.json"
  rm /etc/telinha/owner-bootstrap.json
fi
if [ -n "${DUCKDNS_TOKEN:-}" ]; then
  printf 'DUCKDNS_DOMAIN=%s\nDUCKDNS_TOKEN=%s\n' "${DOMAIN%%.duckdns.org}" "$DUCKDNS_TOKEN" > /etc/telinha/duckdns.env
fi
chmod 600 /etc/telinha/*.env
PUBLIC_IP=$(curl -4 -fsS --max-time 15 https://api.ipify.org)
[ -n "$PUBLIC_IP" ] || { echo "Não foi possível descobrir o IPv4 público." >&2; exit 1; }

log "Serviços (systemd)"
# Limites de memória: em VM pequena (1 GB), segura o Node em 192 MB; em VM maior (ex: 12 GB), dá mais folga
TOTAL_RAM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 1048576)
if [ "$TOTAL_RAM_KB" -gt 4194304 ]; then
  NODE_MEM_LIMIT="--max-old-space-size=2048"
  APP_MEM_MAX="3G"
  SFU_MEM_MAX="2G"
else
  NODE_MEM_LIMIT="--max-old-space-size=192"
  APP_MEM_MAX="300M"
  SFU_MEM_MAX="200M"
fi

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
ExecStart=$APP/node/bin/node $NODE_MEM_LIMIT server.js
Restart=always
RestartSec=2
MemoryMax=$APP_MEM_MAX

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
MemoryMax=$SFU_MEM_MAX

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

# A Oracle pode recuperar VM do Always Free que fica "parada" (CPU abaixo de 20% em 95% do
# tempo por 7 dias). A cada 2 h, gasta meio núcleo (~25% da VM de 2 vCPUs) por 20 min, com a
# menor prioridade possível: se a sala precisar de CPU, a sala ganha. Só CPU: é um laço vazio
# do shell (~1–2 MB de RAM, travado em 16 MB).
# Desligar: sudo touch /etc/telinha/keepalive.off (ligar de novo: apague o arquivo).
cat > /etc/systemd/system/telinha-keepalive.service <<'EOF'
[Unit]
Description=Teletela - mantém a VM ocupada (regra de VM parada da Oracle)
ConditionPathExists=!/etc/telinha/keepalive.off

[Service]
Type=oneshot
User=nobody
Nice=19
CPUSchedulingPolicy=idle
CPUQuota=50%
MemoryMax=16M
ExecStart=/usr/bin/timeout 20m /bin/sh -c 'while :; do :; done'
SuccessExitStatus=124
EOF
cat > /etc/systemd/system/telinha-keepalive.timer <<'EOF'
[Unit]
Description=Teletela - VM ocupada a cada 2 horas

[Timer]
OnCalendar=*-*-* 00/2:10:00
RandomizedDelaySec=15min

[Install]
WantedBy=timers.target
EOF

log "Firewall da VM"
case "$FIREWALL" in
  firewalld)
    firewall-cmd -q --permanent --add-service=http
    firewall-cmd -q --permanent --add-service=https
    firewall-cmd -q --permanent --add-port=$MEDIA_PORT/udp
    firewall-cmd -q --permanent --add-port=$MEDIA_PORT/tcp
    firewall-cmd -q --reload
    ;;
  ufw)
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow "$MEDIA_PORT/udp"
    ufw allow "$MEDIA_PORT/tcp"
    ;;
  iptables)
    for rules in iptables ip6tables; do
      command -v "$rules" >/dev/null || continue
      # Insere antes do REJECT da Oracle e preserva SSH e regras da infraestrutura.
      "$rules" -C INPUT -p tcp -m multiport --dports "80,443,$MEDIA_PORT" -j ACCEPT 2>/dev/null ||
        "$rules" -I INPUT 1 -p tcp -m multiport --dports "80,443,$MEDIA_PORT" -j ACCEPT
      "$rules" -C INPUT -p udp --dport "$MEDIA_PORT" -j ACCEPT 2>/dev/null ||
        "$rules" -I INPUT 1 -p udp --dport "$MEDIA_PORT" -j ACCEPT
    done
    netfilter-persistent save
    ;;
esac

log "Subindo tudo"
systemctl daemon-reload
systemctl enable -q --now telinha-server telinha-sfu caddy
if [ "$ACTIVATE_DUCKDNS" = 1 ] && [ -f /etc/telinha/duckdns.env ]; then
  systemctl enable -q --now duckdns.timer
else
  systemctl disable -q --now duckdns.timer 2>/dev/null || true
fi
systemctl enable -q --now telinha-keepalive.timer
systemctl restart telinha-server telinha-sfu
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 3
systemctl --no-pager --lines=0 status telinha-server telinha-sfu caddy | grep -E '●|Active:' || true
echo
echo "Pronto: https://$DOMAIN"
echo "Chaves de propriedade e serviços preservadas em /etc/telinha/telinha.env (não exibidas nos logs)."
