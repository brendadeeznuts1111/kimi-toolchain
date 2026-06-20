#!/usr/bin/env sh
set -eu

ROOT="${KIMI_PROJECT_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || true
fi
if [ -z "$ROOT" ] || [ ! -f "$ROOT/test/portal-convergence.unit.test.ts" ]; then
  echo "✗ verify: kimi-toolchain test/portal-convergence.unit.test.ts not found"
  exit 1
fi
exec bun test "$ROOT/test/portal-convergence.unit.test.ts"