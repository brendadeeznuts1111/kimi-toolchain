/**
 * bundle-gate.ts — Bun build --metafile-md bundle analysis gate.
 *
 * Runs `bun build --metafile-md=<tmp>` on a project entry point, parses the
 * LLM-friendly markdown report, and surfaces bloat warnings.
 *
 * B3.5 — metafile-md bundle gate integration.
 * @see https://bun.com/docs/cli/build#--metafile-md
 */

import { join } from "path";
import { tmpdir } from "os";
import { pathExists, readText } from "./bun-io.ts";
import { readableStreamToText } from "./bun-utils.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface BundleGateEntryPoint {
  /** Relative path from project root (e.g. "src/bin/kimi-doctor.ts"). */
  path: string;
  /** Target: "bun" | "node" | "browser" */
  target?: string;
}

export interface BundleModuleRow {
  outputBytes: number;
  pctOfTotal: number;
  module: string;
  format: string;
}

export interface BundleQuickSummary {
  totalBytes: number;
  inputModules: number;
  entryPoints: number;
  nodeModulesBytes: number;
  nodeModulesFiles: number;
  esmModules: number;
  cjsModules: number;
  externalImports: number;
}

export interface BundleGateFinding {
  severity: "error" | "warn" | "info";
  rule: string;
  message: string;
  detail: string;
}

export interface BundleGateReport {
  schemaVersion: 1;
  tool: "bundle-gate";
  ok: boolean;
  entryPoint: string;
  summary: BundleQuickSummary | null;
  largestModules: BundleModuleRow[];
  findings: BundleGateFinding[];
  markdownPath: string | null;
  error: string | null;
  generatedAt: string;
}

export interface BundleGateOptions {
  projectRoot: string;
  entryPoints?: BundleGateEntryPoint[];
  /** Total bundle size threshold in bytes (default: 15 MB). */
  maxTotalBytes?: number;
  /** Single-module contribution threshold as fraction (default: 0.15 = 15%). */
  maxSingleModuleFraction?: number;
  /** node_modules contribution threshold as fraction (default: 0.60 = 60%). */
  maxNodeModulesFraction?: number;
  /** Max number of input modules before warning (default: 500). */
  maxInputModules?: number;
}

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_SINGLE_FRACTION = 0.15;
const DEFAULT_MAX_NODE_MODULES_FRACTION = 0.6;
const DEFAULT_MAX_INPUT_MODULES = 500;
const DEFAULT_ENTRY_POINT = "src/bin/kimi-doctor.ts";

// ── Report parsing ─────────────────────────────────────────────────

function parseQuickSummary(section: string): BundleQuickSummary | null {
  const lines = section.split("\n");
  const metrics: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key === "Metric" || key.startsWith("---")) continue;
    metrics[key] = value;
  }

  const parseBytes = (raw: string): number => {
    const match = raw.match(/^([\d.]+)\s*(MB|KB|B|GB)/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === "GB") return num * 1024 * 1024 * 1024;
    if (unit === "MB") return num * 1024 * 1024;
    if (unit === "KB") return num * 1024;
    return num;
  };

  const parseNum = (raw: string): number => {
    const cleaned = raw.replace(/[,_]/g, "").trim();
    return parseInt(cleaned, 10) || 0;
  };

  const totalBytes = parseBytes(metrics["Total output size"] ?? metrics["Total size"] ?? "0 B");
  const nodeModulesContribution = metrics["node_modules contribution"] ?? "";
  const nodeModulesMatch = nodeModulesContribution.match(/(\d+)\s*files?\s*\(([^)]+)\)/);

  return {
    totalBytes,
    inputModules: parseNum(metrics["Input modules"] ?? "0"),
    entryPoints: parseNum(metrics["Entry points"] ?? "0"),
    nodeModulesFiles: nodeModulesMatch ? parseNum(nodeModulesMatch[1]) : 0,
    nodeModulesBytes: nodeModulesMatch ? parseBytes(nodeModulesMatch[2]) : 0,
    esmModules: parseNum(metrics["ESM modules"] ?? "0"),
    cjsModules: parseNum(metrics["CommonJS modules"] ?? "0"),
    externalImports: parseNum(metrics["External imports"] ?? "0"),
  };
}

