/**
 * src/lib/governance.ts
 *
 * Pure governance library functions — no CLI side effects.
 * Extracted from src/bin/kimi-governance.ts for reuse.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { $ } from "bun";
import { readableStreamToText } from "./bun-utils.ts";
import { ensureDir, getProjectName } from "./utils.ts";
import { bunTestArgs, useFastUnitCoverage } from "./test-gates.ts";
import { governorDir } from "./paths.ts";
import { checkGovernance, type GovernanceCheck } from "./governance-check.ts";
import { ARTIFACTS_COVERAGE_DIR } from "./artifacts.ts";

export { checkGovernance, type GovernanceCheck };

function governanceDir(): string {
  return governorDir();
}

function coverageHistoryPath(): string {
  return join(governanceDir(), "coverage-history.json");
}

export interface RScore {
  project: string;
  timestamp: string;
  total: number;
  max: number;
  breakdown: Record<string, number>;
  grade: string;
}

export interface CoverageReport {
  covered: number;
  total: number;
  percentage: number;
  files: Array<{ path: string; covered: number; total: number; percentage: number }>;
}

interface CoverageHistoryEntry {
  project: string;
  timestamp: string;
  percentage: number;
  covered: number;
  total: number;
}

// ── Test Coverage Gate ─────────────────────────────────────────────────

export async function checkCoverage(projectDir: string, _threshold = 70): Promise<CoverageReport> {
  const report: CoverageReport = { covered: 0, total: 0, percentage: 0, files: [] };

  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) return report;

  const pkg = (await Bun.file(pkgPath).json()) as any;
  const hasTests =
    pkg.scripts?.test ||
    pathExists(join(projectDir, "test")) ||
    pathExists(join(projectDir, "tests"));
  if (!hasTests) return report;

  const fastCoverage = useFastUnitCoverage(pkg.name);

  async function spawnCoverage(json: boolean) {
    const proc = Bun.spawn(["bun", ...bunTestArgs({ coverage: true, json, fast: fastCoverage })], {
      cwd: projectDir,
      env: { ...Bun.env, KIMI_COVERAGE_SCAN: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
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
            const [, , hits] = line.split(":")[1].split(",");
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

// ── Coverage History ───────────────────────────────────────────────────

export async function storeCoverageHistory(projectDir: string, report: CoverageReport) {
  const historyPath = coverageHistoryPath();
  ensureDir(governanceDir());
  let history: CoverageHistoryEntry[] = [];
  if (pathExists(historyPath)) {
    try {
      history = (await Bun.file(historyPath).json()) as CoverageHistoryEntry[];
    } catch {
      history = [];
    }
  }

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

  await Bun.write(historyPath, JSON.stringify(trimmed, null, 2));
}

/** Latest cached coverage entry for a project (no test subprocess). */
export async function loadCachedCoverage(projectDir: string): Promise<CoverageReport | null> {
  const historyPath = coverageHistoryPath();
  if (!pathExists(historyPath)) return null;
  let history: CoverageHistoryEntry[];
  try {
    history = (await Bun.file(historyPath).json()) as CoverageHistoryEntry[];
  } catch {
    return null;
  }
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

// ── Stale Lockfile Refresh ───────────────────────────────────────────

export async function refreshStaleLockfile(projectDir: string): Promise<boolean> {
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

// ── ADR Scaffold ───────────────────────────────────────────────────────

const ADR_TEMPLATE = `---
status: proposed
date: {{DATE}}
deciders: {{DECIDERS}}
consulted: []
informed: []
---

# {{TITLE}}

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing or have agreed to implement?

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- 

### Negative

- 

### Neutral

- 

## Alternatives Considered

| Alternative | Pros | Cons | Decision |
|-------------|------|------|----------|
| Option A | | | Rejected |
| Option B | | | Selected |

## References

- 
`;

export async function scaffoldAdr(projectDir: string, title: string): Promise<string> {
  const adrDir = join(projectDir, "docs", "adr");
  ensureDir(adrDir);

  const existing = [];
  const glob = new Bun.Glob("*.md");
  for await (const file of glob.scan({ cwd: adrDir, absolute: false })) {
    const num = parseInt(file.split("-")[0], 10);
    if (!isNaN(num)) existing.push(num);
  }
  const nextNum = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  const paddedNum = String(nextNum).padStart(4, "0");

  const slug = title
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = `${paddedNum}-${slug}.md`;
  const filepath = join(adrDir, filename);

  const content = ADR_TEMPLATE.replace("{{DATE}}", new Date().toISOString().split("T")[0])
    .replace("{{DECIDERS}}", "@team")
    .replace("{{TITLE}}", title);

  await Bun.write(filepath, content);
  return filepath;
}
