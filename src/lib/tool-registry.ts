/**
 * kimi-toolchain meta-binary — tool name → script mapping.
 */

import { existsSync } from "fs";
import { join } from "path";

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
  "githooks",
  "context-gen",
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
  memory: "kimi-memory.ts",
  githooks: "kimi-githooks.ts",
  "context-gen": "kimi-context-gen.ts",
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
  try {
    const pkg = (await Bun.file(join(repoRoot, "package.json")).json()) as {
      bin?: Record<string, string>;
    };
    return Object.keys(pkg.bin || {}).sort();
  } catch {
    return [];
  }
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

export function printToolHelp(): void {
  console.log(`Usage: ${META_BIN} <tool> [args...]`);
  console.log(`       ${META_BIN} workspace <verify|audit|fix|cleanup> [options]`);
  console.log("");
  console.log("Tools:");
  for (const name of TOOL_SHORT_NAMES) {
    if (name === "workspace") continue;
    console.log(`  ${name}`);
  }
  console.log("  workspace   verify | audit | fix | cleanup");
  console.log("");
  console.log("Examples:");
  console.log(`  ${META_BIN} doctor --quick`);
  console.log(`  ${META_BIN} workspace verify`);
  console.log(`  ${META_BIN} guardian check`);
}