function parseLargestModules(section: string): BundleModuleRow[] {
  const rows: BundleModuleRow[] = [];
  const lines = section.split("\n");
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith("| Output Bytes")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    // Skip header divider
    if (line.startsWith("|-")) continue;
    // Stop at next heading
    if (line.startsWith("## ") || line.startsWith("# ")) break;
    // Stop at continuation note
    if (line.includes("more modules with output contribution")) break;

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 4) continue;

    const outputBytes = parseBytes(cells[0]);
    const pctStr = cells[1].replace("%", "").trim();
    const pctOfTotal = parseFloat(pctStr) || 0;
    const module = cells[2];
    const format = cells[3];

    if (!isNaN(outputBytes) && module) {
      rows.push({ outputBytes, pctOfTotal, module, format });
    }
  }

  return rows;

  function parseBytes(raw: string): number {
    if (!raw) return 0;
    raw = raw.replace(/,/g, "").trim();
    if (raw.endsWith("MB")) return parseFloat(raw) * 1024 * 1024;
    if (raw.endsWith("KB")) return parseFloat(raw) * 1024;
    if (raw.endsWith("GB")) return parseFloat(raw) * 1024 * 1024 * 1024;
    if (raw.endsWith("B")) return parseFloat(raw);
    return parseFloat(raw) || 0;
  }
}

function extractSection(report: string, heading: string): string {
  const marker = `## ${heading}`;
  const idx = report.indexOf(marker);
  if (idx < 0) return "";

  const nextIdx = report.indexOf("\n## ", idx + marker.length);
  return nextIdx > 0 ? report.slice(idx, nextIdx) : report.slice(idx);
}

// ── Rule evaluation ────────────────────────────────────────────────

function evaluate(
  summary: BundleQuickSummary,
  largest: BundleModuleRow[],
  options: BundleGateOptions
): BundleGateFinding[] {
  const findings: BundleGateFinding[] = [];
  const maxTotal = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxSingle = options.maxSingleModuleFraction ?? DEFAULT_MAX_SINGLE_FRACTION;
  const maxNm = options.maxNodeModulesFraction ?? DEFAULT_MAX_NODE_MODULES_FRACTION;
  const maxInput = options.maxInputModules ?? DEFAULT_MAX_INPUT_MODULES;

  // Total size
  if (summary.totalBytes > maxTotal) {
    const mb = (summary.totalBytes / (1024 * 1024)).toFixed(1);
    const maxMb = (maxTotal / (1024 * 1024)).toFixed(0);
    findings.push({
      severity: "error",
      rule: "bundle-size",
      message: `Bundle size ${mb} MB exceeds ${maxMb} MB threshold`,
      detail: `${summary.inputModules} modules contribute to ${mb} MB total output.`,
    });
  }

  // Single module contribution
  if (largest.length > 0 && largest[0].pctOfTotal > maxSingle * 100) {
    const top = largest[0];
    findings.push({
      severity: "warn",
      rule: "single-module-bloat",
      message: `${top.module} contributes ${top.pctOfTotal.toFixed(1)}% of bundle`,
      detail: `${(top.outputBytes / (1024 * 1024)).toFixed(1)} MB — consider tree-shaking or dynamic import.`,
    });
  }

  // node_modules contribution
  if (summary.nodeModulesBytes > 0 && summary.totalBytes > 0) {
    const fraction = summary.nodeModulesBytes / summary.totalBytes;
    if (fraction > maxNm) {
      findings.push({
        severity: "warn",
        rule: "node-modules-bloat",
        message: `node_modules contributes ${(fraction * 100).toFixed(0)}% of bundle (${summary.nodeModulesFiles} files)`,
        detail: `${(summary.nodeModulesBytes / (1024 * 1024)).toFixed(1)} MB from dependencies.`,
      });
    }
  }

  // Module count
  if (summary.inputModules > maxInput) {
    findings.push({
      severity: "info",
      rule: "module-count",
      message: `${summary.inputModules} input modules (threshold: ${maxInput})`,
      detail: "High module count increases build time and cognitive overhead.",
    });
  }

  return findings;
}

