/**
 * scanner-pipeline.ts — Vulnerability scanning, semver evaluation, and
 * automated patching pipeline for secure installs.
 *
 * Phases:
 *   1. Scan     — query OSV API for known vulnerabilities
 *   2. Evaluate — use Bun.semver to determine fix strategy per CVE
 *   3. Patch    — apply fixes via bun update / bun patch
 *   4. Audit    — record results to secrets audit trail
 *
 * @see docs/scanner-pipeline-spec.md for the full specification
 * @see secrets-manager.ts for credential validation
 * @see install-secure.ts for the pipeline orchestrator
 */

import { semver } from "bun";
import { fetchWithTimeout } from "./utils.ts";
import { withFindingInspect, withPatchInspect, withScannerResultInspect } from "./cli-format.ts";

// ── Types ────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "unknown";
export type FixStrategy = "upgrade" | "patch" | "manual";

export interface DependencyInfo {
  name: string;
  current: string;
  range: string;
}

export interface OsvVulnerability {
  id: string;
  severity?: Array<{ score?: string }>;
  fixed?: string;
  summary?: string;
}

export interface VulnerabilityFinding {
  name: string;
  cveId: string;
  severity: Severity;
  cvssScore?: number;
  currentVersion: string;
  fixedVersion?: string;
  range: string;
  strategy: FixStrategy;
}

export interface PatchResult {
  name: string;
  strategy: FixStrategy;
  success: boolean;
  message: string;
  patchedVersion?: string;
}

export interface ScannerPipelineOptions {
  /** Dependencies to scan (name + current version + semver range). */
  dependencies: DependencyInfo[];
  /** Auto-patch vulnerabilities where possible. */
  patch?: boolean;
  /** Don't create a git commit after patching. */
  noCommit?: boolean;
  /** Dry-run mode — scan and evaluate but don't modify anything. */
  dryRun?: boolean;
  /** Minimum severity to act on. */
  minSeverity?: Severity;
  /** Maximum packages to patch per run. */
  maxPatches?: number;
  /** Override the bun binary path. */
  bunBin?: string;
  /** Project directory for bun patch commands. */
  projectDir?: string;
  /** Maximum deps to scan (default 10, matching kimi-guardian). */
  maxScanDeps?: number;
}

export interface ScannerPipelineResult {
  exitCode: number;
  findings: VulnerabilityFinding[];
  patches: PatchResult[];
  scanned: number;
  vulnerabilities: number;
  patched: number;
  failed: number;
  manual: number;
}

// ── Severity Helpers ─────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export function parseSeverity(score: string | undefined): Severity {
  if (!score) return "unknown";
  const num = parseFloat(score);
  if (isNaN(num)) return "unknown";
  if (num >= 9.0) return "critical";
  if (num >= 7.0) return "high";
  if (num >= 4.0) return "medium";
  return "low";
}

export function severityMeetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

// ── Dependency Discovery (Bun.Glob) ──────────────────────────────────

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Discover dependencies from a project's package.json using Bun.Glob.
 *
 * By default, scans the root package.json. When `includeWorkspaces` is true,
 * also scans workspace package.json files via glob pattern (excluding node_modules).
 *
 * Returns a deduplicated list of DependencyInfo entries.
 */
export async function discoverTargets(
  projectDir: string = Bun.cwd,
  opts: {
    includeDev?: boolean;
    includeWorkspaces?: boolean;
  } = {}
): Promise<DependencyInfo[]> {
  const { includeDev = true, includeWorkspaces = false } = opts;
  const deps = new Map<string, DependencyInfo>();

  const paths = new Set<string>();

  // Always include root package.json
  const rootPkg = joinSafe(projectDir, "package.json");
  if (pathExistsSync(rootPkg)) paths.add(rootPkg);

  // Optionally scan workspace packages via Bun.Glob
  if (includeWorkspaces) {
    const glob = new Bun.Glob("**/package.json");
    for await (const file of glob.scan({ cwd: projectDir, absolute: true })) {
      if (!file.includes("node_modules")) {
        paths.add(file);
      }
    }
  }

  for (const pkgPath of paths) {
    try {
      const pkg = (await Bun.file(pkgPath).json()) as PackageJson;
      const sections: Array<Record<string, string>> = [];
      if (pkg.dependencies) sections.push(pkg.dependencies);
      if (includeDev && pkg.devDependencies) sections.push(pkg.devDependencies);

      for (const section of sections) {
        for (const [name, range] of Object.entries(section)) {
          if (!deps.has(name)) {
            deps.set(name, { name, current: stripRange(range), range });
          }
        }
      }
    } catch {
      // Skip malformed package.json
    }
  }

  return [...deps.values()];
}

function stripRange(version: string): string {
  return (
    version
      .replace(/^[\^~>=<]+/, "")
      .split(" ")
      .at(0) ?? version
  );
}

function joinSafe(dir: string, file: string): string {
  return `${dir}/${file}`.replace(/\/+/g, "/");
}

