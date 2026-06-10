#!/usr/bin/env bash
# git push + mandatory desktop sync (use when hooks are skipped or for explicit workflow).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

git push "$@"
bun run sync
echo "✓ Pushed and synced ~/.kimi-code/"
