/**
 * Ecosystem health — cross-product checks for Kimi Code + kimi-toolchain.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { auditArtifactGraphHealth } from "./artifact-graph-health.ts";
import { auditBunImageHealth } from "./bun-image.ts";
import { auditRuntimeCapabilitiesHealth } from "./bun-install-config.ts";
import { auditCanonicalReferencesHealth } from "./canonical-references.ts";
import { buildOptimizerDoctorMachineChecks } from "./constant-optimizer.ts";
import { checkDxCloudflareConfig } from "./dx-cloudflare-config.ts";
import { checkDxGithubAlignment } from "./dx-github-alignment.ts";
import { auditHerdrToolHealth } from "./herdr-tool-health.ts";
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
  decisionIds?: string[];
  confidence?: number;
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

import { runOfficialKimiDoctor } from "./kimi-doctor-wrapper.ts";

async function checkQualityScripts(projectRoot: string): Promise<EcosystemCheck[]> {
  const pkgPath = join(projectRoot, "package.json");
  if (!pathExists(pkgPath)) return [];

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

    const refs = await auditCanonicalReferencesHealth(projectRoot, home);
    if (refs.applicable) {
      for (const check of refs.checks) {
        checks.push({
          name: `canonical-references:${check.name}`,
          status: check.status,
          message: check.message,
          source: "canonical-references",
          fixable: check.fixable,
        });
      }
      fixPlan.push(...refs.fixPlan);
    }

    const runtimeCaps = await auditRuntimeCapabilitiesHealth(projectRoot);
    if (runtimeCaps.applicable) {
      checks.push({
        name: "bun-install-runtime:inventory",
        status: runtimeCaps.aligned ? "ok" : "error",
        message: runtimeCaps.aligned
          ? `${runtimeCaps.capabilityCount} runtime capabilities aligned`
          : (runtimeCaps.checks.find((check) => check.status === "error")?.message ??
            "runtime capability drift"),
        source: "bun-install-config",
        fixable: !runtimeCaps.aligned,
      });
      fixPlan.push(...runtimeCaps.fixPlan);
    }

    const artifactGraph = await auditArtifactGraphHealth(projectRoot);
    if (artifactGraph.applicable) {
      checks.push({
        name: "artifact-graph:context",
        status: artifactGraph.aligned ? "ok" : "error",
        message: artifactGraph.aligned
          ? `${artifactGraph.artifactCount} artifact nodes, ${artifactGraph.edgeCount} edges`
          : (artifactGraph.checks.find((check) => check.status === "error")?.message ??
            "artifact graph drift"),
        source: "artifact-graph-health",
        fixable: !artifactGraph.aligned,
      });
      fixPlan.push(...artifactGraph.fixPlan);
    }

    const bunImage = await auditBunImageHealth();
    checks.push({
      name: "bun-image:health",
      status: bunImage.aligned ? "ok" : "error",
      message: bunImage.aligned
        ? "Bun.Image metadata probe aligned"
        : (bunImage.checks.find((check) => check.status === "error")?.message ??
          "Bun.Image health drift"),
      source: "bun-image",
      fixable: !bunImage.aligned,
    });
    fixPlan.push(...bunImage.fixPlan);

    const herdr = await auditHerdrToolHealth(projectRoot, home);
    checks.push(...herdr.checks);
    fixPlan.push(...herdr.fixPlan);

    for (const check of await buildOptimizerDoctorMachineChecks(projectRoot)) {
      checks.push({
        name: check.name,
        status: check.status,
        message: check.message,
        source: check.source,
        fixable: check.status !== "ok",
        decisionIds: check.decisionIds,
        confidence: check.confidence,
      });
    }

    const dxCloudflare = await checkDxCloudflareConfig(projectRoot);
    if (dxCloudflare.applicable) {
      for (const check of dxCloudflare.checks) {
        checks.push({
          name: `dx-cloudflare:${check.name}`,
          status: check.status,
          message: check.message,
          source: "dx-cloudflare",
          fixable: check.fixable,
        });
      }
    }

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
