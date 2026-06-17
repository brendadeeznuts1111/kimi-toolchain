#!/usr/bin/env bash
# Link the kimi-toolchain Herdr plugin into the running Herdr server.
# Idempotent: re-linking the same plugin path updates the manifest.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="${REPO_ROOT}/herdr-plugin"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "warn: herdr-plugin directory not found at $PLUGIN_DIR"
  exit 0
fi

if ! command -v herdr >/dev/null 2>&1; then
  echo "warn: herdr not on PATH; skip plugin link"
  exit 0
fi

# Ensure wrapper is executable.
chmod +x "$PLUGIN_DIR/run.sh"

# Build dependencies first if needed.
if [[ -f "$PLUGIN_DIR/package.json" ]] && command -v bun >/dev/null 2>&1; then
  echo "[install-herdr-plugin] installing plugin dependencies"
  (cd "$PLUGIN_DIR" && bun install)
fi

# Link (or re-link) the plugin. Herdr persists linked plugins across restarts.
echo "[install-herdr-plugin] linking $PLUGIN_DIR"
herdr plugin link "$PLUGIN_DIR" --enabled || {
  echo "warn: herdr plugin link failed; ensure Herdr server is running"
  exit 0
}

echo "[install-herdr-plugin] done"
