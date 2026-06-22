/**
 * cli-format.ts — Shared CLI output formatting utilities.
 *
 * Provides severity color mapping, status coloring, and Bun.inspect.custom
 * formatters for scanner and secrets CLI output.
 *
 * All color output uses Bun.color() with ANSI format. Colors are suppressed
 * when stdout is not a TTY (pipe/redirect) to avoid escape codes in logs.
 */

import type {
  Severity,
  VulnerabilityFinding,
  ScannerPipelineResult,
  PatchResult,
} from "./scanner-pipeline.ts";

// ── ANSI Width Helpers ───────────────────────────────────────────────

/** Visible width of a string, ignoring ANSI escape codes. */
export function visibleWidth(str: string): number {
  return Bun.stringWidth(Bun.stripANSI(str));
}

/** Pad a string to a visible width, accounting for ANSI codes. */
export function padVisible(str: string, width: number, align: "left" | "right" = "left"): string {
  const w = visibleWidth(str);
  if (w >= width) return str;
  const pad = " ".repeat(width - w);
  return align === "right" ? `${pad}${str}` : `${str}${pad}`;
}

// ── Color Constants ──────────────────────────────────────────────────

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "#ff0000",
  high: "#ff6600",
  medium: "#ffcc00",
  low: "#0066ff",
  unknown: "#888888",
};

const STATUS_COLORS: Record<string, string> = {
  ok: "#00ff00",
  present: "#00ff00",
  missing: "#ff0000",
  stale: "#ffcc00",
  unregistered: "#ff6600",
};

const COLOR_ERROR = "#ff0000";
const COLOR_WARN = "#ffcc00";
const COLOR_SUCCESS = "#00ff00";
const COLOR_INFO = "#00aaff";
const COLOR_DIM = "#888888";

// ── TTY Detection ────────────────────────────────────────────────────

function useColor(): boolean {
  return process.stdout.isTTY === true;
}

function paint(text: string, hex: string): string {
  if (!useColor()) return text;
  return `${Bun.color(hex, "ansi")}${text}\x1b[0m`;
}

// ── Severity Formatting ──────────────────────────────────────────────

export function severityColor(severity: Severity): string {
  return SEVERITY_COLORS[severity];
}

export function severityLabel(severity: Severity): string {
  return paint(severity.toUpperCase(), SEVERITY_COLORS[severity]);
}

export function severityIcon(severity: Severity): string {
  const icons: Record<Severity, string> = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🔵",
    unknown: "⚪",
  };
  return icons[severity];
}

// ── Status Formatting ────────────────────────────────────────────────

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? COLOR_DIM;
}

export function statusLabel(status: string): string {
  return paint(status, statusColor(status));
}

export function statusIcon(status: string): string {
  if (status === "ok" || status === "present") return paint("✓", COLOR_SUCCESS);
  if (status === "missing") return paint("✗", COLOR_ERROR);
  if (status === "stale") return paint("⚠", COLOR_WARN);
  if (status === "unregistered") return paint("⚠", COLOR_WARN);
  return "◦";
}

// ── General Color Helpers ────────────────────────────────────────────

export function colorError(text: string): string {
  return paint(text, COLOR_ERROR);
}

export function colorWarn(text: string): string {
  return paint(text, COLOR_WARN);
}

export function colorSuccess(text: string): string {
  return paint(text, COLOR_SUCCESS);
}

export function colorInfo(text: string): string {
  return paint(text, COLOR_INFO);
}

export function colorDim(text: string): string {
  return paint(text, COLOR_DIM);
}

// ── Scanner Type Formatters ──────────────────────────────────────────

export function formatFinding(f: VulnerabilityFinding): string {
  const sev = severityLabel(f.severity);
  const pkg = paint(f.name, COLOR_INFO);
  const ver = colorDim(`${f.currentVersion} → ${f.fixedVersion ?? "no fix"}`);
  const strat = paint(
    f.strategy,
    f.strategy === "upgrade" ? COLOR_SUCCESS : f.strategy === "patch" ? COLOR_WARN : COLOR_ERROR
  );
  return `  ${severityIcon(f.severity)} ${sev} ${pkg} ${colorDim(f.cveId)} ${ver} [${strat}]`;
}

