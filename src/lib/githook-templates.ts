export const GIT_HOOK_NAMES = ["pre-commit", "pre-push"] as const;

export type GitHookName = (typeof GIT_HOOK_NAMES)[number];

export interface HookMarker {
  readonly id: string;
  readonly label: string;
  readonly marker: string;
}

export interface HookTemplateAnalysis {
  readonly managed: boolean;
  readonly ok: boolean;
  readonly missingMarkers: readonly HookMarker[];
}

export const PRE_COMMIT_REQUIRED_MARKERS = [
  { id: "managed", label: "managed marker", marker: "kimi-githooks" },
  { id: "format", label: "format gate", marker: "format:check" },
  { id: "lint", label: "lint gate", marker: '"lint"' },
  { id: "typecheck", label: "typecheck gate", marker: '"typecheck"' },
  { id: "fast-tests", label: "fast test gate", marker: '"test:fast"' },
] as const satisfies readonly HookMarker[];

export const PRE_PUSH_REQUIRED_MARKERS = [
  { id: "managed", label: "managed marker", marker: "kimi-githooks" },
  { id: "snapshot", label: "snapshot guard", marker: "KIMI_HOOK_SNAPSHOT" },
  {
    id: "no-ref-skip",
    label: "no-ref push skip",
    marker: "No refs to push; skipping pre-push checks",
  },
  {
    id: "delete-ref-skip",
    label: "delete-only push skip",
    marker: "Only deleted refs; skipping local quality gates",
  },
  { id: "full-override", label: "full gate override", marker: "KIMI_PRE_PUSH_FULL" },
  { id: "fast-gate", label: "fast quality gate", marker: "check:fast" },
  { id: "repo-first", label: "repo-first tools", marker: "src/bin/kimi-governance.ts" },
  { id: "desktop-sync", label: "desktop sync", marker: "Desktop Sync (mandatory)" },
  { id: "sync-manifest", label: "sync manifest verify", marker: "Sync Manifest Verify" },
] as const satisfies readonly HookMarker[];

export function analyzeHookTemplate(
  content: string,
  requiredMarkers: readonly HookMarker[]
): HookTemplateAnalysis {
  const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker.marker));
  return {
    managed: content.includes("kimi-githooks"),
    ok: missingMarkers.length === 0,
    missingMarkers,
  };
}

export function analyzePreCommitHook(content: string): HookTemplateAnalysis {
  return analyzeHookTemplate(content, PRE_COMMIT_REQUIRED_MARKERS);
}

export function analyzePrePushHook(content: string): HookTemplateAnalysis {
  return analyzeHookTemplate(content, PRE_PUSH_REQUIRED_MARKERS);
}

