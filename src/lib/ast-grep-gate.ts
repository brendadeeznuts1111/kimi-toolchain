/**
 * ast-grep gate logic — runs `ast-grep scan` and evaluates violations.
 *
 * Used by scripts/ast-grep-scan.ts. Mirrors the bun-native-lint pattern:
 * per-rule file exemptions, severity-based gate failure, JSON+HTML report.
 */

import { $ } from "bun";
import { join, relative } from "path";
import { makeDir } from "./bun-io.ts";

/** Per-rule exempt files — these are the legitimate sources of the patterns. */
export const EXEMPT_FILES: Record<string, string[]> = {
  "no-direct-registry-import": ["src/lib/bun-utils.ts"],
  "no-manual-feature-url": ["src/lib/bun-release-registry.ts"],
  // Intentional boundary shims / runtime patches
  "no-as-any": [
    "src/lib/deferred-watch.ts",
    "src/lib/bun-markdown.ts",
    "src/lib/governor-spawn.ts",
    "src/lib/secrets-policy.ts",
  ],
  "no-double-cast": [
    "src/lib/bun-io.ts",
    "src/lib/http-client.ts",
    "src/lib/inspect.ts",
    "src/lib/bun-utils.ts",
  ],
  "node-fs-in-bun": ["src/lib/bun-io.ts"],
};

/** Bun hygiene profile — mirrors Projects ast-grep `bun` scan profile. */
export const BUN_HYGIENE_RULES = [
  "node-fs-in-bun",
  "prefer-bun-spawn",
  "no-as-any",
  "no-double-cast",
] as const;

export type Severity = "error" | "warning" | "info";

export interface AstGrepHit {
  text: string;
  file: string;
  lines: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  language: string;
  ruleId?: string;
  message?: string;
  severity?: Severity;
}

export interface GateViolation {
  ruleId: string;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: Severity;
  snippet: string;
}

export interface GateReport {
  schemaVersion: 1;
  generatedAt: string;
  tool: string;
  configPath: string;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    exempt: number;
    fail: boolean;
    durationMs: number;
  };
  violations: GateViolation[];
  exempted: GateViolation[];
}

export interface ScanOptions {
  configPath: string;
  projectRoot: string;
  json?: boolean;
  report?: boolean;
  reportDir?: string;
}

export interface ScanResult {
  report: GateReport;
  exitCode: number;
}

/** Run `ast-grep scan -c <config> --json` and capture hits. */
export async function runAstGrepScan(
  configPath: string,
  projectRoot: string
): Promise<{ hits: AstGrepHit[]; durationMs: number }> {
  const start = Bun.nanoseconds();

  try {
    // `.text()` automatically quiets stdout and returns it as a string.
    const stdout = await $`ast-grep scan -c ${configPath} --json --include-metadata`
      .cwd(projectRoot)
      .text();

    // ast-grep exits 0 even when violations are found (scan mode).
    const trimmed = stdout.trim();
    const hits: AstGrepHit[] = trimmed ? (JSON.parse(trimmed) as AstGrepHit[]) : [];
    const durationMs = Math.round((Bun.nanoseconds() - start) / 1_000_000);
    return { hits, durationMs };
  } catch (err: any) {
    // Non-zero exit means a config/parse error.
    const detail = err.stderr?.toString().trim() || err.stdout?.toString().trim() || "";
    throw new Error(`ast-grep scan failed (exit ${err.exitCode ?? "unknown"}): ${detail}`);
  }
}

/** Convert raw ast-grep hits to evaluated violations, applying per-rule exemptions. */
export function evaluateHits(
  hits: AstGrepHit[],
  projectRoot: string
): { violations: GateViolation[]; exempted: GateViolation[] } {
  const violations: GateViolation[] = [];
  const exempted: GateViolation[] = [];

  for (const hit of hits) {
    const ruleId = hit.ruleId ?? "unknown";
    const severity = hit.severity ?? "warning";
    const relFile = relative(projectRoot, hit.file);
    const exemptList = EXEMPT_FILES[ruleId] ?? [];
    const isExempt = exemptList.some((f) => relFile === f || hit.file === f);

    const violation: GateViolation = {
      ruleId,
      file: relFile,
      line: hit.range.start.line + 1,
      column: hit.range.start.column + 1,
      message: hit.message ?? "",
      severity,
      snippet: hit.lines.trim(),
    };

    if (isExempt) {
      exempted.push(violation);
    } else {
      violations.push(violation);
    }
  }

  return { violations, exempted };
}

/** Build a GateReport from scan results. */
export function buildReport(
  violations: GateViolation[],
  exempted: GateViolation[],
  configPath: string,
  durationMs: number
): GateReport {
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tool: "ast-grep",
    configPath,
    summary: {
      total: violations.length,
      errors,
      warnings,
      exempt: exempted.length,
      fail: errors > 0,
      durationMs,
    },
    violations,
    exempted,
  };
}

