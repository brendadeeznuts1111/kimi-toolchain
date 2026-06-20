#!/usr/bin/env bash
# Portal slices carry only the convergence gate. Full kimi-githooks remain in the parent repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_root() {
  if [[ -n "${KIMI_PROJECT_ROOT:-}" && -f "${KIMI_PROJECT_ROOT}/scripts/hooks-portal-install.sh" ]]; then
    echo "${KIMI_PROJECT_ROOT}"
    return 0
  fi
  local git_top
  git_top="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "${git_top}" && -f "${git_top}/scripts/hooks-portal-install.sh" ]]; then
    echo "${git_top}"
    return 0
  fi
  if [[ -f "${HOME}/kimi-toolchain/scripts/hooks-portal-install.sh" ]]; then
    echo "${HOME}/kimi-toolchain"
    return 0
  fi
  return 1
}

REPO_ROOT="$(resolve_root)" || {
  echo "✗ kimi-toolchain root not found (create this workspace inside the repo or set KIMI_PROJECT_ROOT)"
  exit 1
}

exec bash "${REPO_ROOT}/scripts/hooks-portal-install.sh"