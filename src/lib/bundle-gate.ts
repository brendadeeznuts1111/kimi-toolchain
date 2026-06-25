/**
 * bundle-gate.ts — Bun.build metafile bundle analysis gate.
 *
 * Runs `Bun.build({ metafile: true })` on a project entry point, writes
 * esbuild-compatible `meta.json` for machine-readable drift, and emits an
 * LLM-friendly markdown summary alongside the JSON artifact.
 *
 * B3.5 — metafile-md bundle gate integration.
 * @see https://bun.com/docs/bundler#metafile
 * @see https://bun.com/docs/cli/build#--metafile-md
 */

import { join, relative, resolve } from "path";
import { tmpdir } from "os";
import { pathExists, readJsonValidated } from "./bun-io.ts";
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

export interface BundleMetafileInput {
  bytes: number;
  format?: string;
  imports?: { external?: boolean }[];
}

export interface BundleMetafileOutput {
  bytes: number;
  entryPoint?: string;
  inputs?: Record<string, { bytesInOutput: number }>;
}

export interface BundleMetafile {
  inputs: Record<string, BundleMetafileInput>;
  outputs: Record<string, BundleMetafileOutput>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBundleMetafile(value: unknown): value is BundleMetafile {
  if (!isRecord(value)) return false;
  return isRecord(value.inputs) && isRecord(value.outputs);
}

export interface BundleGateReport {
  schemaVersion: 1;
  tool: "bundle-gate";
  ok: boolean;
  entryPoint: string;
  summary: BundleQuickSummary | null;
  largestModules: BundleModuleRow[];
  findings: BundleGateFinding[];
  /** esbuild-compatible metafile JSON path (machine-readable drift). */
  metafilePath: string | null;
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

let bundleBuildChain: Promise<void> = Promise.resolve();

/** Serialize Bun.build calls — concurrent bundler runs throw AggregateError in bun:test. */
async function withBundleBuildLock<T>(run: () => Promise<T>): Promise<T> {
  const prior = bundleBuildChain;
  let release!: () => void;
  bundleBuildChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await run();
  } finally {
    release();
  }
}

// ── Report parsing ─────────────────────────────────────────────────

// Exported for tests.
export function parseQuickSummary(section: string): BundleQuickSummary | null {
  const lines = section.split("\n");
  const metrics: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match) continue;
    const key = match[1]!.trim();
    const value = match[2]!.trim();
    if (key === "Metric" || key.startsWith("---")) continue;
    metrics[key] = value;
  }

  const parseBytes = (raw: string): number => {
    const match = raw.match(/^([\d.]+)\s*(MB|KB|B|GB)/i);
    if (!match) return 0;
    const num = parseFloat(match[1]!);
    const unit = match[2]!.toUpperCase();
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
    nodeModulesFiles: nodeModulesMatch ? parseNum(nodeModulesMatch[1]!) : 0,
    nodeModulesBytes: nodeModulesMatch ? parseBytes(nodeModulesMatch[2]!) : 0,
    esmModules: parseNum(metrics["ESM modules"] ?? "0"),
    cjsModules: parseNum(metrics["CommonJS modules"] ?? "0"),
    externalImports: parseNum(metrics["External imports"] ?? "0"),
  };
}

