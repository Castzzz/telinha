#!/bin/bash
# Empresta a conexão deste PC ao bot da Oracle por um túnel SSH temporário.
set -euo pipefail
cd "$(dirname "$0")/../.."
source deploy/oracle/config.sh

MUSIC_RELAY_PORT="${MUSIC_RELAY_PORT:-40001}"
if [[ ! "$MUSIC_RELAY_PORT" =~ ^[0-9]{4,5}$ ]] || ((10#$MUSIC_RELAY_PORT < 1024 || 10#$MUSIC_RELAY_PORT > 65535)); then
  echo "Escolha MUSIC_RELAY_PORT entre 1024 e 65535." >&2
  exit 1
fi

printf 'Abrindo a saída de música pelo seu PC para %s.\n' "$VM"
printf 'Endereço na VM: socks5://127.0.0.1:%s\n' "$MUSIC_RELAY_PORT"
echo 'Mantenha este PC ligado e este terminal aberto; Ctrl+C encerra a ponte.'
echo 'A sala usará esta saída somente depois de configurar MUSIC_PROXY no serviço.'

# Uma conexão própria permite encerrar a ponte sem afetar outros acessos SSH.
exec ssh -NT -i "$SSH_KEY" \
  -o BatchMode=yes -o ConnectTimeout=20 -o ExitOnForwardFailure=yes \
  -o ControlMaster=no -o ControlPath=none -o ForwardAgent=no \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  -o 'PermitRemoteOpen=*:443' \
  -R "127.0.0.1:${MUSIC_RELAY_PORT}" "$VM"
