#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OVSX_PAT="$(security find-generic-password -a "$USER" -s ovsx_pat -w 2>/dev/null || true)"
if [[ -z "$OVSX_PAT" ]]; then
  echo "No se encontro token en Keychain (service: ovsx_pat)."
  echo "Guardalo primero con: security add-generic-password -a \"$USER\" -s ovsx_pat -w"
  exit 1
fi

echo "Compilando y empaquetando extension..."
npm run compile
npx @vscode/vsce package --no-yarn --skip-license

VSIX_FILE="$(ls -1t ./*.vsix | head -n 1 || true)"
if [[ -z "$VSIX_FILE" ]]; then
  echo "No se encontro archivo .vsix para publicar."
  exit 1
fi

echo "Publicando $VSIX_FILE en Open VSX..."
npx ovsx publish "$VSIX_FILE" -p "$OVSX_PAT"

echo "Publicacion Open VSX completada."