// Exported for tests.
export function parseLargestModules(section: string): BundleModuleRow[] {
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

    const outputBytes = parseBytes(cells[0]!);
    const pctStr = cells[1]!.replace("%", "").trim();
    const pctOfTotal = parseFloat(pctStr) || 0;
    const module = cells[2]!;
    const format = cells[3]!;

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

// Exported for tests.
export function extractSection(report: string, heading: string): string {
  const marker = `## ${heading}`;
  const idx = report.indexOf(marker);
  if (idx < 0) return "";

  const nextIdx = report.indexOf("\n## ", idx + marker.length);
  return nextIdx > 0 ? report.slice(idx, nextIdx) : report.slice(idx);
}

// ── Metafile JSON (Bun.build metafile: true) ─────────────────────

function formatBytesHuman(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

/** Summarize esbuild metafile JSON from Bun.build({ metafile: true }). */
export function summarizeMetafile(metafile: BundleMetafile): BundleQuickSummary {
  const inputModules = Object.keys(metafile.inputs).length;
  const outputEntries = Object.entries(metafile.outputs);
  const totalBytes = outputEntries.reduce((sum, [, output]) => sum + output.bytes, 0);
  const entryPoints =
    outputEntries.filter(([, output]) => output.entryPoint).length || outputEntries.length;

  let nodeModulesBytes = 0;
  const nodeModulePaths = new Set<string>();
  let esmModules = 0;
  let cjsModules = 0;
  let externalImports = 0;

  for (const input of Object.values(metafile.inputs)) {
    if (input.format === "esm") esmModules++;
    else if (input.format === "cjs") cjsModules++;
    for (const imp of input.imports ?? []) {
      if (imp.external) externalImports++;
    }
  }

  for (const [, output] of outputEntries) {
    for (const [modulePath, contrib] of Object.entries(output.inputs ?? {})) {
      if (!modulePath.includes("node_modules")) continue;
      nodeModulesBytes += contrib.bytesInOutput;
      nodeModulePaths.add(modulePath);
    }
  }

  return {
    totalBytes,
    inputModules,
    entryPoints,
    nodeModulesBytes,
    nodeModulesFiles: nodeModulePaths.size,
    esmModules,
    cjsModules,
    externalImports,
  };
}

/** Rank modules by output contribution from esbuild metafile JSON. */
export function largestModulesFromMetafile(metafile: BundleMetafile): BundleModuleRow[] {
  const totalBytes = Object.values(metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
  const contributions = new Map<string, { bytes: number; format: string }>();

  for (const [, output] of Object.entries(metafile.outputs)) {
    for (const [modulePath, contrib] of Object.entries(output.inputs ?? {})) {
      const existing = contributions.get(modulePath);
      const inputFormat = metafile.inputs[modulePath]?.format ?? "esm";
      if (existing) {
        existing.bytes += contrib.bytesInOutput;
      } else {
        contributions.set(modulePath, { bytes: contrib.bytesInOutput, format: inputFormat });
      }
    }
  }

  return [...contributions.entries()]
    .map(([module, data]) => ({
      outputBytes: data.bytes,
      pctOfTotal: totalBytes > 0 ? (data.bytes / totalBytes) * 100 : 0,
      module,
      format: data.format,
    }))
    .sort((a, b) => b.outputBytes - a.outputBytes);
}

/** Markdown summary from esbuild metafile JSON (alias for gate + integration tests). */
export function generateMarkdownSummary(metafile: BundleMetafile): string {
  return formatMetafileMarkdown(summarizeMetafile(metafile), largestModulesFromMetafile(metafile));
}

/** Write an LLM-friendly markdown report compatible with legacy parsers. */
export function formatMetafileMarkdown(
  summary: BundleQuickSummary,
  largest: BundleModuleRow[]
): string {
  const lines = [
    "# Bundle Analysis Report",
    "",
    "## Quick Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Total output size | ${formatBytesHuman(summary.totalBytes)} |`,
    `| Input modules | ${summary.inputModules} |`,
    `| Entry points | ${summary.entryPoints} |`,
    `| node_modules contribution | ${summary.nodeModulesFiles} files (${formatBytesHuman(summary.nodeModulesBytes)}) |`,
    `| ESM modules | ${summary.esmModules} |`,
    `| CommonJS modules | ${summary.cjsModules} |`,
    `| External imports | ${summary.externalImports} |`,
    "",
    "## Largest Modules by Output Contribution",
    "",
    "| Output Bytes | % of Total | Module | Format |",
    "|--------------|------------|--------|--------|",
  ];

  for (const row of largest.slice(0, 20)) {
    lines.push(
      `| ${formatBytesHuman(row.outputBytes)} | ${row.pctOfTotal.toFixed(1)}% | \`${row.module}\` | ${row.format} |`
    );
  }

  if (largest.length > 20) {
    lines.push("", `*...and ${largest.length - 20} more modules with output contribution*`);
  }

  return `${lines.join("\n")}\n`;
}

// ── Rule evaluation ────────────────────────────────────────────────

// Exported for tests.
export function evaluate(
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
  if (largest.length > 0 && largest[0]!.pctOfTotal > maxSingle * 100) {
    const top = largest[0]!;
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

export type BundleBuildArtifacts = {
  metafile: BundleMetafile;
  metafilePath: string;
  markdownPath: string;
};

export interface BuildWithMetafileResult extends BundleBuildArtifacts {
  outDir: string;
  entryPath: string;
}

/**
 * Build a single entry with `Bun.build({ metafile: true })` and write meta.json + markdown.
 * Throws when the entry is missing or the build fails.
 */
export async function buildWithMetafile(
  entryPath: string,
  outDir: string,
  options: { target?: string; projectRoot?: string } = {}
): Promise<BuildWithMetafileResult> {
  const absoluteEntry = resolve(entryPath);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());

  if (!(await Bun.file(absoluteEntry).exists())) {
    throw new Error(`Entry point not found: ${entryPath}`);
  }

  const relEntry = relative(projectRoot, absoluteEntry);
  if (relEntry.startsWith("..")) {
    throw new Error(`Entry point outside project root: ${entryPath}`);
  }

  const metafilePath = join(outDir, "meta.json");
  const markdownPath = join(outDir, "report.md");
  const built = await buildProjectBundle(
    projectRoot,
    { path: relEntry, target: options.target ?? "bun" },
    outDir,
    metafilePath,
    markdownPath
  );

  if ("error" in built) {
    throw new Error(built.error);
  }

  return { ...built, outDir, entryPath: absoluteEntry };
}

/**
 * Prefer Bun.build({ metafile: true }); fall back to CLI `--metafile` when the
 * in-process bundler throws (parallel bun:test workers).
 */
async function buildProjectBundle(
  projectRoot: string,
  validEntry: BundleGateEntryPoint,
  outDir: string,
  metafilePath: string,
  markdownPath: string
): Promise<BundleBuildArtifacts | { error: string }> {
  const entryPath = join(projectRoot, validEntry.path);
  const target = validEntry.target ?? "bun";

  try {
    const buildResult = await withBundleBuildLock(() =>
      Bun.build({
        entrypoints: [entryPath],
        outdir: outDir,
        target: target as "bun",
        metafile: true,
      })
    );
    if (buildResult.success && buildResult.metafile) {
      const metafile = buildResult.metafile as BundleMetafile;
      await Bun.write(metafilePath, JSON.stringify(metafile));
      const summary = summarizeMetafile(metafile);
      const largest = largestModulesFromMetafile(metafile);
      await Bun.write(markdownPath, formatMetafileMarkdown(summary, largest));
      return { metafile, metafilePath, markdownPath };
    }
  } catch {
    // CLI fallback below — safe under parallel bun:test.
  }

  const proc = Bun.spawn(
    [
      "bun",
      "build",
      validEntry.path,
      "--outdir",
      outDir,
      `--metafile=${metafilePath}`,
      `--metafile-md=${markdownPath}`,
      "--target",
      target,
    ],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe" }
  );
  const stderr = await readableStreamToText(proc.stderr);
  await proc.exited;
  if (proc.exitCode !== 0) {
    return { error: stderr.slice(0, 500) || `bun build exited with code ${proc.exitCode}` };
  }
  if (!(await Bun.file(metafilePath).exists())) {
    return { error: `metafile not written: ${metafilePath}` };
  }
  const metafile = await readJsonValidated(metafilePath, isBundleMetafile);
  if (!(await Bun.file(markdownPath).exists())) {
    const summary = summarizeMetafile(metafile);
    const largest = largestModulesFromMetafile(metafile);
    await Bun.write(markdownPath, formatMetafileMarkdown(summary, largest));
  }
  return { metafile, metafilePath, markdownPath };
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
      metafilePath: null,
      markdownPath: null,
      error: "No valid entry point found",
      generatedAt,
    };
  }

  const outDir = join(tmpdir(), `bundle-gate-${Bun.nanoseconds()}`);
  const markdownPath = join(outDir, "report.md");
  const metafilePath = join(outDir, "meta.json");

  try {
    const built = await buildProjectBundle(
      projectRoot,
      validEntry,
      outDir,
      metafilePath,
      markdownPath
    );
    if ("error" in built) {
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
            message: "Bundle build failed",
            detail: built.error,
          },
        ],
        metafilePath: null,
        markdownPath: null,
        error: built.error,
        generatedAt,
      };
    }

    const summary = summarizeMetafile(built.metafile);
    const largestModules = largestModulesFromMetafile(built.metafile);
    const findings = evaluate(summary, largestModules, options);

    return {
      schemaVersion: 1,
      tool: "bundle-gate",
      ok: findings.filter((f) => f.severity === "error").length === 0,
      entryPoint: validEntry.path,
      summary,
      largestModules,
      findings,
      metafilePath: built.metafilePath,
      markdownPath: built.markdownPath,
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
      metafilePath: null,
      markdownPath: null,
      error: String(err).slice(0, 500),
      generatedAt,
    };
  }
}


