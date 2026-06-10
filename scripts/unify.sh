#!/usr/bin/env bash
# One-shot local unification: sync runtime, install wrappers, validate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

bash scripts/verify-workspace.sh
bash scripts/cleanup-legacy-workspace.sh

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
echo "→ memory-check"
bash scripts/memory-check.sh || echo "  ⚠ memory-check reported pressure (non-fatal)"

echo ""
echo "→ kimi doctor (Kimi Code)"
set +e
kimi doctor
KIMI_DOCTOR_EXIT=$?
set -e
if [[ $KIMI_DOCTOR_EXIT -ne 0 ]]; then
  echo "  ⚠ kimi doctor exited $KIMI_DOCTOR_EXIT — review Kimi Code config"
fi

echo ""
echo "→ kimi-doctor --quick --soft-system (toolchain)"
bun run src/bin/kimi-doctor.ts --quick --soft-system

echo ""
echo "→ quality gates (check)"
bun run check

echo ""
echo "✅ Unify complete. See UNIFIED.md for the full map."
