#!/bin/bash
# Liga (ou desliga) o backup automático da sala no SEU PC Linux: um timer do systemd do
# seu usuário roda o backup.sh uma vez por dia. Se o PC estiver desligado na hora, roda
# assim que ligar. Roda no seu PC:
#
#   npm run backup:auto            # liga
#   npm run backup:auto -- off     # desliga
#
# Ver quando roda / se deu certo:
#   systemctl --user list-timers teletela-backup.timer
#   journalctl --user -u teletela-backup -n 20
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"

if [ "${1:-}" = "off" ]; then
  systemctl --user disable --now teletela-backup.timer 2>/dev/null || true
  rm -f "$UNIT_DIR/teletela-backup.service" "$UNIT_DIR/teletela-backup.timer"
  systemctl --user daemon-reload
  echo "Backup automático desligado."
  exit 0
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/teletela-backup.service" <<UNIT
[Unit]
Description=Backup dos dados da sala do Teletela (VM da Oracle)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $REPO/deploy/oracle/backup.sh
UNIT

cat > "$UNIT_DIR/teletela-backup.timer" <<'UNIT'
[Unit]
Description=Backup diário da sala do Teletela

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
# PC desligado na hora: faz o backup quando ligar
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now teletela-backup.timer
echo "Backup automático ligado (1x por dia). Próxima vez:"
systemctl --user list-timers teletela-backup.timer --no-pager | head -3
