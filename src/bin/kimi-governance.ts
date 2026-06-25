#!/usr/bin/env bun
/**
 * kimi-governance — Project governance & quality gates
 * P1: Test coverage gate, R-Score formula
 * P2: License/CONTRIBUTING/CODEOWNERS checker, documentation drift, ADR scaffold
 *
 * Usage:
 *   kimi-governance [score|coverage [N]|docs|adr <title>|fix|doctor]
 */

import { $ } from "bun";
import { isDirectRun, readableStreamToText } from "../lib/bun-utils.ts";
import { pathExists, readJsonFileOr } from "../lib/bun-io.ts";
import { join } from "path";
import {
  ensureDir,
  getProjectName,
  readPackageManifest,
  resolveProjectRoot,
} from "../lib/utils.ts";
import { runTool } from "../lib/tool-runner.ts";
import { aggregateChecks } from "../lib/health-check.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { recordDoctorRun, getPersistentWarnings, type DoctorWarning } from "../lib/doctor-runs.ts";
import { createLogger } from "../lib/logger.ts";
import { ARTIFACTS_COVERAGE_DIR } from "../lib/artifacts.ts";
import {
  R_SCORE_WEIGHTS as WEIGHTS,
  computeBreakdown,
  computeRScoreFromBreakdown,
  formatPct,
  formatPoints,
  breakdownIndicator,
} from "../lib/r-score.ts";
import { buildBunTestArgs } from "../lib/test-runtime.ts";
import { useFastUnitCoverage } from "../lib/test-gates.ts";
import { checkDocDrift, patchReadmeScripts } from "../lib/readme-sync.ts";
import { checkKimiDocsAligned } from "../lib/kimi-docs-aligned.ts";
import { checkScaffoldAligned } from "../lib/scaffold-aligned.ts";
import { auditEcosystemHealth } from "../lib/ecosystem-health.ts";
import { isKimiToolchainRepo } from "../lib/workspace-health.ts";
import { governorDir } from "../lib/paths.ts";
import { checkGovernance } from "../lib/governance-check.ts";
import {
  isCoverageHistoryEntryArray,
  isRScoreArray,
  type CoverageHistoryEntry,
} from "../lib/governance.ts";
import {
  generateReadme,
  generateContributing,
  generateLicense,
  generateCodeowners,
  generateChangelog,
  scaffoldAdr,
} from "../lib/scaffold-templates.ts";

const logger = createLogger(Bun.argv, "kimi-governance");

/** Map governance check names to error-taxonomy.yml category ids when known. */
const GOVERNANCE_TAXONOMY: Record<string, string> = {
  lockfile: "lockfile_issue",
};

function toDoctorWarning(c: {
  name: string;
  message: string;
  status: "warn" | "error";
}): DoctorWarning {
  return {
    check: c.name,
    message: c.message,
    severity: c.status,
    taxonomyId: GOVERNANCE_TAXONOMY[c.name],
  };
}
const GOVERNANCE_DIR = governorDir();
const SCORE_HISTORY = join(GOVERNANCE_DIR, "r-score-history.json");

interface RScore {
  project: string;
  timestamp: string;
  total: number;
  max: number;
  breakdown: Record<string, number>;
  grade: string;
}

interface CoverageReport {
  covered: number;
  total: number;
  percentage: number;
  files: Array<{ path: string; covered: number; total: number; percentage: number }>;
}

