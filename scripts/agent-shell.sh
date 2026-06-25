#!/usr/bin/env bash
# agent-shell.sh — scrub Bun install env overrides, then exec.
#
# Agent harnesses may inject BUN_INSTALL_CACHE_DIR=~/.bun/... after zshenv.
#   bash scripts/agent-shell.sh bun run test:fast
#   bun run agent:shell -- bun run check:fast
#   bash scripts/agent-shell.sh --status
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$HOME/.config/shell/machine-paths.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.config/shell/machine-paths.sh"
fi

ROOT="${KIMI_TOOLCHAIN_ROOT:-$SCRIPT_ROOT}"

if [[ -f "$HOME/.config/shell/agent-env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.config/shell/agent-env.sh"
else
  scrub_agent_bun_env() {
    unset BUN_INSTALL_CACHE_DIR BUN_INSTALL_GLOBAL_STORE BUN_RUNTIME_TRANSPILER_CACHE_PATH \
      BUN_TMPDIR NPM_CONFIG_CACHE 2>/dev/null || true
  }
  agent_bun_env_status() {
    echo "agent-env: ~/.config/shell/agent-env.sh not found"
  }
  scrub_agent_bun_env
fi

usage() {
  cat <<'EOF'
Usage:
  scripts/agent-shell.sh [--status] [--verbose] -- <command> [args...]
  bun run agent:shell -- <command> [args...]

Strips BUN_INSTALL_CACHE_DIR and related overrides before running <command>.
Machine install cache SSOT: ~/.bunfig.toml — not shell env.
EOF
}

if [[ "${1:-}" == "--status" ]]; then
  agent_bun_env_status
  exit 0
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--verbose" ]]; then
  export AGENT_ENV_VERBOSE=1
  scrub_agent_bun_env
  shift
fi

if [[ $# -eq 0 || "${1:-}" == "--" && $# -eq 1 ]]; then
  usage >&2
  exit 2
fi

if [[ "${1:-}" == "--" ]]; then
  shift
fi

cd "$ROOT"
exec "$@"