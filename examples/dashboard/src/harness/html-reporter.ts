import type { Metric } from "./types.ts";

const esc = (v: unknown) => Bun.escapeHTML(String(v));

function fmtMs(ms: number): string {
  return ms.toFixed(3);
}

function computeStats(metrics: Metric[]) {
  const measured = metrics.filter((m) => !m.skipped);
  const skipped = metrics.filter((m) => m.skipped);
  const passCount = measured.filter((m) => m.pass).length;
  const failCount = measured.filter((m) => !m.pass).length;

  const avg =
    measured.length > 0 ? measured.reduce((s, m) => s + m.actualMs, 0) / measured.length : 0;

  let fastest: { name: string; ms: number } | null = null;
  let slowest: { name: string; ms: number } | null = null;
  for (const m of measured) {
    if (!fastest || m.actualMs < fastest.ms) {
      fastest = { name: m.registryKey ?? m.operation, ms: m.actualMs };
    }
    if (!slowest || m.actualMs > slowest.ms) {
      slowest = { name: m.registryKey ?? m.operation, ms: m.actualMs };
    }
  }

  return { measured, skipped, passCount, failCount, avg, fastest, slowest };
}

export function generatePerfHtml(metrics: Metric[], title = "Performance Report"): string {
  const stats = computeStats(metrics);
  const total = metrics.length;
  const passRate =
    stats.measured.length > 0
      ? `${((stats.passCount / stats.measured.length) * 100).toFixed(0)}%`
      : "—";

  // ── Table rows ──
  const rows = metrics
    .map((m) => {
      if (m.skipped) {
        return `<tr class="row--skipped" title="${esc(m.skipReason ?? "skipped")}"><td><code>${esc(m.registryKey ?? m.operation)}</code></td><td>${esc(m.symbol)}</td><td>—</td><td>${m.thresholdMs}</td><td class="cell--skip">↷</td></tr>`;
      }
      const ratio = Math.min(m.actualMs / m.thresholdMs, 1);
      const barCls = ratio < 0.5 ? "bar--safe" : ratio < 0.85 ? "bar--warn" : "bar--danger";
      const statusCls = m.pass ? "cell--pass" : "cell--fail";
      const status = m.pass ? "✓" : "✗";
      return `<tr>
        <td><code>${esc(m.registryKey ?? m.operation)}</code></td>
        <td style="color:var(--color-text-secondary);font-size:0.82rem">${esc(m.symbol)}</td>
        <td class="cell--bar"><span class="bar-fill ${barCls}" style="width:${(ratio * 100).toFixed(1)}%"></span><span class="bar-label">${fmtMs(m.actualMs)}</span></td>
        <td>${m.thresholdMs}</td>
        <td class="${statusCls}">${status}</td>
      </tr>`;
    })
    .join("\n");

  // ── Skipped section (only when present) ──
  const skippedBlock =
    stats.skipped.length > 0
      ? `
    <div class="section">
      <h2 class="section__title">Skipped</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Module</th><th>Symbol</th><th>Reason</th></tr></thead>
          <tbody>
            ${stats.skipped
              .map(
                (m) =>
                  `<tr class="row--skipped"><td><code>${esc(m.registryKey ?? m.operation)}</code></td><td>${esc(m.symbol)}</td><td style="color:var(--color-text-muted)">${esc(m.skipReason ?? "—")}</td></tr>`
              )
              .join("\n")}
          </tbody>
        </table>
      </div>
    </div>`
      : "";

  // ── Timestamp ──
  const now = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    /* ═══════════════════════════════════════════════════
       Design tokens — mirroring Bun.color macro build output
       ═══════════════════════════════════════════════════ */
    :root {
      --color-primary: #58a6ff;
      --color-primary-muted: #1f426b;
      --color-success: #3fb950;
      --color-success-muted: #173f1f;
      --color-danger: #f85149;
      --color-danger-muted: #490f0f;
      --color-warning: #d29922;
      --color-warning-muted: #3d2e00;

      --color-bg-default: #0d1117;
      --color-bg-subtle: #161b22;
      --color-bg-inset: #010409;
      --color-bg-card: #1c2129;
      --color-bg-overlay: #21262d;

      --color-border-default: #30363d;
      --color-border-muted: #21262d;
      --color-border-emphasis: #484f58;

      --color-text-primary: #e6edf3;
      --color-text-secondary: #8b949e;
      --color-text-muted: #6e7681;

      --radius-sm: 6px;
      --radius-md: 8px;
      --shadow-card: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.4);
      --transition-fast: 150ms ease;
    }

    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--color-bg-default);
      color: var(--color-text-primary);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .app-shell {
      max-width: 1100px;
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem;
    }

    /* ── Header ── */
    .app-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--color-border-default);
    }
    .app-header h1 {
      margin: 0;
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badge-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.65rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
      border: 1px solid;
    }
    .badge--pass { background: var(--color-success-muted); color: var(--color-success); border-color: var(--color-success); }
    .badge--fail { background: var(--color-danger-muted);  color: var(--color-danger);  border-color: var(--color-danger); }
    .badge--info { background: var(--color-primary-muted); color: var(--color-primary); border-color: var(--color-primary); }

    /* ── Summary cards ── */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .summary-card {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      padding: 1rem 1.25rem;
      box-shadow: var(--shadow-card);
    }
    .summary-card__label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-secondary);
      margin-bottom: 0.35rem;
    }
    .summary-card__value {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .summary-card__sub {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      margin-top: 0.2rem;
    }
    .value--success { color: var(--color-success); }
    .value--primary { color: var(--color-primary); }
    .value--danger  { color: var(--color-danger); }
    .value--neutral { color: var(--color-text-primary); }

    /* ── Section ── */
    .section { margin-bottom: 2rem; }
    .section__title {
      font-size: 1.1rem;
      font-weight: 600;
      margin: 0 0 0.75rem;
    }

    /* ── Table ── */
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-card);
    }
    table { width: 100%; border-collapse: collapse; background: var(--color-bg-card); }
    th, td { padding: 0.6rem 0.9rem; text-align: left; font-size: 0.9rem; white-space: nowrap; }
    th {
      background: var(--color-bg-subtle);
      font-weight: 600;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--color-border-emphasis);
    }
    td { border-bottom: 1px solid var(--color-border-muted); }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--color-bg-overlay); }
    tr.row--skipped td { opacity: 0.6; }

    .cell--pass { color: var(--color-success); font-weight: 700; }
    .cell--fail { color: var(--color-danger);  font-weight: 700; }
    .cell--skip { color: var(--color-warning); font-weight: 700; }

    /* Bar fills */
    .cell--bar { position: relative; }
    .bar-fill {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      border-radius: 0 3px 3px 0;
      opacity: 0.15;
      transition: width var(--transition-fast);
    }
    .bar--safe  { background: var(--color-success); }
    .bar--warn  { background: var(--color-warning); }
    .bar--danger { background: var(--color-danger);  }
    .bar-label { position: relative; z-index: 1; }

    td code {
      font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
      font-size: 0.82rem;
      background: var(--color-bg-inset);
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      color: var(--color-text-primary);
    }

    /* ── Footer ── */
    .app-footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-border-default);
      font-size: 0.78rem;
      color: var(--color-text-muted);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .app-shell { padding: 1rem; }
      .app-header { flex-direction: column; }
      .summary-grid { grid-template-columns: 1fr 1fr; }
      th, td { padding: 0.4rem 0.5rem; font-size: 0.8rem; }
    }
  </style>
