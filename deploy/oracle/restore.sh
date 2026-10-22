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
# Lê a lista inteira: grep -q fecha o pipe cedo e faz o tar falhar com SIGPIPE.
tar -tzf "$file" | grep '^data/' >/dev/null || { echo "❌ Esse arquivo não parece um backup do Teletela." >&2; exit 1; }

source deploy/oracle/config.sh
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "$VM")
ACTIVATE_DUCKDNS="${ACTIVATE_DUCKDNS:-1}"
case "$ACTIVATE_DUCKDNS" in
  0|1) ;;
  *) echo "ACTIVATE_DUCKDNS precisa ser 0 ou 1." >&2; exit 1 ;;
esac

read -r -p "Substituir os dados da sala pelos de $(basename "$file")? Digite SIM: " ok
[ "$ok" = "SIM" ] || { echo "Cancelado."; exit 1; }

echo "== Backup do estado atual, por garantia (VM nova sem dados: pode falhar, tudo bem)"
bash deploy/oracle/backup.sh || echo "   (sem backup do estado atual; seguindo)"

echo "== Enviando e restaurando"
scp -q -i "$SSH_KEY" -o BatchMode=yes "$file" "$VM:/tmp/teletela-restore.tar.gz"
"${SSH[@]}" "sudo env ACTIVATE_DUCKDNS='$ACTIVATE_DUCKDNS' bash -s" <<'RESTORE'
  set -e
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
    if [ "$ACTIVATE_DUCKDNS" = 1 ]; then
      sudo systemctl enable -q --now duckdns.timer
      sudo systemctl start duckdns.service
    else
      sudo systemctl disable -q --now duckdns.timer
    fi
  fi
  sudo rm -rf /opt/telinha/data.restaurando /tmp/teletela-restore.tar.gz
  sudo chown -R telinha:telinha /opt/telinha/data
  sudo systemctl start telinha-server telinha-sfu
RESTORE
echo "✅ Dados restaurados e servidor no ar."
