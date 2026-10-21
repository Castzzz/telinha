#!/bin/bash
# Volta os dados da sala da nuvem a partir de um backup do `npm run backup`. Roda no SEU PC:
#
#   npm run restore -- ~/Teletela-backups/teletela-dados-AAAA-MM-DD_HH-MM-SS.tar.gz
#
# ATENÇÃO: substitui os canais, o histórico e o soundboard que estão na VM agora pelos do
# backup (antes ele faz um backup do estado atual, por garantia). Se o backup tiver os
# segredos (/etc/telinha), eles também voltam: mesma senha de admin de antes. O servidor reinicia.
# Numa VM nova: rode o deploy primeiro (instala tudo) e depois o restore (docs/RECUPERAR-SERVIDOR.md).
set -euo pipefail
cd "$(dirname "$0")/../.."

file="${1:?passe o arquivo do backup: npm run restore -- caminho/do/backup.tar.gz}"
[ -f "$file" ] || { echo "❌ Arquivo não encontrado: $file" >&2; exit 1; }
tar -tzf "$file" | grep -q '^data/' || { echo "❌ Esse arquivo não parece um backup do Teletela." >&2; exit 1; }

source deploy/oracle/config.sh
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "$VM")

read -r -p "Substituir os dados da sala pelos de $(basename "$file")? Digite SIM: " ok
[ "$ok" = "SIM" ] || { echo "Cancelado."; exit 1; }

echo "== Backup do estado atual, por garantia (VM nova sem dados: pode falhar, tudo bem)"
bash deploy/oracle/backup.sh || echo "   (sem backup do estado atual; seguindo)"

echo "== Enviando e restaurando"
scp -q -i "$SSH_KEY" -o BatchMode=yes "$file" "$VM:/tmp/teletela-restore.tar.gz"
"${SSH[@]}" 'set -e
  sudo systemctl stop telinha-server telinha-sfu
  sudo rm -rf /opt/telinha/data.restaurando && sudo mkdir -p /opt/telinha/data.restaurando
  sudo tar -xzf /tmp/teletela-restore.tar.gz -C /opt/telinha/data.restaurando
  sudo rm -rf /opt/telinha/data && sudo mv /opt/telinha/data.restaurando/data /opt/telinha/data
  # Segredos (backups novos têm): mesma senha de admin e mesmo segredo do SFU de antes
  if sudo test -f /opt/telinha/data.restaurando/telinha/telinha.env; then
    sudo install -m 600 -o root -g root /opt/telinha/data.restaurando/telinha/telinha.env /etc/telinha/telinha.env
    echo "   segredos (senha de admin) restaurados"
  fi
  if sudo test -f /opt/telinha/data.restaurando/telinha/duckdns.env; then
    sudo install -m 600 -o root -g root /opt/telinha/data.restaurando/telinha/duckdns.env /etc/telinha/duckdns.env
    sudo systemctl enable -q --now duckdns.timer || true
    sudo systemctl start duckdns.service || true
  fi
  sudo rm -rf /opt/telinha/data.restaurando /tmp/teletela-restore.tar.gz
  sudo chown -R telinha:telinha /opt/telinha/data
  sudo systemctl start telinha-server telinha-sfu'
echo "✅ Dados restaurados e servidor no ar."
