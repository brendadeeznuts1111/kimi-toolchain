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
  { id: "run-gates", label: "run-gates delegate", marker: "run-gates pre-commit" },
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
  { id: "run-gates", label: "run-gates delegate", marker: "run-gates pre-push" },
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

function hookDelegate(subcommand: "pre-commit" | "pre-push"): string {
  return `ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
cd "$ROOT" || exit 1
exec bun run src/bin/kimi-githooks.ts run-gates ${subcommand}`;
}

export function renderPreCommitHook(): string {
  return `#!/bin/sh
# Auto-installed by kimi-githooks — policy shell; gates run via run-gates pre-commit

${hookDelegate("pre-commit")}
`;
}

export function renderPrePushHook(_toolsDirPath: string): string {
  return `#!/bin/sh
# Auto-installed by kimi-githooks — git stdin/ref guards; gates run via run-gates pre-push

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

${hookDelegate("pre-push")}
`;
}
