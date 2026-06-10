#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    exec bun run src/bin/kimi-doctor.ts workspace --help
  fi
done
exec bun run src/bin/kimi-doctor.ts workspace cleanup "$@"