export function formatPatchResult(p: PatchResult): string {
  const icon = p.success ? paint("✓", COLOR_SUCCESS) : paint("✗", COLOR_ERROR);
  const pkg = paint(p.name, COLOR_INFO);
  const strat = colorDim(p.strategy);
  const msg = p.success ? colorSuccess(p.message) : colorError(p.message);
  return `  ${icon} ${pkg} ${strat} — ${msg}`;
}

export function formatScannerSummary(r: ScannerPipelineResult): string {
  const vuln =
    r.vulnerabilities > 0
      ? colorError(`${r.vulnerabilities} vulnerabilities`)
      : colorSuccess("no vulnerabilities");
  const patched = r.patched > 0 ? colorSuccess(`${r.patched} patched`) : "";
  const failed = r.failed > 0 ? colorError(`${r.failed} failed`) : "";
  const manual = r.manual > 0 ? colorWarn(`${r.manual} manual`) : "";
  const parts = [vuln, patched, failed, manual].filter(Boolean);
  return `Scanned ${r.scanned} deps — ${parts.join(", ")}`;
}

// ── Table Helpers ────────────────────────────────────────────────────

export function findingsTable(findings: VulnerabilityFinding[]): string {
  if (findings.length === 0) return colorSuccess("No vulnerabilities found");
  const rows = findings.map((f) => ({
    Severity: severityLabel(f.severity),
    Package: f.name,
    CVE: f.cveId,
    Current: f.currentVersion,
    Fixed: f.fixedVersion ?? "—",
    Strategy: f.strategy,
  }));
  return formatTable(rows);
}

export function secretsTable(
  items: Array<{ key: string; status: string; extra?: string }>
): string {
  const rows = items.map((r) => ({
    Secret: r.key,
    Status: statusLabel(r.status),
    Details: r.extra ?? "",
  }));
  return formatTable(rows);
}

/** Format an array of objects as an aligned table, respecting ANSI-colored cell widths. */
export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const colWidths = keys.map((k) => {
    const values = rows.map((r) => String(r[k] ?? ""));
    return Math.max(visibleWidth(k), ...values.map(visibleWidth));
  });
  const pad = 2;
  const header = keys.map((k, i) => padVisible(k, colWidths[i])).join(" ".repeat(pad));
  const separator = colWidths.map((w) => "─".repeat(w)).join(" ".repeat(pad));
  const body = rows
    .map((r) =>
      keys.map((k, i) => padVisible(String(r[k] ?? ""), colWidths[i])).join(" ".repeat(pad))
    )
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}

// ── Bun.inspect.table Helper ─────────────────────────────────────────

export interface InspectTableOptions {
  columns?: string[];
  colors?: boolean;
}

/**
 * Wrapper around Bun.inspect.table with TTY-aware colors.
 * Uses the official API: properties (column selection) as 2nd arg, options as 3rd.
 */
export function inspectTable(data: Record<string, unknown>[], options: InspectTableOptions = {}): string {
  if (data.length === 0) return "";
  const colors = options.colors ?? useColor();
  return Bun.inspect.table(data, options.columns, { colors });
}

// ── Bun.inspect.custom Attachers ─────────────────────────────────────

const INSPECT_SYMBOL = Symbol.for("nodejs.util.inspect.custom");

export function withFindingInspect<T extends VulnerabilityFinding>(f: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(f) || null), f, {
    [INSPECT_SYMBOL](depth: number, opts: { colors?: boolean }): string {
      return formatFinding(f);
    },
  });
}

export function withPatchInspect<T extends PatchResult>(p: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(p) || null), p, {
    [INSPECT_SYMBOL](depth: number, opts: { colors?: boolean }): string {
      return formatPatchResult(p);
    },
  });
}

export function withScannerResultInspect<T extends ScannerPipelineResult>(r: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(r) || null), r, {
    [INSPECT_SYMBOL](depth: number, opts: { colors?: boolean }): string {
      const lines = [formatScannerSummary(r)];
      if (r.findings.length > 0) {
        lines.push(colorDim("Findings:"));
        for (const f of r.findings) lines.push(formatFinding(f));
      }
      if (r.patches.length > 0) {
        lines.push(colorDim("Patches:"));
        for (const p of r.patches) lines.push(formatPatchResult(p));
      }
      return lines.join("\n");
    },
  });
}