/** Render gate report as a self-contained HTML document. */
export function renderHtmlReport(report: GateReport): string {
  const status = report.summary.fail ? "FAIL" : "PASS";
  const statusColor = report.summary.fail ? "#dc2626" : "#16a34a";

  const violationRows = report.violations
    .map((v) => {
      const sevColor = v.severity === "error" ? "#dc2626" : "#f59e0b";
      const escaped = v.snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `        <tr>
          <td><span class="sev sev-${v.severity}" style="color:${sevColor}">${v.severity}</span></td>
          <td><code>${v.file}:${v.line}</code></td>
          <td>${v.message}</td>
          <td><code>${v.ruleId}</code></td>
          <td><pre>${escaped}</pre></td>
        </tr>`;
    })
    .join("\n");

  const exemptRows = report.exempted
    .map((v) => {
      const escaped = v.snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `        <tr class="exempt">
          <td><span class="sev sev-exempt">exempt</span></td>
          <td><code>${v.file}:${v.line}</code></td>
          <td>${v.message}</td>
          <td><code>${v.ruleId}</code></td>
          <td><pre>${escaped}</pre></td>
        </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ast-grep Gate Report — ${status}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #1e293b; }
    h1 { font-size: 1.5rem; }
    .status { font-size: 1.25rem; font-weight: 700; padding: 0.25rem 0.75rem; border-radius: 0.375rem; color: ${statusColor}; }
    .summary { display: flex; gap: 2rem; margin: 1rem 0; flex-wrap: wrap; }
    .summary div { background: #f1f5f9; padding: 0.75rem 1.25rem; border-radius: 0.5rem; }
    .summary strong { font-size: 1.5rem; display: block; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    th { background: #f8fafc; font-size: 0.875rem; }
    .sev { font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
    .sev-exempt { color: #64748b; }
    tr.exempt { opacity: 0.5; }
    pre { margin: 0; font-size: 0.8125rem; white-space: pre-wrap; word-break: break-all; }
    code { font-size: 0.8125rem; color: #475569; }
    .meta { color: #64748b; font-size: 0.8125rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <h1>ast-grep Gate Report</h1>
  <p><span class="status">${status}</span></p>
  <div class="summary">
    <div><strong>${report.summary.total}</strong>violations</div>
    <div><strong>${report.summary.errors}</strong>errors</div>
    <div><strong>${report.summary.warnings}</strong>warnings</div>
    <div><strong>${report.summary.exempt}</strong>exempt</div>
    <div><strong>${report.summary.durationMs}ms</strong>duration</div>
  </div>
  <p class="meta">Generated ${report.generatedAt} · config: <code>${report.configPath}</code></p>
  <table>
    <thead>
      <tr><th>Severity</th><th>Location</th><th>Message</th><th>Rule</th><th>Snippet</th></tr>
    </thead>
    <tbody>
${violationRows}
${exemptRows}
    </tbody>
  </table>
</body>
</html>`;
}

/** Write gate report JSON and HTML to the reports directory. */
export async function writeReportFiles(
  report: GateReport,
  reportDir: string
): Promise<{ jsonPath: string; htmlPath: string }> {
  makeDir(reportDir, { recursive: true });
  const jsonPath = join(reportDir, "gate-report.json");
  const htmlPath = join(reportDir, "gate-report.html");
  await Bun.write(jsonPath, JSON.stringify(report, null, 2) + "\n");
  await Bun.write(htmlPath, renderHtmlReport(report));
  return { jsonPath, htmlPath };
}

/** Full scan + evaluate + report pipeline. Returns exit code (0 = pass, 1 = fail). */
export async function runAstGrepGate(options: ScanOptions): Promise<ScanResult> {
  const { hits, durationMs } = await runAstGrepScan(options.configPath, options.projectRoot);
  const { violations, exempted } = evaluateHits(hits, options.projectRoot);
  const report = buildReport(violations, exempted, options.configPath, durationMs);

  if (options.report ?? true) {
    const reportDir = options.reportDir ?? join(options.projectRoot, "reports");
    await writeReportFiles(report, reportDir);
  }

  return { report, exitCode: report.summary.fail ? 1 : 0 };
}

/** Format violations for stderr output (human-readable). */
export function formatViolations(violations: GateViolation[]): string {
  if (violations.length === 0) return "";
  const lines: string[] = [];
  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} [${v.ruleId}] (${v.severity}) ${v.message}`);
    lines.push(`    ${v.snippet}`);
    lines.push("");
  }
  return lines.join("\n");
}
