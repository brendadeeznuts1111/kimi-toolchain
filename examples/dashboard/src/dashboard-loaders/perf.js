/** Perf lane card loaders — lazy-loaded via dashboard-core.js dynamic import(). */
import { fetchJson, card } from "/dashboard-core.js";

// Perf Harness
(async () => {
  try {
    const d = await fetchJson("/api/perf-harness");
    let h = `<div class="row"><span>Summary</span><span class="badge badge-${d.allPass ? "ok" : "err"}">${d.summary}</span></div>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Module</th><th>Actual</th><th>Threshold</th><th>Pass</th></tr>`;
    d.metrics.forEach((m, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${m.name}</code></td><td style="font-size:10px">${m.actualMs.toFixed(3)}ms</td><td style="font-size:10px">≤${m.thresholdMs}ms</td><td><span class="badge badge-${m.pass ? "ok" : "err"}">${m.pass ? "✓" : "✗"}</span></td></tr>`;
    });
    h += `</table>`;
    card("card-perf-harness", h);
  } catch (e) {
    card("card-perf-harness", `<p class="status err">${e.message}</p>`);
  }
})();

// Perf Registry
(async () => {
  try {
    const d = await fetchJson("/api/perf-registry");
    let h = `<div class="row"><span>Registry</span><strong>${d.registrySize} modules</strong></div>`;
    h += `<div class="row"><span>Status</span><span class="badge badge-${d.allPass ? "ok" : "err"}">${d.allPass ? "ALL PASS" : "FAIL"}</span></div>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Module</th><th>Symbol</th><th>Time</th><th>≤Thr</th></tr>`;
    d.metrics.forEach((m, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${m.name}</code></td><td style="font-size:9px">${m.symbol}</td><td style="font-size:10px">${m.actualMs.toFixed(3)}ms</td><td><span class="badge badge-${m.pass ? "ok" : "err"}">${m.pass ? "✓" : "✗"}</span></td></tr>`;
    });
    h += `</table>`;
    card("card-perf-registry", h);
  } catch (e) {
    card("card-perf-registry", `<p class="status err">${e.message}</p>`);
  }
})();

// Effect Benchmarks (toolchain closed-loop harness)
const EFFECT_BENCHMARK_FAMILY_ORDER = ["crypto", "httpClient", "util", "image", "clock", "uuid"];

function effectBenchmarkSourceBadge(source) {
  const tones = {
    baseline: "ok",
    local: "info",
    legacy: "warn",
    default: "warn",
  };
  const tone = tones[source] ?? "warn";
  return `<span class="badge badge-${tone}" style="font-size:9px" title="Threshold layer">${source}</span>`;
}

function effectBenchmarkSparkline(values) {
  if (!values?.length) {
    return '<span style="color:var(--muted);font-size:9px">—</span>';
  }
  const w = 48;
  const h = 14;
  const pad = 1;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.001;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1];
  const first = values[0];
  const color =
    last > first * 1.05 ? "var(--yellow)" : last < first ? "var(--green)" : "var(--blue)";
  return `<span class="benchmark-sparkline" title="${values.map((v) => v.toFixed(3) + "ms").join(" → ")}"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points}"/></svg></span>`;
}

function effectBenchmarkRegressionBadge(row) {
  if (!row.regression?.regressed) return "";
  const r = row.regression;
  return `<span class="badge badge-warn" style="font-size:9px;margin-left:4px" title="vs ${r.previousMs.toFixed(3)}ms">+${r.deltaMs.toFixed(3)}ms</span>`;
}

let effectBenchmarkLastGood = null;

function effectBenchmarkLastSuccessLabel(d) {
  const at = d.lastSuccessfulAt || d.generatedAt;
  if (!at) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
  const label = mins < 1 ? "just now" : `${mins} min ago`;
  return `<div class="row"><span>Last successful</span><span style="font-size:10px;color:var(--muted)">${label}</span></div>`;
}

