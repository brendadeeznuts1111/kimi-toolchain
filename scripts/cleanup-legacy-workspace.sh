#!/usr/bin/env bash
# Audit and optionally clean legacy kimicode-cli workspace artifacts.
# Default: read-only audit + instructions (no destructive ops).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL="kimi-toolchain"
LEGACY="kimicode-cli"
LEGACY_ALT="kimi-code-cli"
CURSOR_PROJECTS="${HOME}/.cursor/projects"
SNAPSHOTS="${HOME}/.kimi-code/snapshots"
SESSIONS="${HOME}/.kimi-code/sessions"

LIST_CURSOR=false
REMOVE_CURSOR=false
REMOVE_LEGACY_PATH=false

for arg in "$@"; do
  case "$arg" in
    --list-cursor-slugs) LIST_CURSOR=true ;;
    --remove-cursor-slugs) REMOVE_CURSOR=true ;;
    --remove-legacy-path) REMOVE_LEGACY_PATH=true ;;
    --help|-h)
      echo "Usage: cleanup-legacy-workspace.sh [options]"
      echo ""
      echo "Options:"
      echo "  (none)                 Audit only — list legacy artifacts + instructions"
      echo "  --list-cursor-slugs    Print legacy Cursor project folders"
      echo "  --remove-legacy-path   Remove ~/kimicode-cli if symlink or empty reappears"
      echo "  --remove-cursor-slugs  Delete legacy ~/.cursor/projects/*kimicode* (opt-in)"
      exit 0
      ;;
  esac
done

echo "── Legacy workspace cleanup ───────────────────────────────────"

# 1. Legacy clone path on disk
LEGACY_PATH="${HOME}/${LEGACY}"
if [[ -e "$LEGACY_PATH" ]]; then
  if [[ -L "$LEGACY_PATH" ]]; then
    echo "  ⚠ ~/${LEGACY} symlink exists → $(readlink "$LEGACY_PATH")"
    if [[ "$REMOVE_LEGACY_PATH" == true ]]; then
      rm "$LEGACY_PATH"
      echo "  ✓ Removed symlink ~/${LEGACY}"
    fi
  elif [[ -d "$LEGACY_PATH" ]]; then
    echo "  ⚠ ~/${LEGACY} directory exists — remove manually if duplicate of ~/${CANONICAL}"
    if [[ "$REMOVE_LEGACY_PATH" == true ]]; then
      echo "  ✗ Refusing to rm -rf directory (use manual review)"
    fi
  else
    echo "  ⚠ ~/${LEGACY} exists (not dir/symlink)"
  fi
else
  echo "  ✓ No ~/${LEGACY} on disk"
fi

# 2. Canonical repo
if [[ -f "${HOME}/${CANONICAL}/package.json" ]]; then
  echo "  ✓ ~/${CANONICAL} present"
else
  echo "  ✗ ~/${CANONICAL}/package.json missing"
fi

# 3. Cursor project slugs
CURSOR_MATCHES=()
if [[ -d "$CURSOR_PROJECTS" ]]; then
  for entry in "$CURSOR_PROJECTS"/*; do
    [[ -e "$entry" ]] || continue
    base="$(basename "$entry")"
    if [[ "$base" == *"$LEGACY"* || "$base" == *"$LEGACY_ALT"* ]]; then
      CURSOR_MATCHES+=("$base")
    fi
  done
fi

if [[ ${#CURSOR_MATCHES[@]} -eq 0 ]]; then
  echo "  ✓ No legacy Cursor project slugs"
else
  echo "  ⚠ Legacy Cursor project slug(s):"
  for slug in "${CURSOR_MATCHES[@]}"; do
    echo "      ${CURSOR_PROJECTS}/${slug}"
  done
  if [[ "$LIST_CURSOR" == true || "$REMOVE_CURSOR" == true ]]; then
    :
  else
    echo "      Run: bun run cleanup-legacy --list-cursor-slugs"
  fi
  if [[ "$REMOVE_CURSOR" == true ]]; then
    for slug in "${CURSOR_MATCHES[@]}"; do
      rm -rf "${CURSOR_PROJECTS}/${slug}"
      echo "  ✓ Removed ${slug}"
    done
    echo "  → Restart Cursor and open ~/${CANONICAL}/kimi-toolchain.code-workspace"
  fi
fi

# 4. Snapshots referencing legacy paths
if [[ -d "$SNAPSHOTS" ]]; then
  SNAP_HITS="$(rg -l "$LEGACY|$LEGACY_ALT" "$SNAPSHOTS" 2>/dev/null || true)"
  if [[ -n "$SNAP_HITS" ]]; then
    echo "  ⚠ Snapshots referencing legacy paths:"
    echo "$SNAP_HITS" | sed 's/^/      /'
  else
    echo "  ✓ No legacy paths in snapshots"
  fi
fi

# 5. Kimi session folders with legacy names
if [[ -d "$SESSIONS" ]]; then
  SESSION_HITS=()
  for entry in "$SESSIONS"/wd_*; do
    [[ -d "$entry" ]] || continue
    base="$(basename "$entry")"
    if [[ "$base" == *"$LEGACY"* || "$base" == *"$LEGACY_ALT"* ]]; then
      SESSION_HITS+=("$base")
    fi
  done
  if [[ ${#SESSION_HITS[@]} -eq 0 ]]; then
    echo "  ✓ No legacy-named kimi session folders"
  else
    echo "  ⚠ Legacy kimi session folder(s): ${SESSION_HITS[*]}"
    echo "      Safe to archive/remove if sessions are obsolete"
  fi
fi

# 6. Workspace verify from repo
if [[ -f "${REPO_ROOT}/scripts/verify-workspace.sh" ]]; then
  bash "${REPO_ROOT}/scripts/verify-workspace.sh"
fi

echo ""
if [[ ${#CURSOR_MATCHES[@]} -gt 0 && "$REMOVE_CURSOR" != true ]]; then
  echo "Next steps:"
  echo "  1. File → Open Folder → ~/${CANONICAL}"
  echo "     Or: File → Open Workspace → ~/${CANONICAL}/kimi-toolchain.code-workspace"
  echo "  2. Close any window rooted at ~/${LEGACY}"
  echo "  3. Optional (loses old slug chat cache): bun run cleanup-legacy -- --remove-cursor-slugs"
fi
