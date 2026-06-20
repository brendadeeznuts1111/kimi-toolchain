#!/usr/bin/env sh
set -eu

ROOT="${KIMI_PROJECT_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || true
fi
if [ -z "$ROOT" ] || [ ! -f "$ROOT/src/bin/kimi-doctor.ts" ]; then
  echo "✗ status: kimi-doctor not found"
  exit 1
fi
exec bun run "$ROOT/src/bin/kimi-doctor.ts" --artifacts-list artifact-portal