function renderEffectBenchmarkCard(d) {
  const runAt = d.generatedAt ? new Date(d.generatedAt).toLocaleString() : "—";
  let h = "";
  if (d._loading) {
    h += `<p class="status warn" style="margin-bottom:8px">${d._loading}</p>`;
  }
  if (d.requestError) {
    h += `<div class="status err" style="margin-bottom:8px;padding:8px;border:1px solid var(--red);border-radius:6px">${d.requestError}${d.retryAfterMs ? ` <span style="color:var(--muted)">(${Math.ceil(d.retryAfterMs / 1000)}s)</span>` : ""}</div>`;
    h += effectBenchmarkLastSuccessLabel(d);
  } else if (d.timedOut || d.partialSuccess || d.errors?.length) {
    const bits = [];
    if (d.timedOut) bits.push("run timed out");
    if (d.partialSuccess) bits.push("partial results");
    if (d.errors?.length) bits.push(`${d.errors.length} handler error(s)`);
    h += `<div class="status warn" style="margin-bottom:8px;padding:8px;border:1px solid var(--yellow);border-radius:6px">${bits.join(" · ")}</div>`;
  }
  if (d.errors?.length && !d.requestError) {
    h += `<p class="status warn" style="margin-top:0;font-size:10px">${d.errors
      .slice(0, 3)
      .map((e) => `${e.registryKey}: ${e.message}`)
      .join("<br>")}</p>`;
  }
  h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">`;
  h += `<button type="button" class="showcase-btn" id="effect-benchmark-refresh">Refresh</button>`;
  h += `<button type="button" class="showcase-btn muted" id="effect-benchmark-train">Train</button>`;
  h += `<button type="button" class="showcase-btn muted" id="effect-benchmark-retry">Retry</button>`;
  h += `</div>`;
  if (!d.registrySize) {
    h += `<p class="status warn">No benchmark data yet — try Refresh.</p>`;
    return h;
  }
  h += `<div class="row"><span>Handlers</span><strong>${d.registrySize}</strong> <span style="font-size:10px;color:var(--muted)">(${d.measured} measured · ${d.skipped} skipped)</span></div>`;
  const statusTone = d.partialSuccess || d.timedOut ? "warn" : d.allPass ? "ok" : "err";
  const statusLabel = d.partialSuccess
    ? "PARTIAL"
    : d.timedOut
      ? "TIMEOUT"
      : d.allPass
        ? "ALL PASS"
        : "FAIL";
  h += `<div class="row"><span>Status</span><span class="badge badge-${statusTone}">${statusLabel}</span></div>`;
  h += `<div class="row"><span>Last run</span><span style="font-size:10px">${runAt}</span></div>`;
  if (d.snapshot) {
    const regKeys =
      d.snapshot.regressionKeys?.length > 0
        ? ` (${d.snapshot.regressionKeys.slice(0, 3).join(", ")}${d.snapshot.regressionKeys.length > 3 ? "…" : ""})`
        : "";
    h += `<div class="row"><span>Snapshots</span><span style="font-size:10px">${d.snapshot.count} stored${d.snapshot.regressions ? ` · <span class="status warn">${d.snapshot.regressions} regression(s)${regKeys}</span>` : ""}</span></div>`;
  }
  if (d.train) {
    const trainTone = d.train.written ? "ok" : "err";
    const trainLabel = d.train.written
      ? `trained → ${(d.train.paths || [d.train.path]).join(", ")}`
      : "train skipped (gate must pass)";
    h += `<div class="row"><span>Train</span><span class="badge badge-${trainTone}" style="font-size:10px">${trainLabel}</span></div>`;
  }
  if (d.failures?.length) {
    h += `<p class="status err" style="margin-top:4px">${d.failures.slice(0, 2).join("<br>")}</p>`;
  }
  const families = d.families || {};
  const familyKeys = EFFECT_BENCHMARK_FAMILY_ORDER.filter((k) => families[k]);
  for (const key of Object.keys(families)) {
    if (!familyKeys.includes(key)) familyKeys.push(key);
  }
  for (const family of familyKeys) {
    const rows = families[family] || [];
    if (!rows.length) continue;
    h += `<h3 style="font-size:12px;color:var(--muted);margin:10px 0 4px">${family}</h3>`;
    h += `<table class="tbl"><tr><th>#</th><th>Handler</th><th>Time</th><th>Trend</th><th>Thr</th><th>Src</th><th></th></tr>`;
    rows.forEach((m, i) => {
      const time = m.skipped
        ? "—"
        : `${m.actualMs.toFixed(3)}ms${effectBenchmarkRegressionBadge(m)}`;
      const thr = m.skipped ? "—" : `${m.thresholdMs}ms`;
      const status = m.skipped
        ? `<span class="badge badge-warn" title="${m.skipReason || "skipped"}">↷</span>`
        : `<span class="badge badge-${m.pass ? "ok" : "err"}">${m.pass ? "✓" : "✗"}</span>`;
      const rowClass = m.regression?.regressed ? ' class="benchmark-regressed"' : "";
      h += `<tr${rowClass}><td class="num">${i + 1}.</td><td><code style="font-size:9px">${m.name}</code></td><td style="font-size:10px">${time}</td><td>${effectBenchmarkSparkline(m.sparkline)}</td><td style="font-size:10px">${thr}</td><td>${effectBenchmarkSourceBadge(m.thresholdSource)}</td><td>${status}</td></tr>`;
    });
    h += `</table>`;
  }
  if (d.recentRuns?.length) {
    h += `<details class="benchmark-recent-runs"><summary>Recent runs (${d.recentRuns.length})</summary>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>When</th><th>Measured</th><th>Passed</th><th>Status</th></tr>`;
    d.recentRuns.forEach((run) => {
      const when = new Date(run.generatedAt).toLocaleString();
      h += `<tr><td style="font-size:10px">${when}</td><td class="num">${run.measured}</td><td class="num">${run.passed}</td><td><span class="badge badge-${run.allPass ? "ok" : "err"}">${run.allPass ? "PASS" : "FAIL"}</span></td></tr>`;
    });
    h += `</table></details>`;
  }
  h += `<p class="status ok" style="margin-top:8px;font-size:10px">Layers: ${(d.thresholdLayers || []).join(" → ")}</p>`;
  return h;
}

