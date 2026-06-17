#!/usr/bin/env bash
# Plugin command wrapper: ensure PATH includes bun and ~/.local/bin.
set -euo pipefail

# Common paths for bun on this machine.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/homebrew/bin:$HOME/opt/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="${1:-}"
shift || true

cd "$SCRIPT_DIR"
exec bun run "$SCRIPT_NAME" "$@"
