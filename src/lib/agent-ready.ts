/**
 * Agent readiness checks for shell, PATH, MCP, sync, and tool dispatch.
 */

import { existsSync } from "fs";
import { join } from "path";
import type { HealthCheck } from "./health-check.ts";
import { homeDir } from "./paths.ts";
import { validateMcpConfig } from "./mcp-config.ts";
import { detectSyncDrift } from "./sync-hashes.ts";
import { auditWorkspaceHealth } from "./workspace-health.ts";
import {
  DIRECT_BIN,
  META_BIN,
  TOOL_SHORT_NAMES,
  binNameToShortName,
  listPackageBinNames,
  resolveRepoToolScript,
  shortNameToScript,
} from "./tool-registry.ts";

export interface AgentReadyReport {
  checks: HealthCheck[];
  blockers: number;
  warnings: number;
  ok: boolean;
}

function check(
  name: string,
  status: HealthCheck["status"],
  message: string,
  fixable = false
): HealthCheck {
  return { name, status, message, fixable };
}

function pathEntries(): string[] {
  return (Bun.env.PATH || "").split(":").filter(Boolean);
}

function positionOf(pattern: RegExp): number {
  return pathEntries().findIndex((entry) => pattern.test(entry));
}

function duplicatePathEntries(): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of pathEntries()) {
    if (seen.has(entry)) duplicates.add(entry);
    seen.add(entry);
  }
  return [...duplicates].sort();
}

async function runShellStartupCheck(): Promise<HealthCheck> {
  const shell = Bun.env.SHELL || "/bin/zsh";
  try {
    const proc = Bun.spawn([shell, "-lc", "printf agent-ready-shell-ok"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
    ]);
    const err = stderr.trim();
    if (exitCode !== 0) {
      return check("shell-startup", "error", `${shell} exited ${exitCode}: ${err}`, true);
    }
    if (err.length > 0) {
      return check("shell-startup", "warn", err.split("\n")[0] || "stderr during startup", true);
    }
    return check("shell-startup", "ok", stdout.trim());
  } catch (e) {
    return check("shell-startup", "error", e instanceof Error ? e.message : String(e), false);
  }
}

function executableCheck(name: string, expectedPattern?: RegExp, required = true): HealthCheck {
  const path = Bun.which(name);
  if (!path) {
    return check(name, required ? "error" : "warn", "not found on PATH", false);
  }
  if (expectedPattern && !expectedPattern.test(path)) {
    return check(name, "warn", `${path} (unexpected path)`, false);
  }
  return check(name, "ok", path);
}

function runPathChecks(): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const home = homeDir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bunIdx = positionOf(new RegExp(`^${home}/\\.bun/bin$`));
  const kimiIdx = positionOf(new RegExp(`^${home}/\\.kimi-code/bin$`));
  const localIdx = positionOf(new RegExp(`^${home}/\\.local/bin$`));
  const duplicates = duplicatePathEntries();

  checks.push(
    bunIdx >= 0
      ? check("path:bun", "ok", `#${bunIdx + 1} in PATH`)
      : check("path:bun", "error", "~/.bun/bin missing from PATH", true)
  );
  checks.push(
    kimiIdx >= 0
      ? check("path:kimi", "ok", `#${kimiIdx + 1} in PATH`)
      : check("path:kimi", "error", "~/.kimi-code/bin missing from PATH", true)
  );
  checks.push(
    localIdx >= 0
      ? check("path:local", "ok", `#${localIdx + 1} in PATH`)
      : check("path:local", "warn", "~/.local/bin missing from PATH", true)
  );
  checks.push(
    duplicates.length === 0
      ? check("path:duplicates", "ok", "none")
      : check(
          "path:duplicates",
          "warn",
          `${duplicates.length} duplicate entr${duplicates.length === 1 ? "y" : "ies"}`,
          true
        )
  );

  return checks;
}

async function runRegistryContractChecks(projectRoot: string): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const bins = await listPackageBinNames(projectRoot);
  const missingMappings: string[] = [];
  const missingScripts: string[] = [];

  for (const bin of bins) {
    if (bin === DIRECT_BIN || bin === META_BIN) continue;
    if (!bin.startsWith("kimi-")) continue;

    const shortName = binNameToShortName(bin);
    if (!shortName || !TOOL_SHORT_NAMES.includes(shortName as (typeof TOOL_SHORT_NAMES)[number])) {
      missingMappings.push(bin);
      continue;
    }

    if (!resolveRepoToolScript(shortName, join(projectRoot, "src", "bin"))) {
      missingScripts.push(bin);
    }
  }

  const unmappedShortNames = TOOL_SHORT_NAMES.filter(
    (shortName) => shortName !== "workspace" && !shortNameToScript(shortName)
  );

  checks.push(
    missingMappings.length === 0 && unmappedShortNames.length === 0
      ? check("registry:mappings", "ok", "package bins map to meta-router")
      : check(
          "registry:mappings",
          "error",
          [...missingMappings, ...unmappedShortNames].join(", "),
          false
        )
  );
  checks.push(
    missingScripts.length === 0
      ? check("registry:scripts", "ok", "mapped scripts exist")
      : check("registry:scripts", "error", missingScripts.join(", "), false)
  );

  return checks;
}

export async function auditAgentReady(projectRoot: string): Promise<AgentReadyReport> {
  const checks: HealthCheck[] = [];
  const home = homeDir();

  checks.push(await runShellStartupCheck());
  checks.push(...runPathChecks());
  checks.push(executableCheck("bun", new RegExp(`^${home}/\\.bun/bin/bun$`)));
  checks.push(executableCheck("kimi", new RegExp(`^${home}/\\.kimi-code/bin/kimi$`)));
  checks.push(executableCheck("kimi-doctor", /kimi-doctor$/));
  checks.push(executableCheck("dx", undefined, false));
  checks.push(executableCheck("wrangler", undefined, false));

  const mcpReport = await validateMcpConfig(home, projectRoot);
  checks.push(...mcpReport.checks.map((c) => ({ ...c })));

  const workspace = await auditWorkspaceHealth(projectRoot, { home });
  checks.push(
    ...workspace.checks.filter((c) =>
      ["path-wrappers", "wrapper-coverage", "desktop-tools"].includes(c.name)
    )
  );

  if (existsSync(join(projectRoot, "scripts", "sync-to-desktop.ts"))) {
    const sync = await detectSyncDrift(projectRoot);
    checks.push(
      sync.synced
        ? check("runtime-sync", "ok", "repo and ~/.kimi-code/tools match")
        : check(
            "runtime-sync",
            "error",
            `${sync.drifted.length + sync.missing.length} file(s) drifted — run bun run sync`,
            true
          )
    );
  }

  checks.push(...(await runRegistryContractChecks(projectRoot)));

  const blockers = checks.filter((c) => c.status === "error").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { checks, blockers, warnings, ok: blockers === 0 };
}