function pathExistsSync(path: string): boolean {
  try {
    return Bun.file(path).size > 0;
  } catch {
    return false;
  }
}

// ── Phase 1: Scan (OSV API) ──────────────────────────────────────────

const OSV_API_URL = "https://api.osv.dev/v1/query";
const DEFAULT_SCAN_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SCAN_DEPS = 10;

interface OsvResponse {
  vulns?: OsvVulnerability[];
}

/**
 * Query the OSV API for vulnerabilities affecting a single dependency.
 * Returns raw vulnerability data; evaluation happens in Phase 2.
 */
export async function scanDependency(dep: DependencyInfo): Promise<OsvVulnerability[]> {
  try {
    const resp = (await fetchWithTimeout(OSV_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name: dep.name, ecosystem: "npm" },
        version: dep.current,
      }),
      timeoutMs: DEFAULT_SCAN_TIMEOUT_MS,
    })) as unknown as {
      status: number;
      json(): Promise<OsvResponse>;
    };

    if (resp.status < 200 || resp.status >= 300) return [];
    const data = await resp.json();
    return data.vulns ?? [];
  } catch {
    return [];
  }
}

/**
 * Scan multiple dependencies for vulnerabilities.
 * Respects the maxScanDeps limit (default 10).
 */
export async function scanDependencies(
  deps: DependencyInfo[],
  maxScanDeps: number = DEFAULT_MAX_SCAN_DEPS
): Promise<Array<{ dep: DependencyInfo; vulns: OsvVulnerability[] }>> {
  const results: Array<{ dep: DependencyInfo; vulns: OsvVulnerability[] }> = [];
  for (const dep of deps.slice(0, maxScanDeps)) {
    const vulns = await scanDependency(dep);
    if (vulns.length > 0) {
      results.push({ dep, vulns });
    }
  }
  return results;
}

// ── Phase 2: Evaluate (Bun.semver) ───────────────────────────────────

/**
 * Determine the fix strategy for a vulnerability using Bun.semver.
 *
 * Decision tree:
 *   - No fixed version → "manual"
 *   - Fixed version within current range → "upgrade"
 *   - Fixed version outside range → "manual" (would require range change)
 */
export function evaluateVulnerability(
  dep: DependencyInfo,
  vuln: OsvVulnerability
): VulnerabilityFinding {
  const severity = parseSeverity(vuln.severity?.[0]?.score);
  const cvssScore = vuln.severity?.[0]?.score ? parseFloat(vuln.severity[0].score) : undefined;

  let strategy: FixStrategy = "manual";

  if (vuln.fixed) {
    const fixedIsNewer = semver.order(vuln.fixed, dep.current) > 0;
    const fixedInRange = semver.satisfies(vuln.fixed, dep.range);

    if (fixedIsNewer && fixedInRange) {
      strategy = "upgrade";
    } else if (fixedIsNewer) {
      // Fixed version exists but is outside current range — could patch
      // the constraint, but that's a manual decision
      strategy = "manual";
    }
  }

  return withFindingInspect({
    name: dep.name,
    cveId: vuln.id,
    severity,
    cvssScore,
    currentVersion: dep.current,
    fixedVersion: vuln.fixed,
    range: dep.range,
    strategy,
  });
}

/**
 * Evaluate all scan results and produce vulnerability findings.
 * Filters by severity threshold.
 */
export function evaluateScanResults(
  scanResults: Array<{ dep: DependencyInfo; vulns: OsvVulnerability[] }>,
  minSeverity: Severity = "low"
): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];

  for (const { dep, vulns } of scanResults) {
    for (const vuln of vulns) {
      const finding = evaluateVulnerability(dep, vuln);
      if (severityMeetsThreshold(finding.severity, minSeverity)) {
        findings.push(finding);
      }
    }
  }

  return findings;
}

// ── Phase 3: Patch (bun update / bun patch) ──────────────────────────

const DEFAULT_MAX_PATCHES = 5;
const DEFAULT_BUN_BIN = "bun";

/**
 * Apply a single fix by upgrading the dependency.
 * Uses `bun update <pkg>@<version>` for in-range upgrades.
 */
