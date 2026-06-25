/**
 * kimi-toolchain meta-binary — tool name → script mapping.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { readPackageJson } from "./utils.ts";
import { createLogger, type Logger } from "./logger.ts";

export const META_BIN = "kimi-toolchain";
export const DIRECT_BIN = "unified-shell-bridge";

/** Short names accepted by `kimi-toolchain <tool>`. */
export const TOOL_SHORT_NAMES = [
  "doctor",
  "fix",
  "new",
  "governance",
  "guardian",
  "memory",
  "mcp",
  "githooks",
  "context-gen",
  "cleanup-legacy",
  "cloudflare-access",
  "decision",
  "debug",
  "deep-audit",
  "release",
  "snapshot",
  "resource-governor",
  "restore-baseline",
  "secrets",
  "orphan-kill",
  "error",
  "trace",
  "capabilities",
  "contract",
  "dashboard-mcp",
  "heal",
  "why",
  "bake",
  "workflow",
  "workspace",
] as const;

export type ToolShortName = (typeof TOOL_SHORT_NAMES)[number];

const SHORT_TO_SCRIPT: Record<string, string> = {
  doctor: "kimi-doctor.ts",
  fix: "kimi-fix.ts",
  new: "kimi-new.ts",
  governance: "kimi-governance.ts",
  guardian: "kimi-guardian.ts",
  memory: "kimi-memory.ts",
  mcp: "kimi-mcp.ts",
  githooks: "kimi-githooks.ts",
  "context-gen": "kimi-context-gen.ts",
  "cleanup-legacy": "kimi-cleanup-legacy.ts",
  "cloudflare-access": "kimi-cloudflare-access.ts",
  debug: "kimi-debug.ts",
  "deep-audit": "kimi-deep-audit.ts",
  release: "kimi-release.ts",
  snapshot: "kimi-snapshot.ts",
  "resource-governor": "kimi-resource-governor.ts",
  "restore-baseline": "kimi-restore-baseline.ts",
  secrets: "kimi-secrets.ts",
  "orphan-kill": "kimi-orphan-kill.ts",
  error: "kimi-error.ts",
  trace: "kimi-trace.ts",
  capabilities: "kimi-capabilities.ts",
  contract: "kimi-contract.ts",
  "dashboard-mcp": "kimi-dashboard-mcp.ts",
  decision: "kimi-decision.ts",
  heal: "kimi-heal.ts",
  why: "kimi-decision.ts",
  bake: "kimi-bake.ts",
  workflow: "kimi-workflow.ts",
};

/** package.json bin name → short tool name for meta dispatch. */
export function binNameToShortName(binName: string): string | null {
  if (binName === META_BIN) return null;
  if (binName === DIRECT_BIN) return DIRECT_BIN;
  if (binName.startsWith("kimi-")) return binName.slice("kimi-".length);
  return null;
}

export function shortNameToScript(shortName: string): string | null {
  if (shortName === DIRECT_BIN) return `${DIRECT_BIN}.ts`;
  return SHORT_TO_SCRIPT[shortName] ?? null;
}

export function resolveToolScript(shortName: string, toolsDir: string): string | null {
  const script = shortNameToScript(shortName);
  if (!script) return null;
  const path = join(toolsDir, script);
  return pathExists(path) ? path : null;
}

export function resolveRepoToolScript(shortName: string, repoBinDir: string): string | null {
  const script = shortNameToScript(shortName);
  if (!script) return null;
  const path = join(repoBinDir, script);
  return pathExists(path) ? path : null;
}

export async function listPackageBinNames(repoRoot: string): Promise<string[]> {
  const pkg = await readPackageJson(
    repoRoot,
    (p): p is { bin?: Record<string, string> } => typeof p === "object" && p !== null && "bin" in p
  );
  return Object.keys(pkg?.bin || {}).sort();
}

/** Wrappers required on PATH: meta bin + legacy aliases + direct MCP bridge. */
export async function listExpectedWrapperNames(repoRoot: string): Promise<string[]> {
  const bins = await listPackageBinNames(repoRoot);
  const expected = new Set<string>([META_BIN, DIRECT_BIN]);
  for (const name of bins) {
    if (name.startsWith("kimi-")) expected.add(name);
  }
  return [...expected].sort();
}

export interface ToolInfo {
  name: string;
  script: string | null;
  source: "repo" | "desktop" | null;
}

/** List every registered tool and the script it resolves to, if any. */
export function listTools(repoBinDir: string, desktopToolsDir: string): ToolInfo[] {
  return TOOL_SHORT_NAMES.map((name) => {
    const repo = resolveRepoToolScript(name, repoBinDir);
    if (repo) return { name, script: repo, source: "repo" };
    const desktop = resolveToolScript(name, desktopToolsDir);
    if (desktop) return { name, script: desktop, source: "desktop" };
    return { name, script: null, source: null };
  });
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Suggest the closest registered tool name for an unknown input. */
export function suggestToolName(unknown: string): string | undefined {
  if (!unknown) return undefined;
  const candidates = TOOL_SHORT_NAMES as readonly string[];
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = levenshteinDistance(unknown, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const threshold = Math.max(1, Math.floor(unknown.length / 2));
  return bestScore <= threshold ? best : undefined;
}

export function formatToolHelp(): string {
  const lines = [
    `Usage: ${META_BIN} <tool> [args...]`,
    `       ${META_BIN} workspace <verify|audit|fix|cleanup> [options]`,
    `       ${META_BIN} restore-baseline --archive <path> --to <dir> [--dry-run] [--force]`,
    `       ${META_BIN} cleanup root|path|all|artifacts [--dry-run] [--json]`,
    `       ${META_BIN} --list-tools`,
    `       ${META_BIN} --version`,
    "",
    "Tools:",
    ...TOOL_SHORT_NAMES.filter((name) => name !== "workspace").map((name) => `  ${name}`),
    "  workspace   verify | audit | fix | cleanup",
    "",
    "Examples:",
    `  ${META_BIN} doctor --quick`,
    `  ${META_BIN} workspace verify`,
    `  ${META_BIN} restore-baseline --dry-run`,
    `  ${META_BIN} guardian check`,
  ];
  return lines.join("\n");
}

export function printToolHelp(logger?: Logger): void {
  const log = logger ?? createLogger(Bun.argv, META_BIN);
  for (const line of formatToolHelp().split("\n")) {
    log.line(line);
  }
}
