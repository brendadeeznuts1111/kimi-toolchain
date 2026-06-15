/**
 * Cross-repo define constant parity checks for doctor / CI.
 */

import { existsSync } from "fs";
import { join } from "path";
import {
  evaluateParityShared,
  expandRepoPath,
  loadParityConfig,
  type ParitySharedEntry,
} from "./build-constants-registry.ts";

export interface ConstantParityCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface ConstantParityReport {
  applicable: boolean;
  aligned: boolean;
  checks: ConstantParityCheck[];
  shared: ParitySharedEntry[];
}

function ok(name: string, message: string): ConstantParityCheck {
  return { name, status: "ok", message, fixable: false };
}

function warn(name: string, message: string): ConstantParityCheck {
  return { name, status: "warn", message, fixable: true };
}

function error(name: string, message: string): ConstantParityCheck {
  return { name, status: "error", message, fixable: true };
}

export interface CheckConstantParityOptions {
  strict?: boolean;
}

export async function checkConstantParity(
  projectRoot: string,
  options: CheckConstantParityOptions = {}
): Promise<ConstantParityReport> {
  const config = await loadParityConfig(projectRoot);
  if (!config) {
    return { applicable: false, aligned: true, checks: [], shared: [] };
  }

  const checks: ConstantParityCheck[] = [];
  checks.push(ok("constants-parity.toml", "present"));

  for (const [repoName, repoConfig] of Object.entries(config.repos)) {
    const repoRoot = expandRepoPath(repoConfig.path, projectRoot);
    const bunfigPath = join(repoRoot, repoConfig.bunfig);
    if (!existsSync(bunfigPath)) {
      checks.push(
        options.strict
          ? error(`repo:${repoName}`, `missing ${bunfigPath}`)
          : warn(`repo:${repoName}`, `skipped — ${bunfigPath} not found`)
      );
      continue;
    }
    checks.push(ok(`repo:${repoName}`, repoRoot));
  }

  const shared = await evaluateParityShared(projectRoot, config);
  for (const entry of shared) {
    const repoSummary = Object.entries(entry.repos)
      .map(([repo, meta]) => `${repo}=${meta.value}`)
      .join(", ");

    if (entry.aligned) {
      checks.push(ok(`shared:${entry.id}`, repoSummary));
      continue;
    }

    const message = entry.drift ?? `drift across repos (${repoSummary})`;
    const missingCount = Object.values(entry.repos).filter((meta) => !meta.present).length;
    const presentCount = Object.values(entry.repos).filter((meta) => meta.present).length;
    const partialCheckout = missingCount > 0 && presentCount > 0;

    checks.push(
      partialCheckout && !options.strict
        ? warn(`shared:${entry.id}`, message)
        : error(`shared:${entry.id}`, message)
    );
  }

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
    shared,
  };
}

export interface LintConstantParityResult {
  ok: boolean;
  violations: string[];
  warnings: string[];
}

export async function lintConstantParity(
  projectRoot: string,
  options: CheckConstantParityOptions = {}
): Promise<LintConstantParityResult> {
  const report = await checkConstantParity(projectRoot, options);
  if (!report.applicable) {
    return { ok: true, violations: [], warnings: [] };
  }

  const violations: string[] = [];
  const warnings: string[] = [];

  for (const check of report.checks) {
    if (check.status === "error") violations.push(`${check.name} — ${check.message}`);
    if (check.status === "warn") warnings.push(`${check.name} — ${check.message}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings,
  };
}
