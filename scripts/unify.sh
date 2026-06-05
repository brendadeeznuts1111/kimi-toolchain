#!/usr/bin/env bash
# One-shot local unification: sync runtime, install wrappers, validate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══ kimi-toolchain unify ═══"
echo "Repo: ${REPO_ROOT}"
echo ""

# Legacy Kimi migrate (non-fatal if nothing to migrate)
if [[ -d "${HOME}/.kimi" ]]; then
  echo "→ Running kimi migrate (legacy ~/.kimi present)..."
  kimi migrate 2>/dev/null || echo "  ⚠ kimi migrate skipped or failed — review manually"
fi

echo "→ bun run sync"
bun run scripts/sync-to-desktop.ts

echo "→ install-bin-wrappers"
bash scripts/install-bin-wrappers.sh

# Remove stale backup binary if present
if [[ -f "${HOME}/.kimi-code/bin/kimi.bak" ]]; then
  rm -f "${HOME}/.kimi-code/bin/kimi.bak"
  echo "→ removed ~/.kimi-code/bin/kimi.bak"
fi

echo ""
echo "→ kimi doctor (Kimi Code)"
kimi doctor || true

echo ""
echo "→ kimi-doctor --quick (toolchain)"
bun run src/bin/kimi-doctor.ts --quick || true

echo ""
echo "→ quality gates (format:check, lint, test)"
bun run format:check
bun run lint
bun test

echo ""
echo "✅ Unify complete. See UNIFIED.md for the full map."
