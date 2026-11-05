#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
for ferramenta in flatpak flatpak-builder; do
  if ! command -v "$ferramenta" >/dev/null 2>&1; then
    echo "Falta instalar $ferramenta para gerar o Flatpak do Teletela." >&2
    exit 1
  fi
done

# O empacotador busca o runtime, SDK e BaseApp no Flathub do usuário.
if ! flatpak remotes --user --columns=name | grep -qx flathub; then
  echo 'Adicione o Flathub: flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo' >&2
  exit 1
fi

exec ./node_modules/.bin/electron-builder --linux flatpak --publish never "$@"
