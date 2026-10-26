#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [[ ! -d "$ANDROID_HOME/platforms/android-35" ]]; then
  echo "Instale a plataforma Android 35 no SDK Manager do Android Studio."
  exit 1
fi
if [[ -z "${JAVA_HOME:-}" ]] && ! command -v java >/dev/null 2>&1; then
  for candidate in "$HOME"/.jdks/jbr-* /opt/android-studio/jbr "$HOME"/Downloads/android-studio*/android-studio/jbr; do
    if [[ -x "$candidate/bin/java" ]]; then export JAVA_HOME="$candidate"; break; fi
  done
fi
if [[ -z "${JAVA_HOME:-}" ]] && ! command -v java >/dev/null 2>&1; then
  echo "Instale um JDK 17 ou mais novo e configure JAVA_HOME."
  exit 1
fi

"$ROOT/android/gradlew" -p "$ROOT/android" assembleDebug lintDebug "$@"
mkdir -p "$ROOT/dist"
cp "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" "$ROOT/dist/Teletela-Android-teste.apk"
echo "APK de teste: $ROOT/dist/Teletela-Android-teste.apk"
