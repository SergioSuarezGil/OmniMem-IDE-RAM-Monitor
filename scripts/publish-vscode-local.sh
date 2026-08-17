#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 1. Check if VSCE_PAT is already set in environment (Linux, Windows/Git Bash, macOS, CI)
VSCE_PAT="${VSCE_PAT:-}"

# 2. Fallback to macOS Keychain if empty and 'security' command is available (macOS)
if [[ -z "$VSCE_PAT" ]] && command -v security >/dev/null 2>&1; then
  VSCE_PAT="$(security find-generic-password -a "$USER" -s vsce_pat -w 2>/dev/null || true)"
fi

# 3. If still not found, provide helpful instructions for all operating systems
if [[ -z "$VSCE_PAT" ]]; then
  echo "❌ Error: VSCE_PAT token not found for Visual Studio Marketplace publishing."
  echo ""
  echo "Options to configure it:"
  if command -v security >/dev/null 2>&1; then
    echo "  • macOS Keychain: security add-generic-password -a \"$USER\" -s vsce_pat -w"
  fi
  echo "  • Environment variable (Linux / Windows / macOS): export VSCE_PAT=\"your_token_here\""
  echo "    or run: VSCE_PAT=\"your_token\" npm run publish:vscode:local"
  exit 1
fi

echo "📦 Compiling and packaging extension..."
npm run compile

echo "🚀 Publishing to Visual Studio Code Marketplace..."
npx @vscode/vsce publish --no-yarn --skip-license --pat "$VSCE_PAT"

echo "✅ Visual Studio Marketplace publishing completed successfully."