export async function applyUpgrade(
  finding: VulnerabilityFinding,
  bunBin: string = DEFAULT_BUN_BIN,
  projectDir?: string
): Promise<PatchResult> {
  if (!finding.fixedVersion) {
    return {
      name: finding.name,
      strategy: "upgrade",
      success: false,
      message: "No fixed version available",
    };
  }

  try {
    const cmd = [bunBin, "update", `${finding.name}@${finding.fixedVersion}`];
    const proc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectDir ?? Bun.cwd,
    });
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return {
        name: finding.name,
        strategy: "upgrade",
        success: true,
        message: `Upgraded to ${finding.fixedVersion}`,
        patchedVersion: finding.fixedVersion,
      };
    }
    const stderr = await new Response(proc.stderr).text();
    return {
      name: finding.name,
      strategy: "upgrade",
      success: false,
      message: `bun update failed: ${stderr.trim()}`,
    };
  } catch (err) {
    return {
      name: finding.name,
      strategy: "upgrade",
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Apply a patch to a dependency using `bun patch`.
 *
 * Steps:
 *   1. `bun patch <pkg>@<version>` — prepare
 *   2. `bun patch --commit <pkg>@<version>` — commit the patch
 */
export async function applyBunPatch(
  finding: VulnerabilityFinding,
  bunBin: string = DEFAULT_BUN_BIN,
  projectDir?: string
): Promise<PatchResult> {
  const pkgRef = `${finding.name}@${finding.currentVersion}`;
  const cwd = projectDir ?? Bun.cwd;

  try {
    // Step 1: Prepare
    const prepProc = Bun.spawn({
      cmd: [bunBin, "patch", pkgRef],
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const prepExit = await prepProc.exited;
    if (prepExit !== 0) {
      const stderr = await new Response(prepProc.stderr).text();
      return {
        name: finding.name,
        strategy: "patch",
        success: false,
        message: `bun patch prepare failed: ${stderr.trim()}`,
      };
    }

    // Step 2: Commit
    const commitProc = Bun.spawn({
      cmd: [bunBin, "patch", "--commit", pkgRef],
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const commitExit = await commitProc.exited;

    if (commitExit === 0) {
      return {
        name: finding.name,
        strategy: "patch",
        success: true,
        message: `Patched ${pkgRef}`,
        patchedVersion: finding.currentVersion,
      };
    }
    const stderr = await new Response(commitProc.stderr).text();
    return {
      name: finding.name,
      strategy: "patch",
      success: false,
      message: `bun patch --commit failed: ${stderr.trim()}`,
    };
  } catch (err) {
    return {
      name: finding.name,
      strategy: "patch",
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Apply patches for a list of findings, respecting the max-patches limit.
 * Only patches findings with strategy "upgrade" or "patch".
 */
export async function applyPatches(
  findings: VulnerabilityFinding[],
  opts: {
    patch?: boolean;
    maxPatches?: number;
    bunBin?: string;
    projectDir?: string;
  } = {}
): Promise<PatchResult[]> {
  if (!opts.patch) return [];

  const maxPatches = opts.maxPatches ?? DEFAULT_MAX_PATCHES;
  const bunBin = opts.bunBin ?? DEFAULT_BUN_BIN;
  const patchable = findings
    .filter((f) => f.strategy === "upgrade" || f.strategy === "patch")
    .slice(0, maxPatches);

  const results: PatchResult[] = [];

  for (const finding of patchable) {
    const result =
      finding.strategy === "upgrade"
        ? await applyUpgrade(finding, bunBin, opts.projectDir)
        : await applyBunPatch(finding, bunBin, opts.projectDir);
    results.push(withPatchInspect(result));
  }

  return results;
}

// ── Full Pipeline ────────────────────────────────────────────────────

/**
 * Run the full scanner pipeline:
 *   1. Scan dependencies via OSV API
 *   2. Evaluate findings with Bun.semver
 *   3. Patch (if --patch flag set)
 *   4. Return structured result
 */
export async function runScannerPipeline(
  opts: ScannerPipelineOptions
): Promise<ScannerPipelineResult> {
  const minSeverity = opts.minSeverity ?? "low";
  const maxPatches = opts.maxPatches ?? DEFAULT_MAX_PATCHES;
  const maxScanDeps = opts.maxScanDeps ?? DEFAULT_MAX_SCAN_DEPS;

  // Phase 1: Scan
  const scanResults = await scanDependencies(opts.dependencies, maxScanDeps);

  // Phase 2: Evaluate
  const findings = evaluateScanResults(scanResults, minSeverity);

  if (findings.length === 0) {
    return withScannerResultInspect({
      exitCode: 0,
      findings: [],
      patches: [],
      scanned: Math.min(opts.dependencies.length, maxScanDeps),
      vulnerabilities: 0,
      patched: 0,
      failed: 0,
      manual: 0,
    });
  }

  // Phase 3: Patch
  let patches: PatchResult[] = [];
  if (opts.patch && !opts.dryRun) {
    patches = await applyPatches(findings, {
      patch: true,
      maxPatches,
      bunBin: opts.bunBin,
      projectDir: opts.projectDir,
    });
  }

  // Phase 4: Summarize
  const patched = patches.filter((p) => p.success).length;
  const failed = patches.filter((p) => !p.success).length;
  const manual = findings.filter((f) => f.strategy === "manual").length;

  let exitCode: number;
  if (opts.dryRun) {
    exitCode = findings.length > 0 ? 20 : 0;
  } else if (patches.length === 0) {
    exitCode = 20;
  } else if (failed > 0 && patched === 0) {
    exitCode = 22;
  } else if (failed > 0) {
    exitCode = 21;
  } else {
    exitCode = 0;
  }

  return withScannerResultInspect({
    exitCode,
    findings,
    patches,
    scanned: Math.min(opts.dependencies.length, maxScanDeps),
    vulnerabilities: findings.length,
    patched,
    failed,
    manual,
  });
}
