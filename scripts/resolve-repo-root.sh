#!/usr/bin/env bash
# Resolve kimi-toolchain repo root; canonical via ~/.config/shell/machine-paths.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${HOME}/.config/shell/machine-paths.sh" ]]; then
  # shellcheck source=/dev/null
  source "${HOME}/.config/shell/machine-paths.sh"
fi
CANONICAL="${KIMI_TOOLCHAIN_ROOT:-${HOME}/kimi-toolchain}"

has_pkg() {
  [[ -f "${1}/package.json" ]]
}

git_toplevel() {
  git -C "${1}" rev-parse --show-toplevel 2>/dev/null || true
}

is_ephemeral_worktree() {
  [[ "${1}" == *"wt-match"* || "${1}" == *".codex/worktrees"* || "${1}" == *".grok/worktrees"* || "${1}" == *"herdr-worktrees"* ]]
}

if has_pkg "${REPO_ROOT}"; then
  GIT_TOP="$(git_toplevel "${REPO_ROOT}")"
  if [[ -n "${GIT_TOP}" ]] && is_ephemeral_worktree "${GIT_TOP}" && ! has_pkg "${GIT_TOP}" && has_pkg "${CANONICAL}"; then
    echo "⚠ Cursor worktree (${GIT_TOP}) — using ${CANONICAL}" >&2
    echo "${CANONICAL}"
    exit 0
  fi
  echo "${REPO_ROOT}"
  exit 0
fi

if has_pkg "${CANONICAL}"; then
  echo "⚠ missing package.json at ${REPO_ROOT} — using ${CANONICAL}" >&2
  echo "${CANONICAL}"
  exit 0
fi

echo "${REPO_ROOT}"