#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(bash "$(dirname "$0")/resolve-repo-root.sh")"
export KIMI_PROJECT_ROOT="${REPO_ROOT}"
cd "$REPO_ROOT"
exec bun run src/bin/kimi-doctor.ts workspace verify "$@"