async function checkCoverage(projectDir: string, _threshold = 70): Promise<CoverageReport> {
  const report: CoverageReport = { covered: 0, total: 0, percentage: 0, files: [] };

  const pkg = await readPackageManifest(projectDir);
  if (!pkg) return report;

  const hasTests =
    pkg.scripts?.test ||
    pathExists(join(projectDir, "test")) ||
    pathExists(join(projectDir, "tests"));
  if (!hasTests) return report;

  const fastCoverage = useFastUnitCoverage(pkg.name);

  async function spawnCoverage(json: boolean) {
    const proc = Bun.spawn(
      ["bun", ...buildBunTestArgs({ coverage: true, json, fast: fastCoverage })],
      {
        cwd: projectDir,
        env: { ...Bun.env, KIMI_COVERAGE_SCAN: "1" },
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const exitCode = await proc.exited;
    const stdout = await readableStreamToText(proc.stdout);
    const stderr = await readableStreamToText(proc.stderr);
    return { exitCode, stdout, stderr };
  }

  // Try --json output first (Bun test runner may support this)
  try {
    const jsonResult = await spawnCoverage(true);
    if (jsonResult.exitCode === 0) {
      const jsonStr = (jsonResult.stdout + jsonResult.stderr).trim();
      // Bun may output JSON as last line or entire output
      const lastLine = jsonStr.split("\n").pop() || "";
      let data: any;
      try {
        data = JSON.parse(lastLine);
      } catch {
        data = JSON.parse(jsonStr);
      }
      if (data && typeof data === "object") {
        // Parse Bun's coverage JSON format
        if (data.summary) {
          report.percentage = data.summary.percent || 0;
          report.covered = data.summary.covered || 0;
          report.total = data.summary.total || 0;
        }
        if (data.files && Array.isArray(data.files)) {
          for (const f of data.files) {
            report.files.push({
              path: f.path || "unknown",
              percentage: f.percent || 0,
              covered: f.covered || 0,
              total: f.total || 0,
            });
          }
        }
        if (report.total > 0) {
          await storeCoverageHistory(projectDir, report);
          return report;
        }
      }
    }
  } catch {
    // JSON parse failed, fall through to text parsing
  }

  // Fallback: text parsing
  try {
    const result = await spawnCoverage(false);
    const output = result.stdout + result.stderr;
    const lines = output.split("\n");

    let foundTotal = false;
    for (const line of lines) {
      // Bun text reporter: " src/lib/utils.ts | 19.05 | 15.00 | ..."
      const bunFileMatch = line.match(/^\s*(\S+\.ts)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
      if (bunFileMatch) {
        const pct = parseFloat(bunFileMatch[3]);
        report.files.push({
          path: bunFileMatch[1].trim(),
          percentage: pct,
          covered: Math.round(pct),
          total: 100,
        });
      }

      // Legacy table: "| file.ts | 50.00% | 10/20 |"
      const fileMatch = line.match(/\|\s*([^|]+\.ts)\s*\|\s*([\d.]+)%\s*\|\s*(\d+)\/(\d+)\s*\|/);
      if (fileMatch) {
        report.files.push({
          path: fileMatch[1].trim(),
          percentage: parseFloat(fileMatch[2]),
          covered: parseInt(fileMatch[3], 10),
          total: parseInt(fileMatch[4], 10),
        });
      }

      // Bun summary: "All files | 23.81 | 27.27 |"
      const bunTotalMatch = line.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
      if (bunTotalMatch && !foundTotal) {
        report.percentage = parseFloat(bunTotalMatch[2]);
        report.total = 100;
        report.covered = Math.round(report.percentage);
        foundTotal = true;
      }

      const totalMatch = line.match(/All files.*?(\d+(?:\.\d+)?)%.*?(\d+)\/(\d+)/);
      if (totalMatch && !foundTotal) {
        report.percentage = parseFloat(totalMatch[1]);
        report.covered = parseInt(totalMatch[2], 10);
        report.total = parseInt(totalMatch[3], 10);
        foundTotal = true;
      }
    }

    if (!foundTotal && report.files.length > 0) {
      const totalStatements = report.files.reduce((s, f) => s + f.total, 0);
      const coveredStatements = report.files.reduce((s, f) => s + f.covered, 0);
      report.total = totalStatements;
      report.covered = coveredStatements;
      report.percentage = totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0;
    }

    if (report.total === 0) {
      const lcovPath = join(projectDir, ARTIFACTS_COVERAGE_DIR, "lcov.info");
      if (pathExists(lcovPath)) {
        const lcov = await Bun.file(lcovPath).text();
        let totalLines = 0;
        let hitLines = 0;
        for (const line of lcov.split("\n")) {
          if (line.startsWith("DA:")) {
            const [, hits] = line.split(":")[1].split(",");
            totalLines++;
            if (parseInt(hits, 10) > 0) hitLines++;
          }
        }
        report.total = totalLines;
        report.covered = hitLines;
        report.percentage = totalLines > 0 ? (hitLines / totalLines) * 100 : 0;
      }
    }
  } catch {
    // No coverage data
  }

  if (report.total > 0) {
    await storeCoverageHistory(projectDir, report);
  }

  return report;
}

// ── Coverage History ─────────────────────────────────────────────────

const COVERAGE_HISTORY = join(GOVERNANCE_DIR, "coverage-history.json");

async function latestCoverageHistory(projectDir: string): Promise<CoverageReport | null> {
  if (!pathExists(COVERAGE_HISTORY)) return null;
  const raw = await Bun.file(COVERAGE_HISTORY).json();
  if (!isCoverageHistoryEntryArray(raw)) return null;
  const history = raw;
  const project = await getProjectName(projectDir);
  const latest = history
    .filter((entry) => entry.project === project)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  if (!latest) return null;
  return {
    covered: latest.covered,
    total: latest.total,
    percentage: latest.percentage,
    files: [],
  };
}

export { loadCachedCoverage } from "../lib/governance.ts";

async function storeCoverageHistory(projectDir: string, report: CoverageReport) {
  ensureDir(GOVERNANCE_DIR);
  const history = await readJsonFileOr(COVERAGE_HISTORY, [], isCoverageHistoryEntryArray);

  const project = await getProjectName(projectDir);
  history.push({
    project,
    timestamp: new Date().toISOString(),
    percentage: report.percentage,
    covered: report.covered,
    total: report.total,
  });

  // Keep last 100 entries per project
  const byProject = new Map<string, CoverageHistoryEntry[]>();
  for (const h of history) {
    byProject.set(h.project, [...(byProject.get(h.project) || []), h]);
  }
  const trimmed: CoverageHistoryEntry[] = [];
  for (const entries of byProject.values()) {
    trimmed.push(...entries.slice(-100));
  }

  await Bun.write(COVERAGE_HISTORY, JSON.stringify(trimmed, null, 2));
}

async function refreshStaleLockfile(projectDir: string): Promise<boolean> {
  const lockPath = join(projectDir, "bun.lock");
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(lockPath) || !pathExists(pkgPath)) return false;

  const pkgMtime = Bun.file(pkgPath).lastModified;
  const lockMtime = Bun.file(lockPath).lastModified;
  if (pkgMtime <= lockMtime) return false;

  await $`bun install --ignore-scripts`.cwd(projectDir).nothrow().quiet();
  if (Bun.file(lockPath).lastModified <= pkgMtime) {
    await Bun.write(lockPath, await Bun.file(lockPath).text());
  }
  return true;
}

// ── R-Score ──────────────────────────────────────────────────────────

async function resolveCoverageReport(projectDir: string, fast?: boolean): Promise<CoverageReport> {
  if (fast) {
    const latest = await latestCoverageHistory(projectDir);
    return latest ?? { covered: 0, total: 0, percentage: 0, files: [] };
  }
  return checkCoverage(projectDir);
}

async function computeRScore(
  projectDir: string,
  options: { fast?: boolean } = {}
): Promise<RScore> {
  const project = await getProjectName(projectDir);

  const [gov, coverage, drift] = await Promise.all([
    checkGovernance(projectDir),
    resolveCoverageReport(projectDir, options.fast),
    checkDocDrift(projectDir),
  ]);
  if (!drift) {
    throw new Error("Failed to check README drift — could not read package.json or README.md");
  }

  const lockPath = join(projectDir, "bun.lock");
  const pkgPath = join(projectDir, "package.json");
  let staleLockfile = false;
  if (pathExists(lockPath) && pathExists(pkgPath)) {
    const pkgMtime = Bun.file(pkgPath).lastModified;
    const lockMtime = Bun.file(lockPath).lastModified;
    staleLockfile = pkgMtime > lockMtime;
  }

  const computed = computeRScoreFromBreakdown(
    computeBreakdown({
      hasLicense: gov.hasLicense,
      hasContributing: gov.hasContributing,
      hasCodeowners: gov.hasCodeowners,
      hasReadme: gov.hasReadme,
      hasContext: gov.hasContext,
      hasChangelog: gov.hasChangelog,
      coveragePercentage: coverage.percentage,
      docsFresh: drift.fresh,
      staleLockfile,
    })
  );

  const score: RScore = {
    project,
    timestamp: new Date().toISOString(),
    total: computed.total,
    max: computed.max,
    breakdown: computed.breakdown,
    grade: computed.grade,
  };

  ensureDir(GOVERNANCE_DIR);
  let history = await readJsonFileOr(SCORE_HISTORY, [], isRScoreArray);
  history.push(score);
  if (history.length > 50) history = history.slice(-50);
  await Bun.write(SCORE_HISTORY, JSON.stringify(history, null, 2));

  return score;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "score";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = await getProjectName(projectDir);

  logger.projectBanner("Kimi Governance — Quality Gates", project);

  if (command === "governance") {
    logger.section("Governance Files");
    const gov = await checkGovernance(projectDir);

    (gov.hasLicense ? logger.info : logger.warn)(
      `License: ${gov.hasLicense ? gov.licenseType || "present" : "MISSING"}`
    );
    (gov.hasContributing ? logger.info : logger.warn)(
      `CONTRIBUTING.md: ${gov.hasContributing ? "present" : "MISSING"}`
    );
    (gov.hasCodeowners ? logger.info : logger.warn)(
      `CODEOWNERS: ${gov.hasCodeowners ? gov.codeowners.join(", ") || "present" : "MISSING"}`
    );
    (gov.hasReadme ? logger.info : logger.warn)(
      `README.md: ${gov.hasReadme ? "present" : "MISSING"}`
    );
    (gov.hasContext ? logger.info : logger.warn)(
      `CONTEXT.md: ${gov.hasContext ? "present" : "MISSING"}`
    );
    (gov.hasChangelog ? logger.info : logger.warn)(
      `CHANGELOG.md: ${gov.hasChangelog ? "present" : "MISSING"}`
    );
  } else if (command === "coverage") {
    const threshold = parseInt(args[1], 10) || 70;
    logger.section(`Test Coverage Gate (threshold: ${threshold}%)`);
    const cov = await checkCoverage(projectDir, threshold);

    if (cov.total === 0) {
      logger.warn("No coverage data found — run tests with --coverage first");
    } else {
      (cov.percentage >= threshold ? logger.info : logger.error)(
        `Coverage: ${cov.percentage.toFixed(1)}% (${cov.covered}/${cov.total} statements)`
      );

      if (cov.files.length > 0) {
        logger.info("Files:");
        for (const f of cov.files.slice(0, 10)) {
          const indicator = f.percentage >= threshold ? "✓" : "✗";
          logger.line(`    ${indicator} ${f.path}: ${f.percentage.toFixed(1)}%`);
        }
        if (cov.files.length > 10) {
          logger.line(`    ... and ${cov.files.length - 10} more`);
        }
      }

      if (cov.percentage < threshold) {
        logger.error(`GATE FAILED: ${cov.percentage.toFixed(1)}% < ${threshold}% threshold`);
        return 1;
      }
    }
  } else if (command === "docs") {
    logger.section("Documentation Drift");
    const drift = await checkDocDrift(projectDir);
    if (!drift) {
      logger.error("Failed to check README drift — could not read package.json or README.md");
      return 1;
    }

    if (!pathExists(join(projectDir, "README.md"))) {
      logger.error("README.md not found");
    } else if (!pathExists(join(projectDir, "package.json"))) {
      logger.warn("No package.json — skipping script comparison");
    } else {
      (drift.fresh ? logger.info : logger.warn)(
        `README scripts: ${drift.fresh ? "in sync" : "DRIFT DETECTED"}`
      );

      if (drift.missingFromReadme.length > 0) {
        logger.warn(`Missing from README: ${drift.missingFromReadme.join(", ")}`);
      }
      if (drift.extraInReadme.length > 0) {
        logger.warn(`In README but not package.json: ${drift.extraInReadme.join(", ")}`);
      }
    }
  } else if (command === "fix") {
    logger.section("Auto-Fixing Governance Gaps");
    const gov = await checkGovernance(projectDir);
    let generated = 0;

    if (!gov.hasReadme) {
      const path = await generateReadme(projectDir, getProjectName);
      logger.info(`Generated README.md: ${path}`);
      generated++;
    }
    if (!gov.hasContributing) {
      const path = await generateContributing(projectDir);
      logger.info(`Generated CONTRIBUTING.md: ${path}`);
      generated++;
    }
    if (!gov.hasLicense) {
      const path = await generateLicense(projectDir, "MIT");
      logger.info(`Generated LICENSE: ${path}`);
      generated++;
    }
    if (!gov.hasCodeowners) {
      const path = await generateCodeowners(projectDir, ensureDir);
      logger.info(`Generated CODEOWNERS: ${path}`);
      generated++;
    }
    if (!gov.hasChangelog) {
      const path = await generateChangelog(projectDir);
      logger.info(`Generated CHANGELOG.md: ${path}`);
      generated++;
    }

    // Also run context-gen update if CONTEXT.md is missing
    if (!gov.hasContext) {
      try {
        await runTool("kimi-context-gen", ["update"], { cwd: projectDir, timeoutMs: 30000 });
        logger.info("Generated CONTEXT.md via kimi-context-gen");
        generated++;
      } catch {
        logger.warn("kimi-context-gen update failed — generate CONTEXT.md manually");
      }
    }

    const drift = await checkDocDrift(projectDir);
    if (drift && !drift.fresh && drift.missingFromReadme.length > 0) {
      const patched = await patchReadmeScripts(projectDir);
      if (patched > 0) {
        logger.info(`Patched README.md with ${patched} missing script(s)`);
        generated += patched;
      }
    }

    if (await refreshStaleLockfile(projectDir)) {
      logger.info("Refreshed bun.lock timestamp (package.json was newer)");
      generated++;
    }

    if (generated === 0) {
      logger.info("All governance files present — nothing to generate");
    } else {
      logger.warn(`Applied ${generated} fix(es). Review and customize before committing.`);
    }

    logger.section("Re-checking after fix");
    const govAfter = await checkGovernance(projectDir);
    const checksAfter: Array<{
      name: string;
      status: "ok" | "warn" | "error";
      message: string;
      fixable: boolean;
    }> = [];

    checksAfter.push({
      name: "README.md",
      status: govAfter.hasReadme ? "ok" : "warn",
      message: govAfter.hasReadme ? "present" : "missing",
      fixable: !govAfter.hasReadme,
    });
    checksAfter.push({
      name: "CONTRIBUTING.md",
      status: govAfter.hasContributing ? "ok" : "warn",
      message: govAfter.hasContributing ? "present" : "missing",
      fixable: !govAfter.hasContributing,
    });
    checksAfter.push({
      name: "LICENSE",
      status: govAfter.hasLicense ? "ok" : "warn",
      message: govAfter.hasLicense ? govAfter.licenseType || "present" : "missing",
      fixable: !govAfter.hasLicense,
    });
    checksAfter.push({
      name: "CODEOWNERS",
      status: govAfter.hasCodeowners ? "ok" : "warn",
      message: govAfter.hasCodeowners ? "present" : "missing",
      fixable: !govAfter.hasCodeowners,
    });
    checksAfter.push({
      name: "CONTEXT.md",
      status: govAfter.hasContext ? "ok" : "warn",
      message: govAfter.hasContext ? "present" : "missing",
      fixable: !govAfter.hasContext,
    });
    checksAfter.push({
      name: "CHANGELOG.md",
      status: govAfter.hasChangelog ? "ok" : "warn",
      message: govAfter.hasChangelog ? "present" : "missing",
      fixable: !govAfter.hasChangelog,
    });

    const driftAfter = await checkDocDrift(projectDir);
    if (!driftAfter) {
      checksAfter.push({
        name: "README-drift",
        status: "error",
        message: "Failed to check README drift — could not read package.json or README.md",
        fixable: false,
      });
    } else {
      checksAfter.push({
        name: "README-drift",
        status: driftAfter.fresh ? "ok" : "warn",
        message: driftAfter.fresh
          ? "in sync with package.json"
          : `missing: ${driftAfter.missingFromReadme.join(", ")}`,
        fixable: !driftAfter.fresh,
      });
    }

    try {
      const guardianResult = await runTool("kimi-guardian", ["check"], {
        cwd: projectDir,
        timeoutMs: 30000,
      });
      const hasMismatch =
        guardianResult.stdout.includes("HASH MISMATCH") ||
        guardianResult.stdout.includes("No stored hash");
      checksAfter.push({
        name: "lockfile",
        status: hasMismatch ? "warn" : "ok",
        message: hasMismatch ? "unbaselined or changed" : "baselined",
        fixable: hasMismatch,
      });
    } catch {
      checksAfter.push({
        name: "lockfile",
        status: "warn",
        message: "guardian check failed",
        fixable: false,
      });
    }

    let warnsAfter = 0;
    const warningsAfter: DoctorWarning[] = [];
    for (const c of checksAfter) {
      logger.check(c);
      if (c.status === "warn") warnsAfter++;
      if (c.status === "warn" || c.status === "error") {
        warningsAfter.push(toDoctorWarning({ name: c.name, message: c.message, status: c.status }));
      }
    }

    let gitHeadAfter = "";
    try {
      const result = await $`git rev-parse HEAD`.cwd(projectDir).nothrow().quiet();
      gitHeadAfter = result.stdout.toString().trim();
    } catch {
      /* ignore */
    }
    recordDoctorRun(
      project,
      "kimi-governance",
      warningsAfter,
      undefined,
      gitHeadAfter || undefined
    );

    if (warnsAfter === 0) {
      logger.info("All checks clean after fix.");
    }
  } else if (command === "doctor") {
    const gov = await checkGovernance(projectDir);
    const checks: Array<{
      name: string;
      status: "ok" | "warn" | "error";
      message: string;
      fixable: boolean;
    }> = [];

    checks.push({
      name: "README.md",
      status: gov.hasReadme ? "ok" : "warn",
      message: gov.hasReadme ? "present" : "missing",
      fixable: !gov.hasReadme,
    });
    checks.push({
      name: "CONTRIBUTING.md",
      status: gov.hasContributing ? "ok" : "warn",
      message: gov.hasContributing ? "present" : "missing",
      fixable: !gov.hasContributing,
    });
    checks.push({
      name: "LICENSE",
      status: gov.hasLicense ? "ok" : "warn",
      message: gov.hasLicense ? gov.licenseType || "present" : "missing",
      fixable: !gov.hasLicense,
    });
    checks.push({
      name: "CODEOWNERS",
      status: gov.hasCodeowners ? "ok" : "warn",
      message: gov.hasCodeowners ? "present" : "missing",
      fixable: !gov.hasCodeowners,
    });
    checks.push({
      name: "CONTEXT.md",
      status: gov.hasContext ? "ok" : "warn",
      message: gov.hasContext ? "present" : "missing",
      fixable: !gov.hasContext,
    });
    checks.push({
      name: "CHANGELOG.md",
      status: gov.hasChangelog ? "ok" : "warn",
      message: gov.hasChangelog ? "present" : "missing",
      fixable: !gov.hasChangelog,
    });

    const drift = await checkDocDrift(projectDir);
    if (!drift) {
      checks.push({
        name: "README-drift",
        status: "error",
        message: "Failed to check README drift — could not read package.json or README.md",
        fixable: false,
      });
    } else {
      checks.push({
        name: "README-drift",
        status: drift.fresh ? "ok" : "warn",
        message: drift.fresh
          ? "in sync with package.json"
          : `missing: ${drift.missingFromReadme.join(", ")}`,
        fixable: false,
      });
    }

    const kimiDocs = await checkKimiDocsAligned(projectDir);
    if (kimiDocs.applicable) {
      checks.push({
        name: "kimiDocsAligned",
        status: kimiDocs.aligned ? "ok" : "warn",
        message: kimiDocs.aligned
          ? "product matrix + MCP docs in sync"
          : kimiDocs.checks
              .filter((c) => c.status === "warn")
              .map((c) => `${c.name}: ${c.message}`)
              .join("; "),
        fixable: false,
      });
    }

    const scaffold = await checkScaffoldAligned(projectDir);
    if (scaffold.applicable) {
      checks.push({
        name: "scaffoldAligned",
        status: scaffold.aligned ? "ok" : "warn",
        message: scaffold.aligned
          ? "AGENTS.md scaffold markers present"
          : scaffold.checks
              .filter((c) => c.status === "warn")
              .map((c) => `${c.name}: ${c.message}`)
              .join("; "),
        fixable: false,
      });
    }

    // Lockfile check via guardian
    try {
      const guardianResult = await runTool("kimi-guardian", ["check"], {
        cwd: projectDir,
        timeoutMs: 30000,
      });
      const hasMismatch =
        guardianResult.stdout.includes("HASH MISMATCH") ||
        guardianResult.stdout.includes("No stored hash");
      checks.push({
        name: "lockfile",
        status: hasMismatch ? "warn" : "ok",
        message: hasMismatch ? "unbaselined or changed" : "baselined",
        fixable: hasMismatch,
      });
    } catch {
      checks.push({
        name: "lockfile",
        status: "warn",
        message: "guardian check failed",
        fixable: false,
      });
    }

    const report = aggregateChecks("kimi-governance", checks);
    logger.printHealthReport(report);

    const warnings: DoctorWarning[] = [];
    for (const c of checks) {
      if (c.status === "warn" || c.status === "error") {
        warnings.push(toDoctorWarning({ name: c.name, message: c.message, status: c.status }));
      }
    }

    // Persist to trending
    let gitHead = "";
    try {
      const result = await $`git rev-parse HEAD`.cwd(projectDir).nothrow().quiet();
      gitHead = result.stdout.toString().trim();
    } catch {
      /* ignore */
    }
    recordDoctorRun(project, "kimi-governance", warnings, undefined, gitHead || undefined);

    // Show persistent warnings
    const persistent = getPersistentWarnings("kimi-governance");
    if (persistent.length > 0) {
      logger.info("Persistent warnings (governance):");
      for (const p of persistent) {
        const age = p.age_days === 0 ? "today" : `${p.age_days}d ago`;
        logger.warn(`${p.check_name}: ${p.occurrence_count}× since ${age}`);
      }
    }

    if (report.fixableCount > 0) {
      logger.info("Run 'kimi-governance fix' to auto-generate missing files");
    }
    return report.errorCount > 0 ? 1 : 0;
  } else if (command === "adr") {
    const title = args.slice(1).join(" ") || "Untitled Decision";
    logger.section("ADR Scaffold");
    const filepath = await scaffoldAdr(projectDir, title, ensureDir);
    logger.info(`Created: ${filepath}`);
    logger.info("Edit the file and update status: proposed → accepted | rejected | deprecated");
  } else if (command === "ecosystem") {
    logger.section("Ecosystem Health");
    logger.info("Use: kimi-toolchain doctor --ecosystem [--quick] [--json]");
    return 1;
  } else if (command === "score") {
    const fastScore = args.includes("--fast");
    const minIndex = args.findIndex((arg) => arg === "--min");
    const minScore =
      minIndex >= 0 && args[minIndex + 1] ? parseFloat(args[minIndex + 1]) : undefined;
    logger.section(fastScore ? "Computing Fast R-Score" : "Computing R-Score");
    const score = await computeRScore(projectDir, { fast: fastScore });

    logger.info(
      `Grade: ${score.grade} (${formatPoints(score.total)}/${score.max}, ${formatPct(score.total, score.max)})`
    );
    if (fastScore) {
      logger.info("Fast mode: coverage uses latest stored history and does not run tests");
    }
    logger.info("Breakdown:");
    for (const [key, value] of Object.entries(score.breakdown)) {
      const weight = WEIGHTS[key as keyof typeof WEIGHTS];
      const indicator = breakdownIndicator(value, weight);
      logger.line(`    ${indicator} ${key}: ${formatPoints(value)}/${weight}`);
    }

    const kimiDocs = await checkKimiDocsAligned(projectDir);
    if (kimiDocs.applicable) {
      const icon = kimiDocs.aligned ? "✓" : "⚠";
      logger.info(
        `${icon} kimiDocsAligned (soft): ${kimiDocs.aligned ? "product matrix + MCP docs in sync" : "see kimi-governance doctor"}`
      );
    }

    const scaffold = await checkScaffoldAligned(projectDir);
    if (scaffold.applicable) {
      const icon = scaffold.aligned ? "✓" : "⚠";
      logger.info(
        `${icon} scaffoldAligned (soft): ${scaffold.aligned ? "AGENTS.md markers present" : "see kimi-governance doctor"}`
      );
    }

    if (await isKimiToolchainRepo(projectDir)) {
      const ecosystem = await auditEcosystemHealth(projectDir, { quick: true });
      const icon = ecosystem.blockers === 0 ? "✓" : "⚠";
      logger.info(
        `${icon} ecosystemAligned (soft): ${ecosystem.blockers === 0 ? "workspace + sync ok" : `${ecosystem.blockers} blocker(s) — kimi-toolchain doctor --ecosystem`}`
      );
    }

    if (pathExists(SCORE_HISTORY)) {
      const history = await readJsonFileOr(SCORE_HISTORY, [], isRScoreArray);
      if (history.length > 1) {
        const prev = history[history.length - 2];
        const delta = score.total - prev.total;
        const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
        const deltaStr = formatPoints(Math.abs(delta));
        const signedDelta = delta > 0 ? `+${deltaStr}` : delta < 0 ? `-${deltaStr}` : "0";
        logger.info(
          `Trend: ${arrow} ${signedDelta} from last run (${prev.grade} → ${score.grade})`
        );
      }
    }

    if (score.grade === "F" || score.grade === "D") {
      logger.error("R-Score below C — address governance gaps before release");
      return 1;
    }
    if (minScore !== undefined && score.total < minScore) {
      logger.error(`R-Score below minimum — ${formatPoints(score.total)} < ${minScore}`);
      return 1;
    }
  } else {
    logger.section("Commands");
    logger.line("  governance     Check LICENSE, CONTRIBUTING, CODEOWNERS, README, CONTEXT");
    logger.line("  coverage [N]   Test coverage gate (default threshold 70%)");
    logger.line("  docs           Detect README.md ↔ package.json script drift");
    logger.line("  fix            Auto-generate missing governance files");
    logger.line("  doctor         Diagnose governance health with actionable fixes");
    logger.line("  adr <title>    Scaffold a new ADR in docs/adr/");
    logger.line("  score          Compute full R-Score with trend");
    logger.line("  score --fast   Compute R-Score without recomputing coverage");
    logger.line("  ecosystem      → use kimi-toolchain doctor --ecosystem");
  }

  return 0;
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-governance", logger }
  );
  process.exit(exitCode);
}