function wireEffectBenchmarkButtons(retryUrl = "/api/effect-benchmark/refresh") {
  document.getElementById("effect-benchmark-refresh")?.addEventListener("click", () => {
    loadEffectBenchmarkCard("/api/effect-benchmark/refresh", { loading: "Refreshing…" });
  });
  document.getElementById("effect-benchmark-train")?.addEventListener("click", () => {
    loadEffectBenchmarkCard("/api/effect-benchmark/train", { loading: "Training…" });
  });
  document.getElementById("effect-benchmark-retry")?.addEventListener("click", () => {
    loadEffectBenchmarkCard(retryUrl, { loading: "Retrying…" });
  });
}

async function loadEffectBenchmarkCard(url = "/api/effect-benchmark", options = {}) {
  const cardId = "card-effect-benchmark";
  const loadingMsg = options.loading ?? "Loading…";
  if (effectBenchmarkLastGood) {
    card(
      cardId,
      renderEffectBenchmarkCard({
        ...effectBenchmarkLastGood,
        _loading: loadingMsg,
      })
    );
  } else {
    card(cardId, `<div class="loading">${loadingMsg}</div>`);
  }

  try {
    const fetchOpts =
      url === "/api/effect-benchmark"
        ? undefined
        : { method: "POST", headers: { "content-type": "application/json" } };
    const res = await fetch(url, fetchOpts);
    const d = await res.json();

    if (!res.ok && d.requestError && effectBenchmarkLastGood) {
      card(
        cardId,
        renderEffectBenchmarkCard({
          ...effectBenchmarkLastGood,
          requestError: d.requestError,
          retryAfterMs: d.retryAfterMs,
          lastSuccessfulAt: d.lastSuccessfulAt ?? effectBenchmarkLastGood.generatedAt,
        })
      );
      wireEffectBenchmarkButtons(url);
      return;
    }

    if (!res.ok) {
      throw new Error(d.requestError || `${url} → ${res.status}`);
    }

    if (d.ok !== false && d.registrySize > 0) {
      effectBenchmarkLastGood = d;
    } else if (d.ok === false && effectBenchmarkLastGood) {
      card(
        cardId,
        renderEffectBenchmarkCard({
          ...effectBenchmarkLastGood,
          requestError: d.requestError,
          lastSuccessfulAt: d.lastSuccessfulAt ?? effectBenchmarkLastGood.generatedAt,
        })
      );
      wireEffectBenchmarkButtons(url);
      return;
    }

    card(cardId, renderEffectBenchmarkCard(d));
    wireEffectBenchmarkButtons(url);
  } catch (e) {
    if (effectBenchmarkLastGood) {
      card(
        cardId,
        renderEffectBenchmarkCard({
          ...effectBenchmarkLastGood,
          requestError: e.message,
          lastSuccessfulAt: effectBenchmarkLastGood.generatedAt,
        })
      );
      wireEffectBenchmarkButtons(url);
    } else {
      card(cardId, `<p class="status err">${e.message}</p>`);
    }
  }
}

