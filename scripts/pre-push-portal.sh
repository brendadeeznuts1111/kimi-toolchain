#!/usr/bin/env sh
# Artifact Portal convergence guard — pre-push hook.
#
# Fast, deterministic (--local-only), single pass:
#   build:portal --local-only --json + jq (converged: true, three components)
# Does NOT run bun test or kimi-githooks — no repo-wide unit suite.
#
# Install (standalone portal slice only — not inside kimi-toolchain):
#   bun run hooks:install   # from bun-create artifact-portal-convergence workspace
#
# Inside kimi-toolchain: use kimi-githooks install; optional smoke: test:portal-convergence:fast

set -eu

HOOK_BUDGET_MS=50000
WARN_AT_MS=40000
CONVERGED_IDS='["canvas","dashboard","herdr"]'

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

if ! command -v jq >/dev/null 2>&1; then
  echo "✗ pre-push-portal: jq not found on PATH (brew install jq)"
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
    echo "  Profile: bun run build:portal --local-only --json"
    exit 1
  fi
}

echo "→ portal convergence guard (--local-only, no test suite)"
BUILD_JSON=$(bun run build:portal:local:json 2>/dev/null) || {
  echo "✗ build:portal:local:json failed"
  echo "  Fix: bun run build:portal:local:json"
  exit 1
}
warn_if_slow

if ! printf '%s\n' "$BUILD_JSON" | jq -e --argjson ids "$CONVERGED_IDS" '
  .converged == true
  and (.convergedComponents | map(.id) | sort) == ($ids | sort)
  and .benchmark.source == "local-loop"
' >/dev/null; then
  echo "✗ manifest not fully converged"
  echo "  Expected: converged=true, components=canvas+dashboard+herdr, source=local-loop"
  printf '%s\n' "$BUILD_JSON" | jq '{converged, source: .benchmark.source, components: [.convergedComponents[].id]}' 2>/dev/null \
    || printf '%s\n' "$BUILD_JSON"
  exit 1
fi

ELAPSED=$(elapsed_ms)
echo "✓ Artifact Portal convergence preserved (${ELAPSED}ms)"
exit 0