#!/bin/bash
# Volta os dados da sala da nuvem a partir de um backup do `npm run backup`. Roda no SEU PC:
#
#   npm run restore -- ~/Teletela-backups/teletela-dados-AAAA-MM-DD_HH-MM-SS.tar.gz
#
# ATENÇÃO: substitui os canais, o histórico e o soundboard que estão na VM agora pelos do
# backup (antes ele faz um backup do estado atual, por garantia). O servidor reinicia.
set -euo pipefail
cd "$(dirname "$0")/../.."

file="${1:?passe o arquivo do backup: npm run restore -- caminho/do/backup.tar.gz}"
[ -f "$file" ] || { echo "❌ Arquivo não encontrado: $file" >&2; exit 1; }
tar -tzf "$file" | grep -q '^data/' || { echo "❌ Esse arquivo não parece um backup do Teletela." >&2; exit 1; }

VM="${VM:-opc@163.176.189.41}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oracle_telinha}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "$VM")

read -r -p "Substituir os dados da sala pelos de $(basename "$file")? Digite SIM: " ok
[ "$ok" = "SIM" ] || { echo "Cancelado."; exit 1; }

echo "== Backup do estado atual, por garantia"
bash deploy/oracle/backup.sh

echo "== Enviando e restaurando"
scp -q -i "$SSH_KEY" -o BatchMode=yes "$file" "$VM:/tmp/teletela-restore.tar.gz"
"${SSH[@]}" 'set -e
  sudo systemctl stop telinha-server
  sudo rm -rf /opt/telinha/data.restaurando && sudo mkdir -p /opt/telinha/data.restaurando
  sudo tar -xzf /tmp/teletela-restore.tar.gz -C /opt/telinha/data.restaurando
  sudo rm -rf /opt/telinha/data && sudo mv /opt/telinha/data.restaurando/data /opt/telinha/data
  sudo rm -rf /opt/telinha/data.restaurando /tmp/teletela-restore.tar.gz
  sudo chown -R telinha:telinha /opt/telinha/data
  sudo systemctl start telinha-server'
echo "✅ Dados restaurados e servidor no ar."
