#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 1. Check if OVSX_PAT is already set in environment (Linux, Windows/Git Bash, macOS, CI)
OVSX_PAT="${OVSX_PAT:-}"

# 2. Fallback to macOS Keychain if empty and 'security' command is available (macOS)
if [[ -z "$OVSX_PAT" ]] && command -v security >/dev/null 2>&1; then
  OVSX_PAT="$(security find-generic-password -a "$USER" -s ovsx_pat -w 2>/dev/null || true)"
fi

# 3. If still not found, provide helpful instructions for all operating systems
if [[ -z "$OVSX_PAT" ]]; then
  echo "❌ Error: OVSX_PAT token not found for Open VSX publishing."
  echo ""
  echo "Options to configure it:"
  if command -v security >/dev/null 2>&1; then
    echo "  • macOS Keychain: security add-generic-password -a \"$USER\" -s ovsx_pat -w"
  fi
  echo "  • Environment variable (Linux / Windows / macOS): export OVSX_PAT=\"your_token_here\""
  echo "    or run: OVSX_PAT=\"your_token\" npm run publish:ovsx:local"
  exit 1
fi

echo "📦 Compiling and packaging extension..."
npm run compile
npx @vscode/vsce package --no-yarn --skip-license

VSIX_FILE="$(ls -1t ./*.vsix | head -n 1 || true)"
if [[ -z "$VSIX_FILE" ]]; then
  echo "❌ Error: No generated .vsix package was found."
  exit 1
fi

echo "🚀 Publishing $VSIX_FILE to Open VSX..."
npx ovsx publish "$VSIX_FILE" -p "$OVSX_PAT"

echo "✅ Open VSX publishing completed successfully."