// ── Main ───────────────────────────────────────────────────────────

export async function runBundleGate(options: BundleGateOptions): Promise<BundleGateReport> {
  const projectRoot = options.projectRoot;
  const entryPoints = options.entryPoints ?? [{ path: DEFAULT_ENTRY_POINT, target: "bun" }];
  const generatedAt = new Date().toISOString();

  // Validate at least one entry point
  const validEntry = entryPoints.find((ep) => pathExists(join(projectRoot, ep.path)));
  if (!validEntry) {
    return {
      schemaVersion: 1,
      tool: "bundle-gate",
      ok: false,
      entryPoint: entryPoints.map((e) => e.path).join(", "),
      summary: null,
      largestModules: [],
      findings: [
        {
          severity: "error",
          rule: "no-entry-point",
          message: "No valid entry point found",
          detail: `Checked: ${entryPoints.map((e) => e.path).join(", ")}`,
        },
      ],
      markdownPath: null,
      error: "No valid entry point found",
      generatedAt,
    };
  }

  const outDir = join(tmpdir(), `bundle-gate-${Bun.nanoseconds()}`);
  const markdownPath = join(outDir, "report.md");

  try {
    // Build
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        validEntry.path,
        "--outdir",
        outDir,
        `--metafile-md=${markdownPath}`,
        "--target",
        validEntry.target ?? "bun",
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const [_stdout, stderr] = await Promise.all([
      readableStreamToText(proc.stdout),
      readableStreamToText(proc.stderr),
    ]);
    await proc.exited;

    if (proc.exitCode !== 0) {
      return {
        schemaVersion: 1,
        tool: "bundle-gate",
        ok: false,
        entryPoint: validEntry.path,
        summary: null,
        largestModules: [],
        findings: [
          {
            severity: "error",
            rule: "build-failed",
            message: `bun build exited with code ${proc.exitCode}`,
            detail: stderr.slice(0, 500),
          },
        ],
        markdownPath: null,
        error: stderr.slice(0, 500),
        generatedAt,
      };
    }

    // Parse report
    if (!pathExists(markdownPath)) {
      return {
        schemaVersion: 1,
        tool: "bundle-gate",
        ok: false,
        entryPoint: validEntry.path,
        summary: null,
        largestModules: [],
        findings: [
          {
            severity: "error",
            rule: "report-missing",
            message: "Metafile markdown report not generated",
            detail: `Expected: ${markdownPath}`,
          },
        ],
        markdownPath: null,
        error: "Metafile markdown report not generated",
        generatedAt,
      };
    }

    const reportMd = readText(markdownPath);
    const quickSection = extractSection(reportMd, "Quick Summary");
    const largestSection = extractSection(reportMd, "Largest Modules by Output Contribution");

    const summary = quickSection ? parseQuickSummary(quickSection) : null;
    const largestModules = largestSection ? parseLargestModules(largestSection) : [];
    const findings = summary
      ? evaluate(summary, largestModules, options)
      : [
          {
            severity: "error" as const,
            rule: "parse-failed",
            message: "Failed to parse Quick Summary from metafile report",
            detail: "Bun build succeeded but report parsing failed.",
          },
        ];

    return {
      schemaVersion: 1,
      tool: "bundle-gate",
      ok: findings.filter((f) => f.severity === "error").length === 0,
      entryPoint: validEntry.path,
      summary,
      largestModules,
      findings,
      markdownPath,
      error: null,
      generatedAt,
    };
  } catch (err) {
    return {
      schemaVersion: 1,
      tool: "bundle-gate",
      ok: false,
      entryPoint: validEntry.path,
      summary: null,
      largestModules: [],
      findings: [
        {
          severity: "error",
          rule: "gate-exception",
          message: `Bundle gate threw: ${(err as Error).message}`,
          detail: String(err).slice(0, 500),
        },
      ],
      markdownPath: null,
      error: String(err).slice(0, 500),
      generatedAt,
    };
  }
}

// ── Shortcut ───────────────────────────────────────────────────────

/** Quick bundle analysis for the default kimi-doctor entry point. */
export async function quickBundleGate(projectRoot: string): Promise<BundleGateReport> {
  return runBundleGate({ projectRoot });
}
