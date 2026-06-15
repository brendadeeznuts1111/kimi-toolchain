/**
 * src/lib/paths.ts
 *
 * Single source of truth for all ~/.kimi-code/ and related paths.
 * Use these helpers instead of repeating `Bun.env.HOME || "/tmp"`.
 */

import { join } from "path";

/** Fallback home directory when HOME is not set. */
export const FALLBACK_HOME_DIR = "/tmp";

/** Return the user's home directory, falling back to FALLBACK_HOME_DIR. */
export function homeDir(): string {
  return Bun.env.HOME || FALLBACK_HOME_DIR;
}

/** Return the canonical desktop runtime root: ~/.kimi-code */
export function desktopRoot(home?: string): string {
  return join(home || homeDir(), ".kimi-code");
}

/** Return ~/.kimi-code/tools */
export function toolsDir(home?: string): string {
  return join(desktopRoot(home), "tools");
}

/** Return ~/.kimi-code/lib */
export function libDir(): string {
  return join(desktopRoot(), "lib");
}

/** Return ~/.kimi-code/scripts */
export function scriptsDir(): string {
  return join(desktopRoot(), "scripts");
}

/** Return ~/.kimi-code/var */
export function varDir(): string {
  return join(desktopRoot(), "var");
}

/** Return ~/.kimi-code/var/tool-failures.jsonl */
export function failureLedgerPath(): string {
  return join(varDir(), "tool-failures.jsonl");
}

/** Return ~/.kimi-code/var/trace-events.jsonl */
export function traceEventsPath(): string {
  return join(varDir(), "trace-events.jsonl");
}

/** Return ~/.kimi-code/var/decision-ledger.jsonl */
export function decisionLedgerPath(): string {
  return join(varDir(), "decision-ledger.jsonl");
}

/** Return ~/.kimi-code/var/capabilities */
export function capabilitySnapshotsDir(): string {
  return join(varDir(), "capabilities");
}

/** Return ~/.kimi-code/guardian */
export function guardianDir(): string {
  return join(desktopRoot(), "guardian");
}

/** Return ~/.kimi-code/governor */
export function governorDir(): string {
  return join(desktopRoot(), "governor");
}

/** Return ~/.kimi-code/memory */
export function memoryDir(): string {
  return join(desktopRoot(), "memory");
}

/** Return ~/.kimi-code/snapshots */
export function snapshotDir(): string {
  return join(desktopRoot(), "snapshots");
}

/** Return ~/.kimi-code/wizard */
export function wizardDir(): string {
  return join(desktopRoot(), "wizard");
}

/** Return ~/.kimi-code/skills */
export function skillsDir(): string {
  return join(desktopRoot(), "skills");
}

/** Return ~/.kimi-code/kimi-hooks */
export function kimiHooksDir(): string {
  return join(desktopRoot(), "kimi-hooks");
}

/** Return ~/.kimi-code/mcp.json */
export function mcpPath(): string {
  return join(desktopRoot(), "mcp.json");
}

/** Return ~/.kimi-code/config.toml */
export function configTomlPath(): string {
  return join(desktopRoot(), "config.toml");
}

/** Return ~/.kimi-code/toolchain-manifest.json */
export function manifestPath(): string {
  return join(desktopRoot(), "toolchain-manifest.json");
}

/** Return ~/.kimi-code/error-taxonomy.yml */
export function taxonomyPath(): string {
  return join(desktopRoot(), "error-taxonomy.yml");
}

/** Return ~/.agents/skills */
export function agentsSkillsRoot(): string {
  return join(homeDir(), ".agents", "skills");
}

/** Return ~/.local/bin */
export function localBinDir(): string {
  return join(homeDir(), ".local", "bin");
}

/** Return ~/.cursor */
export function cursorDir(): string {
  return join(homeDir(), ".cursor");
}

/** Return ~/.cursor/projects */
export function cursorProjectsDir(): string {
  return join(cursorDir(), "projects");
}

/** Return ~/.kimi-code/project-mappings.yml */
export function projectMappingsPath(): string {
  return join(desktopRoot(), "project-mappings.yml");
}

/** Return ~/.kimi-code/guard */
export function guardDir(): string {
  return join(desktopRoot(), "guard");
}
