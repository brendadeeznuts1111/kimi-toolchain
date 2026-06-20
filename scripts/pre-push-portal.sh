#!/usr/bin/env sh
# Artifact Portal convergence guard — pre-push hook.
#
# Fast, deterministic (--gate = local-loop dry-run), single pass:
#   build:portal:gate — validates converged canvas+dashboard+herdr without writing artifacts
# Does NOT run bun test or kimi-githooks — no repo-wide unit suite.
#
# Install (standalone portal slice only — not inside kimi-toolchain):
#   bun run hooks:install   # from bun-create artifact-portal-convergence workspace
#
# Inside kimi-toolchain: use kimi-githooks install (portal:gate in run-gates pre-push).

set -eu

HOOK_BUDGET_MS=50000
WARN_AT_MS=40000

HOOK_SELF="$0"
while [ -L "$HOOK_SELF" ]; do
  LINK=$(readlink "$HOOK_SELF") || break
  case "$LINK" in
    /*) HOOK_SELF="$LINK" ;;
    *) HOOK_SELF="$(CDPATH= cd -- "$(dirname "$HOOK_SELF")" && pwd)/$LINK" ;;
  esac
done
HOOK_DIR=$(CDPATH= cd -- "$(dirname "$HOOK_SELF")" && pwd)
ROOT=$(bash "$HOOK_DIR/resolve-repo-root.sh" 2>/dev/null) || ROOT=""
if [ -z "$ROOT" ] || [ ! -f "$ROOT/package.json" ]; then
  echo "✗ pre-push-portal: kimi-toolchain root not found (missing package.json)"
  exit 1
fi
cd "$ROOT" || exit 1

# Skip when Git supplies no refs (tag delete, etc.)
if [ -t 0 ]; then
  :
else
  PUSH_REFS=$(cat)
  if [ -z "$PUSH_REFS" ]; then
    echo "✓ No refs to push; skipping portal convergence checks"
    exit 0
  fi
  NON_DELETE_REFS=$(printf "%s\n" "$PUSH_REFS" | awk '$2 !~ /^0+$/ { print }')
  if [ -z "$NON_DELETE_REFS" ]; then
    echo "✓ Only deleted refs; skipping portal convergence checks"
    exit 0
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ pre-push-portal: bun not found on PATH"
  exit 1
fi

START_MS=$(bun -e 'console.log(Date.now())')

elapsed_ms() {
  NOW_MS=$(bun -e 'console.log(Date.now())')
  echo $((NOW_MS - START_MS))
}

warn_if_slow() {
  ELAPSED=$(elapsed_ms)
  if [ "$ELAPSED" -ge "$WARN_AT_MS" ]; then
    echo "⚠ pre-push-portal: hook elapsed ${ELAPSED}ms (warn ≥${WARN_AT_MS}ms, budget ${HOOK_BUDGET_MS}ms)"
  fi
  if [ "$ELAPSED" -ge "$HOOK_BUDGET_MS" ]; then
    echo "✗ pre-push-portal: hook exceeded budget (${HOOK_BUDGET_MS}ms)"
    echo "  Profile: bun run build:portal:gate"
    exit 1
  fi
}

echo "→ portal convergence guard (build:portal:gate — dry-run, local-loop)"
if ! bun run build:portal:gate 2>/dev/null; then
  echo "✗ build:portal:gate failed"
  echo "  Fix: bun run build:portal:gate"
  exit 1
fi
warn_if_slow

ELAPSED=$(elapsed_ms)
echo "✓ Artifact Portal convergence preserved (${ELAPSED}ms)"
exit 0