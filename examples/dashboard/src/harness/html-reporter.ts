import type { Metric } from "./types.ts";

export function generatePerfHTML(metrics: Metric[], title = "Performance Report"): string {
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
  <p class="summary">${passCount}/${metrics.length - skippedCount} within threshold${skippedCount ? ` · ${skippedCount} skipped` : ""}</p>
  <table>
    <thead><tr><th>Module</th><th>Symbol</th><th>Actual (ms)</th><th>Threshold (ms)</th><th>Pass</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}
