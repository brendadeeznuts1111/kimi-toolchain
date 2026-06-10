#!/usr/bin/env bash
# git push + mandatory desktop sync (use when hooks are skipped or for explicit workflow).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

git push "$@"
bun run sync
bash scripts/install-bin-wrappers.sh
bun run src/bin/kimi-doctor.ts --quick --soft-system || echo "  ⚠ kimi-doctor reported issues — review output"
echo "✓ Pushed, synced ~/.kimi-code/, and refreshed wrappers"
