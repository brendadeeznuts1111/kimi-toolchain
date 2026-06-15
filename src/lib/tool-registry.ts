/**
 * kimi-toolchain meta-binary — tool name → script mapping.
 */

import { existsSync } from "fs";
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
  "heal",
  "decision",
  "githooks",
  "context-gen",
  "config",
  "cleanup-legacy",
  "cloudflare-access",
  "debug",
  "release",
  "snapshot",
  "resource-governor",
  "orphan-kill",
  "workspace",
] as const;

export type ToolShortName = (typeof TOOL_SHORT_NAMES)[number];

const SHORT_TO_SCRIPT: Record<string, string> = {
  doctor: "kimi-doctor.ts",
  fix: "kimi-fix.ts",
  new: "kimi-new.ts",
  governance: "kimi-governance.ts",
  guardian: "kimi-guardian.ts",
  heal: "kimi-heal.ts",
  decision: "kimi-decision.ts",
  memory: "kimi-memory.ts",
  githooks: "kimi-githooks.ts",
  "context-gen": "kimi-context-gen.ts",
  config: "kimi-config.ts",
  "cleanup-legacy": "kimi-cleanup-legacy.ts",
  "cloudflare-access": "kimi-cloudflare-access.ts",
  debug: "kimi-debug.ts",
  release: "kimi-release.ts",
  snapshot: "kimi-snapshot.ts",
  "resource-governor": "kimi-resource-governor.ts",
  "orphan-kill": "kimi-orphan-kill.ts",
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
  return existsSync(path) ? path : null;
}

export function resolveRepoToolScript(shortName: string, repoBinDir: string): string | null {
  const script = shortNameToScript(shortName);
  if (!script) return null;
  const path = join(repoBinDir, script);
  return existsSync(path) ? path : null;
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

export function formatToolHelp(): string {
  const lines = [
    `Usage: ${META_BIN} <tool> [args...]`,
    `       ${META_BIN} workspace <verify|audit|fix|cleanup> [options]`,
    "",
    "Tools:",
    ...TOOL_SHORT_NAMES.filter((name) => name !== "workspace").map((name) => `  ${name}`),
    "  workspace   verify | audit | fix | cleanup",
    "",
    "Examples:",
    `  ${META_BIN} doctor --quick`,
    `  ${META_BIN} workspace verify`,
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
