#!/usr/bin/env bash
# Pre-session memory gate + daily quick doctor check.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "── Memory pressure ──"
memory_pressure -Q 2>/dev/null || echo "(memory_pressure unavailable)"

PCT=$(memory_pressure -Q 2>/dev/null | awk -F': ' '/free percentage/ {gsub(/%/,"",$2); print $2}')
if [[ -n "${PCT:-}" && "${PCT}" -lt 30 ]]; then
  echo "⚠ CRITICAL: system memory free ${PCT}% — quit Chrome and heavy apps before agent sessions"
  exit 1
fi

echo ""
echo "── Kimi doctor (quick) ──"
bun run "$ROOT/src/bin/kimi-doctor.ts" --quick