export function describeMissingHookMarkers(analysis: HookTemplateAnalysis): string {
  if (analysis.missingMarkers.length === 0) return "";
  return analysis.missingMarkers.map((marker) => marker.label).join(", ");
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function renderPreCommitHook(): string {
  return `#!/bin/sh
# Auto-installed by kimi-githooks
# P0: Block secrets, env blocks, TODOs in commit messages

# Check for .env files being committed (.env.example is allowed)
ENV_BLOCKED=$(git diff --cached --name-only | grep -E '^\\.env($|\\.)' | grep -v '^\\.env\\.example$' || true)
if [ -n "$ENV_BLOCKED" ]; then
  echo "✗ Commit blocked: .env file detected in staged changes"
  echo "  Use Bun.secrets or a vault. Never commit .env files."
  exit 1
fi

# Check for TODO/FIXME in staged files (not test files)
TODO_COUNT=$(git diff --cached --name-only | grep -v '\\.test\\.' | grep -v '\\.spec\\.' | xargs -I {} git diff --cached -- {} 2>/dev/null | grep -c '^+.*TODO\\|FIXME' || true)
if [ "$TODO_COUNT" -gt 0 ]; then
  echo "⚠ $TODO_COUNT TODO/FIXME found in staged non-test files"
  echo "  Commit allowed, but consider addressing before merge."
fi

# Check for console.log in staged .ts files (not .test.ts)
LOG_COUNT=$(git diff --cached --name-only | grep '\\.ts$' | grep -v '\\.test\\.' | grep -v '\\.spec\\.' | xargs -I {} git diff --cached -- {} 2>/dev/null | grep -c '^+.*console\\.log' || true)
if [ "$LOG_COUNT" -gt 0 ]; then
  echo "⚠ $LOG_COUNT console.log found in staged .ts files"
  echo "  Consider using a proper logger or removing debug output."
fi

# Quality gates (when package.json defines scripts)
if [ -f package.json ]; then
  if grep -q '"format:check"' package.json 2>/dev/null; then
    echo "── Format check ─────────────────────────────────────────────"
    bun run format:check || exit 1
  fi
  if grep -q '"lint"' package.json 2>/dev/null; then
    echo "── Lint ─────────────────────────────────────────────────────"
    bun run lint || exit 1
  fi
  if grep -q '"typecheck"' package.json 2>/dev/null; then
    echo "── Type check ───────────────────────────────────────────────"
    bun run typecheck || exit 1
  fi
  if grep -q '"test:fast"' package.json 2>/dev/null; then
    echo "── Unit tests (fast) ────────────────────────────────────────"
    bun run test:fast || exit 1
  fi
fi

exit 0
`;
}

export function renderPrePushHook(toolsDirPath: string): string {
  return `#!/bin/sh
# Auto-installed by kimi-githooks
# P1: Lockfile verification, guardian scan, R-Score gate

TOOLS_DIR=${shellSingleQuote(toolsDirPath)}

# Git streams hook files while they execute. The pre-push gate is long-running and
# may install/sync hooks as part of validation, so execute a temp snapshot.
if [ -z "\${KIMI_HOOK_SNAPSHOT:-}" ]; then
  KIMI_HOOK_TMP="\${TMPDIR:-/tmp}/kimi-pre-push.$$"
  cp "$0" "$KIMI_HOOK_TMP" || exit 1
  chmod +x "$KIMI_HOOK_TMP" || exit 1
  KIMI_HOOK_SNAPSHOT="$KIMI_HOOK_TMP" exec "$KIMI_HOOK_TMP" "$@"
fi

if [ -n "\${KIMI_HOOK_SNAPSHOT:-}" ]; then
  trap 'rm -f "$KIMI_HOOK_SNAPSHOT"' EXIT
fi

PUSH_REFS=$(cat)
if [ -z "$PUSH_REFS" ]; then
  echo "✓ No refs to push; skipping pre-push checks"
  exit 0
fi

NON_DELETE_REFS=$(printf "%s\\n" "$PUSH_REFS" | awk '$2 !~ /^0+$/ { print }')
if [ -z "$NON_DELETE_REFS" ]; then
  echo "✓ Only deleted refs; skipping local quality gates"
  exit 0
fi

echo "═══ Kimi Pre-Push Gate ═══"

# Prefer repo src when developing kimi-toolchain
if [ -f "src/bin/kimi-guardian.ts" ] && [ -f "package.json" ]; then
  GUARDIAN="src/bin/kimi-guardian.ts"
else
  GUARDIAN="$TOOLS_DIR/kimi-guardian.ts"
fi

if [ -f "src/bin/kimi-governance.ts" ] && [ -f "package.json" ]; then
  GOVERNANCE="src/bin/kimi-governance.ts"
else
  GOVERNANCE="$TOOLS_DIR/kimi-governance.ts"
fi

# 1. Supply Chain Security (guardian: lockfile + dependency audit)
if [ -f "$GUARDIAN" ]; then
  echo "── Supply Chain Security ──────────────────────────────────"
  bun run "$GUARDIAN" check 2>&1 | grep -E "(CVE|outdated|untrusted|HASH MISMATCH)" || echo "  ✓ No critical issues"
fi

# 2. R-Score gate (block push if F or D grade)
if [ -f "$GOVERNANCE" ]; then
  echo ""
  echo "── R-Score Gate ─────────────────────────────────────────────"
  SCORE_OUTPUT=$(bun run "$GOVERNANCE" score 2>&1)
  echo "$SCORE_OUTPUT" | grep -E "Grade:|Breakdown:"

  GRADE=$(echo "$SCORE_OUTPUT" | grep "Grade:" | sed 's/.*Grade: \\([A-F]\\).*/\\1/')
  if [ "$GRADE" = "F" ] || [ "$GRADE" = "D" ]; then
    echo ""
    echo "✗ PUSH BLOCKED: R-Score is $GRADE. Address governance gaps first."
    echo "  Run: bun run $GOVERNANCE fix"
    exit 1
  fi
fi

# 3. Quality gate. Fast is the default local gate; CI and explicit pushes can run full.
if [ -f "package.json" ]; then
  echo ""
  if [ "\${KIMI_PRE_PUSH_FULL:-0}" = "1" ]; then
    echo "── Quality Gate (full) ──────────────────────────────────────"
    if grep -q '"check"' package.json 2>/dev/null; then
      bun run check || exit 1
    else
      if grep -q '"format:check"' package.json 2>/dev/null; then
        bun run format:check || exit 1
      fi
      if grep -q '"lint"' package.json 2>/dev/null; then
        bun run lint || exit 1
      fi
      if grep -q '"typecheck"' package.json 2>/dev/null; then
        bun run typecheck || exit 1
      fi
      if grep -q '"test"' package.json 2>/dev/null; then
        bun test || exit 1
      fi
    fi
  else
    echo "── Quality Gate (fast; set KIMI_PRE_PUSH_FULL=1 for full) ───"
    if grep -q '"check:fast"' package.json 2>/dev/null; then
      bun run check:fast || exit 1
    else
      if grep -q '"format:check"' package.json 2>/dev/null; then
        bun run format:check || exit 1
      fi
      if grep -q '"lint"' package.json 2>/dev/null; then
        bun run lint || exit 1
      fi
      if grep -q '"typecheck"' package.json 2>/dev/null; then
        bun run typecheck || exit 1
      fi
      if grep -q '"test:fast"' package.json 2>/dev/null; then
        bun run test:fast || exit 1
      elif grep -q '"test"' package.json 2>/dev/null; then
        bun test || exit 1
      fi
    fi
  fi
fi

# 4. Workspace verify (kimi-toolchain only)
if [ -f "package.json" ] && grep -q '"name": "kimi-toolchain"' package.json 2>/dev/null; then
  echo ""
  echo "── Workspace Verify ─────────────────────────────────────────"
  if [ -f "scripts/verify-workspace.sh" ]; then
    bash scripts/verify-workspace.sh || exit 1
  else
    bun run src/bin/kimi-doctor.ts workspace verify || exit 1
  fi
fi

# 5. Desktop sync (mandatory for kimi-toolchain — keeps ~/.kimi-code/ on pushed HEAD)
if [ -f "package.json" ] && grep -q '"name": "kimi-toolchain"' package.json 2>/dev/null; then
  echo ""
  echo "── Desktop Sync (mandatory) ─────────────────────────────────"
  if [ -f "scripts/sync-to-desktop.ts" ]; then
    bun run scripts/sync-to-desktop.ts || exit 1
  elif grep -q '"sync"' package.json 2>/dev/null; then
    bun run sync || exit 1
  else
    echo "✗ PUSH BLOCKED: kimi-toolchain sync script missing"
    exit 1
  fi

  echo ""
  echo "── Sync Manifest Verify ─────────────────────────────────────"
  if grep -q '"sync:verify"' package.json 2>/dev/null; then
    bun run sync:verify || exit 1
  elif [ -f "scripts/sync-manifest.ts" ]; then
    bun run scripts/sync-manifest.ts --verify || exit 1
  else
    echo "✗ PUSH BLOCKED: sync manifest verifier missing"
    exit 1
  fi
fi

echo ""
echo "✓ Pre-push checks passed"
exit 0
`;
}
