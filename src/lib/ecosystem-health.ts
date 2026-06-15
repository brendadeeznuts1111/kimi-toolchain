/**
 * Ecosystem health — cross-product checks for Kimi Code + kimi-toolchain.
 */

import { existsSync } from "fs";
import { join } from "path";
import { detectSyncDrift } from "./sync-hashes.ts";
import { validateMcpConfig } from "./mcp-config.ts";
import { auditKimiConfig } from "./kimi-config-audit.ts";
import { checkScaffoldAligned } from "./scaffold-aligned.ts";
import { checkDxGithubAlignment } from "./dx-github-alignment.ts";
import { checkConstantParity } from "./constant-parity.ts";
import {
  checkTaxonomyConstantLinks,
  checkRecentlyModifiedBoundConstants,
} from "./taxonomy-constants.ts";
import { checkTuningSetFreshness } from "./tuning-set-version.ts";
import {
  buildOptimizerDoctorMachineChecks,
  type OptimizerDoctorSeverity,
} from "./constant-optimizer.ts";
import { appendOptimizerHealthTrend } from "./optimizer-health-trend.ts";
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
  severity?: OptimizerDoctorSeverity;
  confidence?: number;
  driftPercent?: number | null;
  action?: string;
  decisionIds?: string[];
  candidateId?: string;
  candidateValue?: unknown;
  constant?: string;
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

interface ConstantOptimizerHealthCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
  autoFix?: string;
  severity?: OptimizerDoctorSeverity;
  confidence?: number;
  driftPercent?: number | null;
  action?: string;
  decisionIds?: string[];
  candidateId?: string;
  candidateValue?: unknown;
  constant?: string;
}

function optimizerCheckToEcosystem(check: ConstantOptimizerHealthCheck): EcosystemCheck {
  return {
    name: `constant-optimizer:${check.name}`,
    status: check.status,
    message: check.message,
    source: "constant-optimizer",
    fixable: check.fixable,
    severity: check.severity,
    confidence: check.confidence,
    driftPercent: check.driftPercent,
    action: check.autoFix ?? check.action,
    decisionIds: check.decisionIds,
    candidateId: check.candidateId,
    candidateValue: check.candidateValue,
    constant: check.constant ?? check.name,
  };
}

export async function checkConstantOptimizerHealth(
  projectRoot: string
): Promise<{ applicable: boolean; aligned: boolean; checks: ConstantOptimizerHealthCheck[] }> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!existsSync(taxonomyPath)) {
    return { applicable: false, aligned: true, checks: [] };
  }

  const machineChecks = await buildOptimizerDoctorMachineChecks(projectRoot);
  await appendOptimizerHealthTrend(projectRoot, machineChecks);

  const actionable = machineChecks.filter((check) => check.constant !== "summary");

  if (actionable.length === 0) {
    const summary = machineChecks.find((check) => check.constant === "summary");
    return {
      applicable: true,
      aligned: true,
      checks: [
        {
          name: "summary",
          status: "ok",
          message: summary?.message ?? "no optimizer recommendations",
          fixable: false,
        },
      ],
    };
  }

  const checks: ConstantOptimizerHealthCheck[] = actionable.map((machine) => ({
    name: machine.constant,
    status: machine.status,
    message: machine.message,
    fixable: false,
    autoFix: machine.action,
    severity: machine.severity,
    confidence: machine.confidence,
    driftPercent: machine.driftPercent,
    action: machine.action,
    decisionIds: machine.decisionIds,
    candidateId: machine.candidateId,
    candidateValue: machine.candidateValue,
    constant: machine.constant,
  }));

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
  };
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

import { runOfficialKimiDoctor } from "./kimi-doctor-wrapper.ts";

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
    const dxGithub = await checkDxGithubAlignment(projectRoot);
    if (dxGithub.applicable) {
      for (const check of dxGithub.checks) {
        checks.push({
          name: `dx-github:${check.name}`,
          status: check.status,
          message: check.message,
          source: "dx-github",
          fixable: check.fixable,
        });
      }
      if (!dxGithub.aligned) {
        fixPlan.push("align dx.config.toml with package.json and .github/workflows/ci.yml");
      }
    }

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

    const constantParity = await checkConstantParity(projectRoot);
    if (constantParity.applicable) {
      for (const check of constantParity.checks) {
        checks.push({
          name: `constant-parity:${check.name}`,
          status: check.status,
          message: check.message,
          source: "constant-parity",
          fixable: check.fixable,
        });
      }
      if (!constantParity.aligned) {
        fixPlan.push("align shared define constants — see constants-parity.toml");
      }
    }

    const taxonomyConstants = await checkTaxonomyConstantLinks(projectRoot);
    if (taxonomyConstants.applicable) {
      for (const check of taxonomyConstants.checks) {
        checks.push({
          name: `taxonomy-constants:${check.name}`,
          status: check.status,
          message: check.message,
          source: "taxonomy-constants",
          fixable: check.fixable,
        });
      }
      if (!taxonomyConstants.aligned) {
        fixPlan.push("fix error-taxonomy.yml boundConstants — unknown keys in bunfig/manifest");
      }
    }

    const boundRecent = await checkRecentlyModifiedBoundConstants(projectRoot);
    if (boundRecent.applicable) {
      for (const check of boundRecent.checks) {
        checks.push({
          name: `bound-constants:${check.name}`,
          status: check.status,
          message: check.message,
          source: "bound-constants",
          fixable: check.fixable,
        });
      }
    }

    const optimizer = await checkConstantOptimizerHealth(projectRoot);
    if (optimizer.applicable) {
      for (const check of optimizer.checks) {
        checks.push(optimizerCheckToEcosystem(check));
      }
    }

    const tuningSet = await checkTuningSetFreshness(projectRoot);
    if (tuningSet.applicable) {
      for (const check of tuningSet.checks) {
        checks.push({
          name: `tuning-set:${check.name}`,
          status: check.status,
          message: check.message,
          source: "tuning-set",
          fixable: check.fixable,
        });
      }
      if (!tuningSet.aligned) {
        fixPlan.push(
          "bump KIMI_TUNING_SET_VERSION in bunfig.toml and run bun run manifest:generate"
        );
      }
    }
  }

  if (!options.quick) {
    const doctorResult = await runOfficialKimiDoctor();
    checks.push({
      name: "kimi-doctor-official",
      status: doctorResult.status,
      message: doctorResult.message,
      source: "kimi-code",
      fixable: false,
    });
  }

  let blockers = wsSummary.blocking;
  let warnings = wsSummary.warnings;
  let errors = wsSummary.errors;

  for (const check of checks) {
    if (check.source === "workspace") continue;
    if (check.status === "warn") warnings++;
    if (check.status === "error") {
      errors++;
      if (
        check.name === "desktop-sync" ||
        check.name === "kimi-doctor-official" ||
        check.source === "dx-github"
      ) {
        blockers++;
      }
    }
  }

  return { checks, fixPlan: [...new Set(fixPlan)], blockers, warnings, errors };
}
