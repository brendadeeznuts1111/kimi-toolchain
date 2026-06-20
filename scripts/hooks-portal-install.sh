#!/usr/bin/env bash
# Install convergence pre-push guard only — no format, typecheck, or other hooks.
#
# Portal slices carry only the convergence gate. Full kimi-githooks
# (format, typecheck, guardian, R-Score, sync) remain in the parent repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(bash "${SCRIPT_DIR}/resolve-repo-root.sh" 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" || ! -f "${REPO_ROOT}/package.json" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
HOOK_SRC="${REPO_ROOT}/scripts/pre-push-portal.sh"

if [[ ! -f "${HOOK_SRC}" ]]; then
  echo "✗ scripts/pre-push-portal.sh not found at ${HOOK_SRC}"
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ not inside a git repository"
  exit 1
fi

# Slices inside kimi-toolchain share one .git/hooks — do not replace kimi-githooks here.
if [[ -f "${REPO_ROOT}/src/bin/kimi-githooks.ts" && "${KIMI_PORTAL_HOOKS_FORCE:-}" != "1" ]]; then
  echo "↷ portal hook install skipped (kimi-toolchain repo — shared .git/hooks)"
  echo "  Convergence check: bun run test:portal-convergence"
  echo "  Full hook policy: kimi-githooks install"
  exit 0
fi

GIT_ROOT="$(git rev-parse --show-toplevel)"
GIT_DIR="$(git -C "${GIT_ROOT}" rev-parse --git-dir)"
HOOKS_DIR="${GIT_DIR}/hooks"
[[ "${GIT_DIR}" = /* ]] || HOOKS_DIR="${GIT_ROOT}/${GIT_DIR}/hooks"
HOOK_DST="${HOOKS_DIR}/pre-push"

mkdir -p "${HOOKS_DIR}"
chmod +x "${HOOK_SRC}"

echo "→ Installing convergence pre-push guard only (portal slice)"

# Strip format/commit/other hooks — portal slices must not run them.
OTHER_HOOKS=(
  pre-commit
  commit-msg
  prepare-commit-msg
  post-commit
  post-checkout
  post-merge
  pre-rebase
)
for hook in "${OTHER_HOOKS[@]}"; do
  if [[ -e "${HOOKS_DIR}/${hook}" ]]; then
    rm -f "${HOOKS_DIR}/${hook}"
    echo "  removed ${hook}"
  fi
done

ln -sf "${HOOK_SRC}" "${HOOK_DST}"
chmod +x "${HOOK_DST}"

echo "✓ Pre-push guard installed → ${HOOK_DST}"
echo "  Enforces: build:portal:local:json + converged: true (no format/lint/test suite)"
echo "  No format/typecheck hooks installed — full policy: kimi-githooks install (parent repo)"