loadEffectBenchmarkCard();
// Perf Auto-Discover
(async () => {
  try {
    const d = await fetchJson("/api/perf-auto-discover");
    let h = `<div class="row"><span>Exports</span><strong>${d.totalExports}</strong> <span style="font-size:10px;color:var(--muted)">across ${d.discovered.length} files</span></div>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>File</th><th>Export</th><th>Time</th></tr>`;
    d.discovered.forEach((f) => {
      f.exports.forEach((exp) => {
        const m = d.metrics.find((m) => m.operation === exp);
        h += `<tr><td class="num">—</td><td style="font-size:9px">${f.file}</td><td><code style="font-size:9px">${exp}</code></td><td style="font-size:10px">${m?.actualMs > 0 ? m.actualMs.toFixed(3) + "ms" : "—"}</td></tr>`;
      });
    });
    h += `</table>`;
    card("card-perf-auto-discover", h);
  } catch (e) {
    card("card-perf-auto-discover", `<p class="status err">${e.message}</p>`);
  }
})();

// Threshold Overrides
(async () => {
  try {
    const d = await fetchJson("/api/threshold-overrides");
    let h = `<div class="row"><span>Sources</span><span>${d.sources.bunfig} + ${d.sources.defaults} defaults</span></div>`;
    h += `<div class="row"><span>Precedence</span><span class="badge badge-info" style="font-size:9px">4 layers</span></div>`;
    if (Array.isArray(d.precedence)) {
      d.precedence.forEach((p) => {
        h += `<div class="row"><span style="font-size:9px">L${p.layer}: ${p.source}</span><code style="font-size:8px">${p.method}</code></div>`;
      });
    }
    if (d.tomlFormats) {
      h += `<p style="font-size:10px;color:var(--muted);margin-top:2px">Formats: ${d.tomlFormats.join(" · ")}</p>`;
    }
    if (Object.keys(d.bunfigOverrides).length > 0) {
      h += `<p style="font-size:11px;color:var(--blue);margin:4px 0 2px">bunfig.toml [doctor.thresholds]</p>`;
      h += `<table class="tbl"><tr><th>Key</th><th>Value</th></tr>`;
      Object.entries(d.bunfigOverrides).forEach(([k, v]) => {
        h += `<tr><td><code style="font-size:9px">${k}</code></td><td style="font-size:10px">${v}ms</td></tr>`;
      });
      h += `</table>`;
    } else {
      h += `<p class="status warn" style="font-size:10px;margin-top:4px">No [doctor.thresholds] in bunfig.toml</p>`;
    }
    h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Example config</summary>`;
    h += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px">${d.exampleConfig}</pre>`;
    h += `</details>`;
    card("card-threshold-overrides", h);
  } catch (e) {
    card("card-threshold-overrides", `<p class="status err">${e.message}</p>`);
  }
})();
// Perf Threaded
(async () => {
  try {
    const d = await fetchJson("/api/perf-threaded");
    let h = `<div class="row"><span>Total</span><strong>${d.totalMs.toFixed(1)}ms</strong> <span style="font-size:10px;color:var(--muted)">(${d.concurrent} workers, ${d.speedup})</span></div>`;
    h += `<div class="row"><span>Status</span><span class="badge badge-${d.allPass ? "ok" : "err"}">${d.allPass ? "ALL PASS" : "FAIL"}</span></div>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Module</th><th>Time</th><th>≤5ms</th></tr>`;
    d.metrics.forEach((m, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${m.name}</code></td><td style="font-size:10px">${m.actualMs.toFixed(3)}ms</td><td><span class="badge badge-${m.pass ? "ok" : "err"}">${m.pass ? "✓" : "✗"}</span></td></tr>`;
    });
    h += `</table>`;
    card("card-perf-threaded", h);
  } catch (e) {
    card("card-perf-threaded", `<p class="status err">${e.message}</p>`);
  }
})();
