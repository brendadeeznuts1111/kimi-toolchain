#!/usr/bin/env bash
# Verify Cursor/shell cwd is the canonical kimi-toolchain clone.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(basename "$REPO_ROOT")"
PHYSICAL="$(cd "$REPO_ROOT" && pwd -P)"
PHYSICAL_BASE="$(basename "$PHYSICAL")"
CANONICAL="kimi-toolchain"
LEGACY="kimicode-cli"

echo "── Workspace verify ─────────────────────────────────────────"
echo "  Path: ${REPO_ROOT}"
if [[ "$REPO_ROOT" != "$PHYSICAL" ]]; then
  echo "  Physical: ${PHYSICAL}"
fi

if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
  echo "  ✗ No package.json — not a kimi-toolchain repo root"
  exit 1
fi

PKG_NAME="$(bun -e "console.log((await Bun.file('${REPO_ROOT}/package.json').json()).name)" 2>/dev/null || echo "")"
if [[ "$PKG_NAME" != "$CANONICAL" ]]; then
  echo "  ✗ package.json name is '${PKG_NAME}' — expected ${CANONICAL}"
  exit 1
fi

if [[ "$PHYSICAL_BASE" != "$CANONICAL" ]]; then
  echo "  ✗ Physical folder is '${PHYSICAL_BASE}' — open ~/${CANONICAL} in Cursor"
  echo "    File → Open Folder → ~/${CANONICAL}"
  echo "    Or: File → Open Workspace → ~/${CANONICAL}/kimi-toolchain.code-workspace"
  exit 1
fi

if [[ "$BASE" != "$CANONICAL" ]]; then
  echo "  ⚠ Opened via legacy path '${BASE}/' — reopen ~/${CANONICAL} (or .code-workspace)"
fi

if [[ -e "${HOME}/${LEGACY}" && "$PHYSICAL" != "${HOME}/${LEGACY}" ]]; then
  if [[ -L "${HOME}/${LEGACY}" ]]; then
    echo "  ⚠ ~/${LEGACY} symlink still present — safe to remove after reopening ~/${CANONICAL}"
  else
    echo "  ⚠ ~/${LEGACY} directory still exists — remove if duplicate (keep ~/${CANONICAL})"
  fi
fi

echo "  ✓ Canonical repo (${CANONICAL}, package.json ok)"
