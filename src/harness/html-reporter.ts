/** Shared harness metric types — monitor, perf gate, and HTML reporter. */

export interface Metric {
  symbol: string;
  operation: string;
  actualMs: number;
  thresholdMs: number;
  pass: boolean;
  /** Registry key (e.g. crypto.sha256) for train output. */
  registryKey?: string;
}

export function generatePerfHTML(metrics: Metric[], title = "Performance Report"): string {
  const rows = metrics
    .map(
      (m) =>
        `<tr><td><code>${m.registryKey ?? m.operation}</code></td><td>${m.symbol}</td><td>${m.actualMs.toFixed(3)}</td><td>${m.thresholdMs}</td><td>${m.pass ? "✓" : "✗"}</td></tr>`
    )
    .join("\n");

  const passCount = metrics.filter((m) => m.pass).length;

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
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="summary">${passCount}/${metrics.length} within threshold</p>
  <table>
    <thead><tr><th>Module</th><th>Symbol</th><th>Actual (ms)</th><th>Threshold (ms)</th><th>Pass</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}
