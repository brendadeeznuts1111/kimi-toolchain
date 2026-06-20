#!/usr/bin/env sh
# Resolve kimi-toolchain root and delegate to build-portal.ts.
set -eu

ROOT="${KIMI_PROJECT_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || true
fi
if [ -z "$ROOT" ] || [ ! -f "$ROOT/scripts/build-portal.ts" ]; then
  echo "✗ artifact-portal-convergence: kimi-toolchain root not found"
  echo "  Create this project inside the kimi-toolchain repo, or set KIMI_PROJECT_ROOT"
  exit 1
fi
exec bun run "$ROOT/scripts/build-portal.ts" "$@"