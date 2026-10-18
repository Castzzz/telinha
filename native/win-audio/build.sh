#!/bin/sh
# Compila o telinha-audio.exe (som de um app só no Windows) a partir do Linux.
# Precisa do mingw-w64: sudo pacman -S mingw-w64-gcc
set -e
cd "$(dirname "$0")"
mkdir -p ../../electron/bin
x86_64-w64-mingw32-g++ -O2 -municode -static -s \
  -o ../../electron/bin/telinha-audio.exe telinha-audio.cpp \
  -lole32
echo "ok: electron/bin/telinha-audio.exe"
