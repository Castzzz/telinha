#!/bin/bash
# Baixa uma cópia dos dados da sala da nuvem (canais, histórico dos canais de texto e
# imagens deles, soundboard) pro SEU PC. Roda no seu PC:
#
#   npm run backup
#
# Os backups ficam em ~/Teletela-backups (ou BACKUP_DIR) e só os 15 mais novos são mantidos.
# O deploy também faz um backup antes de mexer na VM.
# Variáveis: VM (padrão opc@163.176.189.41), SSH_KEY, BACKUP_DIR, KEEP.
set -euo pipefail

VM="${VM:-opc@163.176.189.41}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oracle_telinha}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Teletela-backups}"
KEEP="${KEEP:-15}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "$VM")

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/teletela-dados-$(date +%Y-%m-%d_%H-%M-%S).tar.gz"
tmp="$file.parcial"

echo "== Baixando os dados da sala ($VM)"
# As imagens do chat da call ficam de fora: elas já somem a cada reinício do servidor
if ! "${SSH[@]}" 'sudo test -d /opt/telinha/data && sudo tar -czf - --exclude=data/chat-images -C /opt/telinha data' > "$tmp"; then
  rm -f "$tmp"
  echo "❌ Não deu pra baixar o backup." >&2
  exit 1
fi
mv "$tmp" "$file"
echo "   $(du -h "$file" | cut -f1)  $file"

# Fica só com os mais novos
ls -1t "$BACKUP_DIR"/teletela-dados-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "   $(ls -1 "$BACKUP_DIR"/teletela-dados-*.tar.gz | wc -l) backup(s) em $BACKUP_DIR"
