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

/** Return ~/.kimi-code/var/herdr-alert-dedupe.jsonl */
export function herdrAlertDedupeLedgerPath(): string {
  return join(varDir(), "herdr-alert-dedupe.jsonl");
}

/** Return ~/.kimi-code/var/herdr-taxonomy-hits.jsonl */
export function herdrTaxonomyHitsLedgerPath(): string {
  return join(varDir(), "herdr-taxonomy-hits.jsonl");
}

/** Return ~/.kimi-code/var/trace-events.jsonl */
export function traceEventsPath(): string {
  return join(varDir(), "trace-events.jsonl");
}

/** Return ~/.kimi-code/var/health-events.jsonl */
export function healthEventsPath(): string {
  return join(varDir(), "health-events.jsonl");
}

/** Return ~/.kimi-code/var/dashboard-events.db */
export function dashboardEventsDbPath(): string {
  return join(varDir(), "dashboard-events.db");
}

/** Return ~/.kimi-code/var/error-clusters.json */
export function clusterMetadataPath(): string {
  return join(varDir(), "error-clusters.json");
}

/** Return ~/.kimi-code/var/decision-ledger.jsonl (legacy v1 — read-only compat) */
export function decisionLedgerPath(): string {
  return join(varDir(), "decision-ledger.jsonl");
}

/** Return {projectRoot}/.kimi */
export function projectKimiDir(projectRoot: string): string {
  return join(projectRoot, ".kimi");
}

/** Return {projectRoot}/.kimi/decisions.ndjson */
export function decisionsNdjsonPath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "decisions.ndjson");
}

/** Return {projectRoot}/.kimi/var/constants-golden.json */
export function constantsGoldenPath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "var", "constants-golden.json");
}

/** Return {projectRoot}/.kimi/var/constants-golden/archive */
export function constantsGoldenArchiveDir(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "var", "constants-golden", "archive");
}

/** Return {projectRoot}/.kimi/var/config-lifecycle.ndjson */
export function configLifecyclePath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "var", "config-lifecycle.ndjson");
}

/** Return {projectRoot}/.kimi/var/health.ndjson */
export function healthSnapshotsPath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "var", "health.ndjson");
}

/** Return {projectRoot}/.kimi/var/effect-gates.ndjson */
export function effectGatesPath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "var", "effect-gates.ndjson");
}

/** Return {projectRoot}/.kimi/identity.ndjson */
export function identityAuditPath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "identity.ndjson");
}

/** Return {projectRoot}/.kimi/var/optimizer-health.ndjson */
export function optimizerHealthTrendPath(projectRoot: string): string {
  return join(projectKimiDir(projectRoot), "var", "optimizer-health.ndjson");
}

/** Return {projectRoot}/.kimi/var/contract-observations.ndjson (path segment from bunfig define). */
export function contractObservationsPath(projectRoot: string): string {
  return join(projectRoot, KIMI_CONTRACT_OBSERVATIONS_PATH);
}

/** Return ~/.kimi-code/var/institutional-memory.jsonl (deprecated — use decisions.ndjson) */
export function institutionalMemoryPath(): string {
  return join(varDir(), "institutional-memory.jsonl");
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

/** Return ~/.kimi-code/canonical-references.json */
export function canonicalReferencesPath(home?: string): string {
  return join(desktopRoot(home), "canonical-references.json");
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
export function localBinDir(home?: string): string {
  return join(home || homeDir(), ".local", "bin");
}

/** Return ~/.kimi-code/bin */
export function desktopBinDir(home?: string): string {
  return join(desktopRoot(home), "bin");
}

/** Return ~/.config/herdr/config.toml */
export function herdrConfigTomlPath(home?: string): string {
  return join(herdrConfigDir(home), "config.toml");
}

/** Return ~/.kimi-code/.kimi/decisions.ndjson (global fallback ledger) */
export function globalFallbackDecisionsPath(home?: string): string {
  return join(desktopRoot(home), ".kimi", "decisions.ndjson");
}

/** Return ~/.config/dx/global-config.toml */
export function globalDxConfigPath(home?: string): string {
  return join(home || homeDir(), ".config", "dx", "global-config.toml");
}

/** Return ~/.config/herdr */
export function herdrConfigDir(home?: string): string {
  return join(home || homeDir(), ".config", "herdr");
}

/** Return ~/.config/herdr/herdr-server.log */
export function herdrServerLogPath(home?: string): string {
  return join(herdrConfigDir(home), "herdr-server.log");
}

/** Return ~/.config/herdr/herdr-client.log */
export function herdrClientLogPath(home?: string): string {
  return join(herdrConfigDir(home), "herdr-client.log");
}

/** Default Bun.WebView dataStore folder for herdr-orchestrator dashboard. */
export const HERDR_DASHBOARD_WEBVIEW_STORE_NAME = "herdr-orchestrator-dashboard-webview";

/** Pre-rename store folder — documented in orchestrator --help for migration. */
export const HERDR_DASHBOARD_WEBVIEW_STORE_LEGACY_NAME = "herdr-dashboard-webview";

/** Return ~/.kimi-code/var/<name> — persistent Bun.WebView dataStore for the orchestrator dashboard. */
export function herdrDashboardWebViewStoreDir(
  home?: string,
  name = HERDR_DASHBOARD_WEBVIEW_STORE_NAME
): string {
  return join(desktopRoot(home), "var", name);
}

/** Return ~/.config/herdr/agents — LATM pane capability manifests */
export function herdrAgentsDir(home?: string): string {
  return join(herdrConfigDir(home), "agents");
}

/** Return ~/.config/herdr/agents/<paneId>/capabilities.json */
export function herdrLatmManifestPath(paneId: string, home?: string): string {
  return join(herdrAgentsDir(home), paneId, "capabilities.json");
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