</head>
<body>
  <div class="app-shell">

    <!-- ── Header ── -->
    <header class="app-header">
      <div>
        <h1>⚡ ${esc(title)}</h1>
        <p style="margin:0.25rem 0 0;color:var(--color-text-secondary);font-size:0.9rem">
          Kimi Toolchain — Effect Benchmark Suite
        </p>
      </div>
      <div class="badge-row">
        <span class="badge badge--${stats.passCount === stats.measured.length && stats.measured.length > 0 ? "pass" : "fail"}">${stats.passCount}/${stats.measured.length} Passing</span>
        ${stats.skipped.length > 0 ? `<span class="badge badge--info">${stats.skipped.length} Skipped</span>` : ""}
      </div>
    </header>

    <!-- ── Summary Cards ── -->
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">Total Benchmarks</div>
        <div class="summary-card__value value--neutral">${total}</div>
        <div class="summary-card__sub">${stats.measured.length} measured · ${stats.skipped.length} skipped</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Pass Rate</div>
        <div class="summary-card__value value--${stats.passCount === stats.measured.length ? "success" : stats.passCount > 0 ? "primary" : "danger"}">${passRate}</div>
        <div class="summary-card__sub">${stats.passCount}/${stats.measured.length} within threshold</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Avg Latency</div>
        <div class="summary-card__value value--primary">${stats.measured.length > 0 ? fmtMs(stats.avg) + " ms" : "—"}</div>
        <div class="summary-card__sub">Range: ${stats.fastest ? fmtMs(stats.fastest.ms) : "—"} – ${stats.slowest ? fmtMs(stats.slowest.ms) : "—"} ms</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Fastest</div>
        <div class="summary-card__value value--success">${stats.fastest ? fmtMs(stats.fastest.ms) + " ms" : "—"}</div>
        <div class="summary-card__sub">${esc(stats.fastest?.name ?? "—")}</div>
      </div>
    </div>

    <!-- ── Benchmark Table ── -->
    <div class="section">
      <h2 class="section__title">Benchmark Results</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Module</th><th>Symbol</th><th>Actual (ms)</th><th>Threshold (ms)</th><th>Pass</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>
    </div>
    ${skippedBlock}
    <!-- ── Footer ── -->
    <footer class="app-footer">
      <span>Generated by <code>perf-doctor --report</code> · Kimi Toolchain</span>
      <span>${now}</span>
    </footer>

  </div>
</body>
</html>`;
}
