/** Shared harness metric types — monitor, perf gate, and HTML reporter. */

export interface Metric {
  symbol: string;
  operation: string;
  actualMs: number;
  thresholdMs: number;
  pass: boolean;
  /** Registry key (e.g. crypto.sha256) for train output. */
  registryKey?: string;
  /** Runtime unavailable — does not fail the gate. */
  skipped?: boolean;
  skipReason?: string;
}

export interface ReportMeta {
  generatedAt?: string;
  gitHead?: string;
  regressionCount?: number;
  snapshotCount?: number;
}

export function generatePerfHTML(
  metrics: Metric[],
  title = "Performance Report",
  meta?: ReportMeta
): string {
  const rows = metrics
    .map((m) => {
      const status = m.skipped ? "↷" : m.pass ? "✓" : "✗";
      const actual = m.skipped ? "—" : m.actualMs.toFixed(3);
      const note = m.skipReason ? ` title="${m.skipReason}"` : "";
      return `<tr${note}><td><code>${m.registryKey ?? m.operation}</code></td><td>${m.symbol}</td><td>${actual}</td><td>${m.thresholdMs}</td><td>${status}</td></tr>`;
    })
    .join("\n");

  const passCount = metrics.filter((m) => m.pass && !m.skipped).length;
  const skippedCount = metrics.filter((m) => m.skipped).length;
  const measuredCount = metrics.length - skippedCount;

  const metaLines: string[] = [];
  if (meta?.generatedAt) metaLines.push(`<li>Generated: ${meta.generatedAt}</li>`);
  if (meta?.gitHead) metaLines.push(`<li>Git HEAD: <code>${meta.gitHead.slice(0, 7)}</code></li>`);
  if (meta?.snapshotCount !== undefined) {
    metaLines.push(`<li>History snapshots: ${meta.snapshotCount}</li>`);
  }
  if (meta?.regressionCount !== undefined) {
    metaLines.push(`<li>Regressions: ${meta.regressionCount}</li>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0d1117; color: #e6edf3; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #30363d; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #161b22; }
    .summary { margin-bottom: 1rem; color: #8b949e; }
    .meta { margin-bottom: 1rem; color: #8b949e; font-size: 0.9rem; }
    .meta li { display: inline; margin-right: 1rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="summary">${passCount}/${measuredCount} within threshold${skippedCount ? ` · ${skippedCount} skipped` : ""}</p>
  ${metaLines.length > 0 ? `<ul class="meta">${metaLines.join("")}</ul>` : ""}
  <table>
    <thead><tr><th>Module</th><th>Symbol</th><th>Actual (ms)</th><th>Threshold (ms)</th><th>Pass</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}
