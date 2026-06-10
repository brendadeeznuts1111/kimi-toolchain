/**
 * Ecosystem health — cross-product checks for Kimi Code + kimi-toolchain.
 */

import { existsSync } from "fs";
import { join } from "path";
import { detectSyncDrift } from "./sync-hashes.ts";
import { validateMcpConfig } from "./mcp-config.ts";
import { auditKimiConfig } from "./kimi-config-audit.ts";
import { checkScaffoldAligned } from "./scaffold-aligned.ts";
import {
  auditWorkspaceHealth,
  countWorkspaceBlockers,
  isKimiToolchainRepo,
  type WorkspaceCheck,
} from "./workspace-health.ts";

export interface EcosystemCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  source: string;
  fixable: boolean;
}

export interface EcosystemHealthReport {
  checks: EcosystemCheck[];
  fixPlan: string[];
  blockers: number;
  warnings: number;
  errors: number;
}

export interface AuditEcosystemOptions {
  home?: string;
  strictWorkspace?: boolean;
  quick?: boolean;
}

function toEcosystem(check: WorkspaceCheck): EcosystemCheck {
  return {
    name: check.name,
    status: check.status,
    message: check.message,
    source: "workspace",
    fixable: check.fixable,
  };
}

async function runOfficialKimiDoctor(): Promise<EcosystemCheck> {
  const kimiPath = Bun.which("kimi");
  if (!kimiPath) {
    return {
      name: "kimi-doctor-official",
      status: "error",
      message: "kimi not installed",
      source: "kimi-code",
      fixable: false,
    };
  }
  try {
    const proc = Bun.spawn(["kimi", "doctor"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    const stdout = await Bun.readableStreamToText(proc.stdout);
    const stderr = await Bun.readableStreamToText(proc.stderr);
    if (exitCode === 0) {
      const line = stdout
        .split("\n")
        .find((l) => l.trim())
        ?.trim();
      return {
        name: "kimi-doctor-official",
        status: "ok",
        message: line || "passed",
        source: "kimi-code",
        fixable: false,
      };
    }
    const detail =
      stderr
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ||
      stdout
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ||
      `exit ${exitCode}`;
    return {
      name: "kimi-doctor-official",
      status: "error",
      message: detail.slice(0, 120),
      source: "kimi-code",
      fixable: false,
    };
  } catch (e: any) {
    return {
      name: "kimi-doctor-official",
      status: "error",
      message: e.message,
      source: "kimi-code",
      fixable: false,
    };
  }
}

async function checkQualityScripts(projectRoot: string): Promise<EcosystemCheck[]> {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return [];

  const checks: EcosystemCheck[] = [];
  const required = ["format:check", "lint", "typecheck", "check", "test"] as const;

  try {
    const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    for (const name of required) {
      checks.push(
        scripts[name]
          ? {
              name: `script:${name}`,
              status: "ok",
              message: "defined",
              source: "scaffold",
              fixable: false,
            }
          : {
              name: `script:${name}`,
              status: "warn",
              message: "missing — run kimi-fix",
              source: "scaffold",
              fixable: true,
            }
      );
    }
  } catch {
    return [];
  }
  return checks;
}

export async function auditEcosystemHealth(
  projectRoot: string,
  options: AuditEcosystemOptions = {}
): Promise<EcosystemHealthReport> {
  const home = options.home ?? Bun.env.HOME ?? "/tmp";
  const checks: EcosystemCheck[] = [];
  const fixPlan: string[] = [];

  const workspace = await auditWorkspaceHealth(projectRoot, {
    home,
    strictWorkspace: options.strictWorkspace,
  });
  for (const check of workspace.checks) {
    checks.push(toEcosystem(check));
  }

  const wsSummary = countWorkspaceBlockers(workspace, {
    strictWorkspace: options.strictWorkspace,
  });
  if (wsSummary.blocking > 0) {
    fixPlan.push("kimi-toolchain doctor --fix");
    if (workspace.legacyCursorSlugs.length > 0) {
      fixPlan.push("kimi-toolchain doctor --fix --fix-cursor (then restart Cursor)");
    }
    if (workspace.missingWrappers.length > 0) {
      fixPlan.push("bun run install-wrappers");
    }
  }

  const isToolchain = await isKimiToolchainRepo(projectRoot);
  if (isToolchain) {
    const drift = await detectSyncDrift(projectRoot);
    if (drift.synced) {
      checks.push({
        name: "desktop-sync",
        status: "ok",
        message: "tools/lib/scripts match repo",
        source: "sync",
        fixable: false,
      });
    } else {
      const count = drift.drifted.length + drift.missing.length;
      checks.push({
        name: "desktop-sync",
        status: "error",
        message: `${count} file(s) drifted — run bun run sync`,
        source: "sync",
        fixable: true,
      });
      fixPlan.push("bun run sync");
    }
  }

  const mcpReport = await validateMcpConfig(home, projectRoot);
  const unifiedShellOk = mcpReport.checks.some(
    (c) => c.name === "unified-shell" && c.status === "ok"
  );
  for (const check of mcpReport.checks) {
    checks.push({
      name: `mcp:${check.name}`,
      status: check.status,
      message: check.message,
      source: "mcp",
      fixable: check.status !== "ok",
    });
  }

  const configAudit = await auditKimiConfig(home, { unifiedShellRegistered: unifiedShellOk });
  for (const check of configAudit) {
    checks.push({
      name: `config:${check.name}`,
      status: check.status,
      message: check.message,
      source: "kimi-config",
      fixable: check.fixable,
    });
  }

  if (isToolchain) {
    const scaffold = await checkScaffoldAligned(projectRoot);
    if (scaffold.applicable) {
      for (const check of scaffold.checks) {
        checks.push({
          name: `scaffold:${check.name}`,
          status: check.status,
          message: check.message,
          source: "scaffold",
          fixable: check.status !== "ok",
        });
      }
      if (!scaffold.aligned) fixPlan.push("kimi-fix");
    }

    const qualityChecks = await checkQualityScripts(projectRoot);
    checks.push(...qualityChecks);
  }

  if (!options.quick) {
    checks.push(await runOfficialKimiDoctor());
  }

  let blockers = wsSummary.blocking;
  let warnings = wsSummary.warnings;
  let errors = wsSummary.errors;

  for (const check of checks) {
    if (check.source === "workspace") continue;
    if (check.status === "warn") warnings++;
    if (check.status === "error") {
      errors++;
      if (check.name === "desktop-sync" || check.name === "kimi-doctor-official") {
        blockers++;
      }
    }
  }

  return { checks, fixPlan: [...new Set(fixPlan)], blockers, warnings, errors };
}
