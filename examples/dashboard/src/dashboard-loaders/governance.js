/** Governance lane — gates, artifacts, doctor, scaffold, convergence. */
import {
  artifactQuerySuffix,
  card,
  fetchJson,
  lineageBadgeFromRow,
  lineageBadgeHtml,
} from "/dashboard-core.js";

// Gates
(async () => {
  try {
    const d = await fetchJson("/api/gates"),
      eg = d.effectGates || d,
      s = eg.summary || {};
    let h = `<div class="row"><span>Status</span><span class="badge ${s.errors ? "badge-err" : "badge-ok"}">${s.errors ? "FAILING" : "PASSING"}</span></div>`;
    h += `<div class="row"><span>Gates</span><strong>${s.total || 0}</strong></div>`;
    h += `<div class="row"><span>Errors</span><strong style="color:${s.errors ? "var(--red)" : "var(--green)"}">${s.errors || 0}</strong></div>`;
    if (eg.violations)
      for (const v of eg.violations.slice(0, 3)) h += `<p class="status err">${v.message}</p>`;
    try {
      const art = await fetchJson("/api/artifacts?includeLineage=1");
      const saved = (art.artifacts || []).filter((row) => (row.count ?? 0) > 0).slice(0, 10);
      if (saved.length) {
        const rows = saved
          .map((row) => {
            const lin = lineageBadgeFromRow(row);
            return `<tr>
              <td><code>${row.gate}</code></td>
              <td>${lin}</td>
              <td>${row.count ?? 0}</td>
              <td style="font-size:10px;color:var(--muted)">${(row.upstreamArtifacts || []).length} upstream</td>
            </tr>`;
          })
          .join("");
        h += `<details style="margin-top:10px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Saved gate artifacts (${saved.length})</summary>
          <table style="margin-top:6px"><thead><tr><th>Gate</th><th>Lineage</th><th>Count</th><th>Upstream</th></tr></thead><tbody>${rows}</tbody></table>
          <p style="font-size:10px;color:var(--muted);margin-top:6px">Execution order: <code>GET /api/gates/graph</code> · provenance: <code>GET /api/artifacts/:gate/lineage</code> · convergence: <code>GET /api/artifact-graph</code></p>
        </details>`;
      }
    } catch {
      /* artifact store optional */
    }
    card("card-gates", h);
  } catch (e) {
    card("card-gates", `<p class="status err">${e.message}</p>`);
  }
})();

// Artifact Graph Convergence — two-phase: live data + schema
let convergenceSchema = null;
(async () => {
  const body = document.getElementById("card-convergence-body");
  if (!body) return;
  try {
    const d = await fetchJson("/api/artifact-graph");
    const conv = d.convergence || {};
    const aligned = d.artifactGraph?.aligned ?? false;
    let h = `<div class="row"><span>Alignment</span><span class="badge ${aligned ? "badge-ok" : "badge-err"}">${aligned ? "ALIGNED" : "DRIFT"}</span></div>`;
    h += `<div class="row"><span>Nodes</span><strong>${d.artifactGraph?.artifactCount ?? 0}</strong></div>`;
    h += `<div class="row"><span>Edges</span><strong>${d.artifactGraph?.edgeCount ?? 0}</strong></div>`;
    h += `<div class="row"><span>Gates</span><strong>${d.artifactGraph?.gateCount ?? 0}</strong></div>`;

    if (conv.bunRuntimeCapabilities) {
      h += `<div class="row"><span>Runtime caps</span><span class="badge ${conv.bunRuntimeCapabilities.aligned ? "badge-ok" : "badge-err"}">${conv.bunRuntimeCapabilities.inventoryKeys} keys ${conv.bunRuntimeCapabilities.aligned ? "✓" : "✗"}</span></div>`;
    }
    if (conv.bunImage) {
      h += `<div class="row"><span>Bun.Image</span><span class="badge ${conv.bunImage.metadataProbe === "ok" ? "badge-ok" : conv.bunImage.metadataProbe === "skip" ? "badge-warn" : "badge-err"}">${conv.bunImage.available ? "available" : "n/a"} (${conv.bunImage.metadataProbe})</span></div>`;
    }
    if (conv.context) {
      h += `<div class="row"><span>Artifact store</span><span class="badge ${conv.context.artifactStore === "ok" ? "badge-ok" : conv.context.artifactStore === "skip" ? "badge-warn" : "badge-err"}">${conv.context.artifactStore}</span></div>`;
      h += `<div class="row"><span>Gate DAG</span><span class="badge ${conv.context.dag === "ok" ? "badge-ok" : conv.context.dag === "skip" ? "badge-warn" : "badge-err"}">${conv.context.dag}</span></div>`;
    }

    h += `<p style="font-size:10px;color:var(--muted);margin-top:6px">Inspect: <code>${d.artifactGraph?.inspectCommand || "curl -s http://127.0.0.1:5678/api/artifact-graph"}</code></p>`;

    if (Array.isArray(conv.fixPlan) && conv.fixPlan.length > 0) {
      h += `<details style="margin-top:8px"><summary style="font-size:11px;cursor:pointer;color:var(--red)">Fix plan (${conv.fixPlan.length} ${conv.fixPlan.length === 1 ? "step" : "steps"})</summary>`;
      h += `<ul style="margin-top:6px;padding-left:18px">`;
      for (const step of conv.fixPlan) {
        h += `<li style="font-size:10px;color:var(--muted);margin-bottom:3px">${step}</li>`;
      }
      h += `</ul></details>`;
    }

    h += `<details id="convergence-schema-panel" style="margin-top:10px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Transpiler.scan() schema (click to load)</summary><div id="convergence-schema-body" style="margin-top:6px"><p style="font-size:10px;color:var(--muted)">Click to load schema…</p></div></details>`;

    card("card-convergence", h);

    const details = document.getElementById("convergence-schema-panel");
    const schemaBody = document.getElementById("convergence-schema-body");
    if (details && schemaBody) {
      details.addEventListener("toggle", async () => {
        if (!details.open) return;
        if (convergenceSchema) {
          renderSchema(schemaBody, convergenceSchema);
          return;
        }
        schemaBody.innerHTML = `<p style="font-size:10px;color:var(--muted)">Loading schema…</p>`;
        try {
          const s = await fetchJson("/api/artifact-graph-convergence/schema");
          convergenceSchema = s;
          renderSchema(schemaBody, s);
        } catch (e) {
          schemaBody.innerHTML = `<p class="status err">${e.message}</p>`;
        }
      });
    }
  } catch (e) {
    card("card-convergence", `<p class="status err">${e.message}</p>`);
  }
})();

function renderSchema(container, schema) {
  let h = `<p style="font-size:10px;color:var(--muted);margin-bottom:6px">${schema.totalExports} exports across ${schema.pillars.length} pillars · schema v${schema.schemaVersion}</p>`;
  h += `<button id="convergence-schema-refresh" style="font-size:10px;margin-bottom:8px;cursor:pointer">Refresh schema</button>`;
  for (const pillar of schema.pillars) {
    h += `<p style="font-size:11px;font-weight:bold;margin-top:6px">${pillar.name} <code style="font-size:9px;color:var(--muted)">${pillar.modulePath}</code></p>`;
    h += `<table style="margin-top:4px"><tbody>`;
    for (const exp of pillar.exports) {
      h += `<tr><td><code>${exp.name}</code></td><td style="font-size:10px;color:var(--muted)">${exp.kind}</td></tr>`;
    }
    h += `</tbody></table>`;
  }
  container.innerHTML = h;
  const btn = document.getElementById("convergence-schema-refresh");
  if (btn) {
    btn.addEventListener("click", async () => {
      convergenceSchema = null;
      container.innerHTML = `<p style="font-size:10px;color:var(--muted)">Refreshing…</p>`;
      try {
        const s = await fetchJson("/api/artifact-graph-convergence/schema");
        convergenceSchema = s;
        renderSchema(container, s);
      } catch (e) {
        container.innerHTML = `<p class="status err">${e.message}</p>`;
      }
    });
  }
}

// Hardcoded-secret audit — live scan of src/, scripts/, examples/
(async () => {
  try {
    const d = await fetchJson("/api/audit/hardcoded");
    const tone = d.ok ? "ok" : "err";
    const label = d.ok ? "CLEAN" : "LEAKED";
    let h = `<div class="row"><span>Status</span><span class="badge badge-${tone}">${label}</span></div>`;
    h += `<div class="row"><span>Files scanned</span><strong>${d.scanned ?? 0}</strong></div>`;
    h += `<div class="row"><span>Findings</span><strong style="color:${d.ok ? "var(--green)" : "var(--red)"}">${d.count ?? 0}</strong></div>`;
    if (Array.isArray(d.findings) && d.findings.length > 0) {
      h += `<details open style="margin-top:8px"><summary style="font-size:11px;cursor:pointer;color:var(--red)">Findings (${d.findings.length})</summary>`;
      h += `<table class="tbl" style="margin-top:6px"><tr><th>File</th><th>Line</th><th>Type</th></tr>`;
      for (const f of d.findings.slice(0, 10)) {
        const file = f.file.replace(/</g, "&lt;");
        h += `<tr><td style="font-size:9px"><code>${file}</code></td><td class="num">${f.line}</td><td style="font-size:9px">${f.type}</td></tr>`;
      }
      h += `</table>`;
      if (d.findings.length > 10) {
        h += `<p style="font-size:9px;color:var(--muted);margin-top:4px">…and ${d.findings.length - 10} more.</p>`;
      }
      h += `</details>`;
    }
    h += `<p style="font-size:9px;color:var(--muted);margin-top:6px">Suppress intentional dev fallbacks with <code>// kimi-audit:ignore-hardcoded-secret</code>.</p>`;
    card("card-hardcoded-audit", h);
  } catch (e) {
    card("card-hardcoded-audit", `<p class="status err">${e.message}</p>`);
  }
})();

// Bunfig policy — config surface for the bunfig-policy gate
(async () => {
  try {
    const d = await fetchJson("/api/bunfig");
    const sections = d.sections || {};
    const install = sections.install || {};
    const define = sections.define || {};
    const effective = d.effectiveInstall || {};
    const ssot = d.ssot || {};
    const inherited = d.inherited || [];
    const badgeFor = (status) =>
      status === "inherited"
        ? "badge-ok"
        : status === "override"
          ? "badge-warn"
          : status === "unset"
            ? "badge-warn"
            : "badge-ok";
    const row = (label, value, status) =>
      `<div class="row"><span>${label}</span><code>${value ?? "unset"}</code>${status ? `<span class="badge ${badgeFor(status)}">${status}</span>` : ""}</div>`;
    let h = `<div class="row"><span>Policy file</span><code>${d.path || "./bunfig.toml"}</code></div>`;
    h += `<div class="row"><span>Machine SSOT</span><code>${d.machineBunfigPath || "n/a"}</code></div>`;
    h += `<div class="row"><span>Sections</span><strong>${Object.keys(sections).length}</strong></div>`;
    h += `<div class="row"><span>Defines</span><strong>${Object.keys(define).length}</strong></div>`;
    h += `<div class="row"><span>Frozen lockfile</span><span class="badge ${install.frozenLockfile === false ? "badge-warn" : "badge-ok"}">${install.frozenLockfile === false ? "OFF" : "ON"}</span></div>`;
    h += row("Linker", effective.linker ?? install.linker, ssot.linker?.status);
    h += row("Global store", effective.globalStore, ssot.globalStore?.status);
    h += row("Cache dir", effective.cacheDir, ssot.cacheDir?.status);
    if (inherited.length) {
      h += `<ul style="margin:4px 0 0 16px;font-size:10px;color:var(--muted)">${inherited
        .map((note) => `<li>${note}</li>`)
        .join("")}</ul>`;
    }
    h += `<p style="font-size:10px;color:var(--muted);margin-top:6px">${d.mergeRule || "machine → project → CLI"}</p>`;
    card("card-bunfig-policy", h);
  } catch (e) {
    card("card-bunfig-policy", `<p class="status err">${e.message}</p>`);
  }
})();
function baselineSparkline(values) {
  if (!values?.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const blocks = "▁▂▃▄▅▆▇█";
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (blocks.length - 1));
      return blocks[Math.max(0, Math.min(blocks.length - 1, idx))];
    })
    .join("");
}

// Sync Baseline
(async () => {
  try {
    const d = await fetchJson("/api/sync-baseline");
    if (!d.ok) {
      card(
        "card-sync-baseline",
        `<p class="status warn">No baseline archive. Run <code>bun run sync</code> to generate.</p>`
      );
      return;
    }
    const sizeMb = (d.syncBaselineSize / 1048576).toFixed(2);
    let h = `<div class="row"><span>Archive</span><code style="font-size:9px">${d.archivePath}</code></div>`;
    h += `<div class="row"><span>Size</span><strong>${sizeMb} MB</strong> <span style="font-size:10px;color:var(--muted)">(${d.syncBaselineSize} B)</span></div>`;
    const hashTone = d.hashChanged ? "warn" : "ok";
    h += `<div class="row"><span>Hash</span><code>${d.syncBaselineHash}</code> <span class="badge badge-${hashTone}">${d.hashChanged ? "CHANGED" : "STABLE"}</span></div>`;
    if (d.previousSyncBaselineHash) {
      h += `<div class="row"><span>Prev hash</span><code style="font-size:9px">${d.previousSyncBaselineHash}</code></div>`;
      const delta =
        d.sizeDelta === 0 ? "±0 B" : `${d.sizeDelta > 0 ? "+" : ""}${d.sizeDelta} B vs last record`;
      h += `<div class="row"><span>Size delta</span><strong>${delta}</strong></div>`;
    }
    h += `<div class="row"><span>File hashes</span><strong>${d.fileCount ?? "—"}</strong></div>`;
    h += `<div class="row"><span>Version</span><strong>${d.toolchainVersion ?? "—"}</strong></div>`;
    h += `<div class="row"><span>Last synced</span><span style="font-size:10px">${d.lastSyncedAt ?? "—"}</span></div>`;
    if (d.history?.sizes?.length) {
      const driftTotal = (d.history.driftCounts ?? []).reduce((a, b) => a + b, 0);
      const spark = baselineSparkline(d.history.sizes);
      h += `<div class="row"><span>Size trend</span><code style="font-size:11px;letter-spacing:1px" title="${d.history.sizes.join(" → ")} B">${spark}</code></div>`;
      if (driftTotal > 0) {
        h += `<p class="status warn" style="margin-top:6px;font-size:10px">${driftTotal} hash drift event(s) in last ${d.history.sizes.length} sync(s)</p>`;
      }
    }
    const fetched = d.fetchedAt ? new Date(d.fetchedAt).toLocaleString() : "—";
    h += `<p class="status ok" style="margin-top:8px;font-size:10px">Fetched at ${fetched} · refresh to compare hash/size drift</p>`;
    card("card-sync-baseline", h);
  } catch (e) {
    card("card-sync-baseline", `<p class="status err">${e.message}</p>`);
  }
})();
// Config Status
(async () => {
  try {
    const d = await fetchJson("/api/config-status");
    const tone = d.aligned ? "ok" : "err";
    const label = d.aligned ? "ALIGNED" : "MISALIGNED";
    let h = `<div class="row"><span>Status</span><span class="badge badge-${tone}">${label}</span></div>`;
    h += `<div class="row"><span>Gates</span><strong>${d.gates.length}</strong></div>`;
    if (d.fixPlan?.length) {
      h += `<div class="row"><span>Fix plan</span><strong>${d.fixPlan.length}</strong></div>`;
      h += `<ul style="margin:4px 0 0 16px;font-size:10px;color:var(--muted)">${d.fixPlan
        .map((f) => `<li>${f}</li>`)
        .join("")}</ul>`;
    }
    h +=
      '<table class="tbl" style="margin-top:4px"><tr><th>Gate</th><th>Layer</th><th>Status</th><th>ms</th></tr>';
    for (const g of d.gates) {
      const statusTone = g.status === "pass" ? "ok" : g.status === "skip" ? "warn" : "err";
      h += `<tr><td style="font-size:9px">${g.id}</td><td style="font-size:9px">${g.layer}</td><td><span class="badge badge-${statusTone}">${g.status}</span></td><td class="num">${g.ms}</td></tr>`;
    }
    h += "</table>";
    const fetched = d.fetchedAt ? new Date(d.fetchedAt).toLocaleString() : "—";
    h += `<p class="status ok" style="margin-top:8px;font-size:10px">Fetched at ${fetched}</p>`;
    card("card-config-status", h);
  } catch (e) {
    card("card-config-status", `<p class="status err">${e.message}</p>`);
  }
})();
// Scaffold
(async () => {
  try {
    const d = await fetchJson("/api/scaffold");
    const archMeta = (node) => {
      if (!node) return "";
      if (node.cli) return node.cli;
      if (node.role) return node.role;
      if (node.exports)
        return Array.isArray(node.exports) ? node.exports.join(", ") : String(node.exports);
      return "";
    };
    const archRow = (label, node) => {
      if (!node?.file) return "";
      const meta = archMeta(node);
      return `<div class="row"><span style="font-size:9px">${label}</span><span><code style="font-size:9px">${node.file}</code>${meta ? `<span style="font-size:9px;color:var(--muted);margin-left:6px">${meta}</span>` : ""}</span></div>`;
    };

    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:4px">Bootstrap paths</p>`;
    h += `<table class="tbl"><tr><th>Path</th><th>Command</th></tr>`;
    for (const path of d.bootstrapPaths || []) {
      h += `<tr><td><code style="font-size:9px">${path.id}</code></td><td><code style="font-size:8px">${path.command}</code><div style="font-size:9px;color:var(--muted)">${path.note}</div></td></tr>`;
    }
    h += `</table>`;

    const tp = d.templatePolicy || {};
    const ps = tp.summary || {};
    h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">Template policy <span class="badge badge-ok">${tp.layers ?? 0} layers</span></p>`;
    h += `<div class="row"><span>Gate</span><code style="font-size:9px">${tp.gate || "—"}</code></div>`;
    h += `<div class="row"><span>Inventory</span><span style="font-size:9px">${ps.bunfigFiles ?? 0} bunfig · ${ps.registryEntries ?? 0} registry · ${ps.scaffoldFiles ?? 0} scaffold · ${ps.envExampleFiles ?? 0} env.example</span></div>`;
    if (tp.showcaseId) {
      h += `<p style="margin-top:6px"><a class="showcase-btn" style="display:inline-block;text-decoration:none" href="?example=${tp.showcaseId}">Open showcase guide</a></p>`;
    }
    if (Array.isArray(tp.checkIds) && tp.checkIds.length) {
      h += `<details style="margin-top:6px"><summary style="font-size:10px;cursor:pointer;color:var(--blue)">Policy layers (${tp.checkIds.length})</summary><p class="scaffold-policy-layers">${tp.checkIds.map((id) => `<code>${id}</code>`).join(" ")}</p></details>`;
    }

    h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">Architecture</p>`;
    for (const [k, v] of Object.entries(d.architecture || {})) {
      h += archRow(k, v);
    }

    const skills = d.skills || {};
    h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">Skills index</p>`;
    h += `<div class="row"><span>Catalog</span><code style="font-size:9px">${skills.verbose || skills.catalog || "bun run skills:table"}</code></div>`;

    h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">Perf scripts (doctor module)</p>`;
    h += `<table class="tbl"><tr><th>Script</th><th>Command</th></tr>`;
    Object.entries(d.scripts || {}).forEach(([k, v]) => {
      h += `<tr><td><code style="font-size:9px">${k}</code></td><td><code style="font-size:8px">${v}</code></td></tr>`;
    });
    h += `</table>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:6px"><code>${d.example?.command || ""}</code></p>`;
    card("card-scaffold", h);
  } catch (e) {
    card("card-scaffold", `<p class="status err">${e.message}</p>`);
  }
})();
// Metrics Schema
(async () => {
  try {
    const d = await fetchJson("/api/metrics-schema");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">Metric (${Object.keys(d.Metric.fields).length} fields)</p>`;
    h += `<table class="tbl"><tr><th>Field</th><th>Type</th><th>Example</th></tr>`;
    Object.entries(d.Metric.fields).forEach(([k, v]) => {
      h += `<tr><td><code style="font-size:9px">${k}</code></td><td style="font-size:9px">${v.type}</td><td style="font-size:9px">${v.example}</td></tr>`;
    });
    h += `</table>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">ModuleMetrics</p>`;
    h += `<table class="tbl"><tr><th>Field</th><th>Type</th><th>Example</th></tr>`;
    Object.entries(d.ModuleMetrics.fields).forEach(([k, v]) => {
      h += `<tr><td><code style="font-size:9px">${k}</code></td><td style="font-size:9px">${v.type}</td><td style="font-size:9px">${v.example}</td></tr>`;
    });
    h += `</table>`;
    if (d.exposure) {
      h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Exposure layers</summary>`;
      Object.entries(d.exposure).forEach(([k, v]) => {
        h += `<p style="font-size:10px;color:var(--blue);margin:4px 0 0">${k}</p>`;
        (Array.isArray(v) ? v : []).forEach((item) => {
          h += `<code style="font-size:9px;display:block;margin-left:8px;color:var(--muted)">${item}</code>`;
        });
      });
      h += `</details>`;
    }
    if (d.notOnGlobalThis) {
      h += `<p class="status ok" style="margin-top:4px;font-size:10px">${d.notOnGlobalThis}</p>`;
    }
    card("card-metrics-schema", h);
  } catch (e) {
    card("card-metrics-schema", `<p class="status err">${e.message}</p>`);
  }
})();

// perf-doctor + kimi-doctor CLI (live probes — auto-refresh)
(function kimiDoctorLiveCard() {
  const PERF_REFRESH_MS = 10_000;
  const EFFECT_GATES_REFRESH_MS = 30_000;
  let effectGatesCache = null;
  let staticDocs = null;
  let _perfTimer = null;
  let _effectTimer = null;

  function scrollToPerfRegistry() {
    document.getElementById("card-perf-registry")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }

  function wirePerfRegistryLinks(root) {
    root.querySelectorAll("[data-kimi-perf-registry]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToPerfRegistry();
      });
    });
  }

  function renderKimiDoctorCard(d) {
    const perf = d.perfDoctor || staticDocs?.perfDoctor || {};
    const kimi = d.kimiDoctor || staticDocs?.kimiDoctor || {};
    const flags = perf.commands || d.commands || staticDocs?.commands || [];
    const live = d.live || {};
    const livePerf = live.perf || {};
    const liveArtifacts = live.artifacts || {};
    const liveFiles = live.files || {};
    const effectGates = live.effectGates || effectGatesCache;
    const registryRoute = livePerf.registryRoute || "/api/perf-registry";
    const registryCardId = livePerf.registryCardId || "card-perf-registry";

    let h = "";
    if (livePerf.registrySize) {
      const perfTone = livePerf.allPass ? "ok" : "err";
      const perfLabel = livePerf.allPass ? "PASSING" : "FAILING";
      h += `<div class="row"><span>Live benchmarks</span><span class="badge badge-${perfTone}">${perfLabel}</span></div>`;
      h += `<div class="row"><span>Registry</span><strong>${livePerf.passCount ?? 0}/${livePerf.registrySize}</strong>`;
      h += `<button type="button" data-kimi-perf-registry style="font-size:9px;padding:2px 6px;cursor:pointer;margin-left:6px" title="Scroll to ${registryCardId}">perf-registry ↗</button></div>`;
      h += `<p style="font-size:9px;color:var(--muted);margin:2px 0 6px">Inspect: <a href="${registryRoute}" target="_blank" rel="noopener"><code>${registryRoute}</code></a> · <button type="button" data-kimi-perf-registry style="background:none;border:none;padding:0;color:var(--blue);cursor:pointer;font-size:9px">#${registryCardId}</button></p>`;
      if (Array.isArray(livePerf.failures) && livePerf.failures.length) {
        h += `<details open style="margin-top:4px"><summary style="font-size:10px;cursor:pointer;color:var(--red)">Failures (${livePerf.failures.length}) — <button type="button" data-kimi-perf-registry style="background:none;border:none;padding:0;color:var(--blue);cursor:pointer;font-size:9px">open perf-registry</button></summary>`;
        for (const failure of livePerf.failures.slice(0, 8)) {
          h += `<p class="status err" style="font-size:9px;margin:2px 0">${failure}</p>`;
        }
        h += `</details>`;
      }
      if (Array.isArray(livePerf.metrics) && livePerf.metrics.length) {
        h += `<details style="margin-top:4px"><summary style="font-size:10px;cursor:pointer;color:var(--blue)">Benchmark table (${livePerf.metrics.length})</summary>`;
        h += `<table class="tbl" style="margin-top:4px"><tr><th>Key</th><th>ms</th><th>threshold</th><th>Status</th></tr>`;
        for (const row of livePerf.metrics) {
          const tone = row.skipped ? "warn" : row.pass ? "ok" : "err";
          const label = row.skipped ? "skip" : row.pass ? "pass" : "fail";
          const keyCell = row.pass
            ? `<code style="font-size:9px">${row.name}</code>`
            : `<button type="button" data-kimi-perf-registry data-metric="${row.name}" style="background:none;border:none;padding:0;color:var(--blue);cursor:pointer;font-size:9px"><code>${row.name}</code> ↗</button>`;
          h += `<tr><td>${keyCell}</td><td class="num">${Number(row.actualMs).toFixed(2)}</td><td class="num">${row.thresholdMs}</td><td><span class="badge badge-${tone}">${label}</span></td></tr>`;
        }
        h += `</table></details>`;
      }
    }

    if (effectGates) {
      const egTone = effectGates.ok ? "ok" : "err";
      const egLabel = effectGates.ok ? "PASSING" : "FAILING";
      h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">Effect gates <span class="badge badge-${egTone}">${egLabel}</span></p>`;
      h += `<div class="row"><span>Violations</span><strong>${effectGates.summary?.total ?? 0}</strong></div>`;
      h += `<div class="row"><span>Errors</span><strong style="color:${(effectGates.summary?.errors ?? 0) > 0 ? "var(--red)" : "var(--green)"}">${effectGates.summary?.errors ?? 0}</strong></div>`;
      h += `<div class="row"><span>Regressions</span><strong>${effectGates.regressionCount ?? 0}</strong></div>`;
      h += `<p style="font-size:9px;color:var(--muted);margin:2px 0 4px">Inspect: <a href="${effectGates.route || "/api/gates"}" target="_blank" rel="noopener"><code>${effectGates.route || "/api/gates"}</code></a> · <button type="button" id="kimi-scroll-gates" style="background:none;border:none;padding:0;color:var(--blue);cursor:pointer;font-size:9px">#card-gates</button></p>`;
      if (Array.isArray(effectGates.violations) && effectGates.violations.length) {
        h += `<details style="margin-top:4px"><summary style="font-size:10px;cursor:pointer;color:var(--red)">Violations (${effectGates.violations.length})</summary>`;
        for (const v of effectGates.violations.slice(0, 6)) {
          h += `<p class="status ${v.severity === "error" ? "err" : "warn"}" style="font-size:9px;margin:2px 0">${v.location ? `${v.location}: ` : ""}${v.message}</p>`;
        }
        h += `</details>`;
      }
      if (effectGates.fetchedAt) {
        h += `<p style="font-size:9px;color:var(--muted)">Effect-gates probed ${new Date(effectGates.fetchedAt).toLocaleString()}</p>`;
      }
    }

    if (Array.isArray(liveArtifacts.gates) && liveArtifacts.gates.length) {
      h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">Lineage artifacts <span class="badge badge-${(liveArtifacts.savedCount ?? 0) > 0 ? "ok" : "warn"}">art:${liveArtifacts.artBadge ?? 0}</span></p>`;
      h += `<table class="tbl"><tr><th>Gate</th><th>Count</th><th>Status</th><th>savedAt</th></tr>`;
      for (const row of liveArtifacts.gates) {
        const tone =
          row.count > 0 ? (row.status === "pass" || row.status === "ok" ? "ok" : "warn") : "warn";
        const savedAt = row.savedAt ? new Date(row.savedAt).toLocaleString() : "—";
        h += `<tr><td><code style="font-size:9px">${row.gate}</code></td><td class="num">${row.count ?? 0}</td><td><span class="badge badge-${tone}">${row.status || "missing"}</span></td><td style="font-size:9px;color:var(--muted)">${savedAt}</td></tr>`;
      }
      h += `</table>`;
    }

    if (liveFiles.dashboardDir) {
      h += `<div class="row" style="margin-top:6px"><span>thresholds.json</span><span class="badge badge-${liveFiles.thresholdsJson ? "ok" : "warn"}">${liveFiles.thresholdsJson ? "present" : "missing"}</span></div>`;
      h += `<div class="row"><span>perf-report.html</span><span class="badge badge-${liveFiles.perfReportHtml ? "ok" : "warn"}">${liveFiles.perfReportHtml ? "present" : "missing"}</span></div>`;
    }

    if (d.fetchedAt) {
      h += `<p class="status ok" style="font-size:9px;margin-top:6px">Perf probed ${new Date(d.fetchedAt).toLocaleString()} · refresh ${PERF_REFRESH_MS / 1000}s</p>`;
    }

    h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">perf-doctor <span style="font-size:9px;color:var(--muted)">${perf.cli || d.cli || ""}</span></p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Flag</th><th>Purpose</th></tr>`;
    flags.forEach((c, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:10px">${c.flag}</code></td><td style="font-size:10px">${c.description}</td></tr>`;
    });
    h += `</table>`;

    const scripts = perf.npmScripts || {};
    if (Object.keys(scripts).length) {
      h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">npm scripts (examples/dashboard)</p>`;
      h += `<table class="tbl"><tr><th>Script</th><th>Purpose</th></tr>`;
      for (const [name, desc] of Object.entries(scripts)) {
        h += `<tr><td><code style="font-size:9px">bun run ${name}</code></td><td style="font-size:9px;color:var(--muted)">${desc}</td></tr>`;
      }
      h += `</table>`;
    }

    if (Array.isArray(d.threeSurfaces) && d.threeSurfaces.length) {
      h += `<details style="margin-top:6px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Three perf surfaces (do not conflate)</summary>`;
      h += `<table class="tbl" style="margin-top:4px"><tr><th>Surface</th><th>Command</th><th>Role</th></tr>`;
      for (const row of d.threeSurfaces) {
        h += `<tr><td style="font-size:9px">${row.surface}</td><td><code style="font-size:8px">${row.command}</code></td><td style="font-size:9px;color:var(--muted)">${row.role}</td></tr>`;
      }
      h += `</table></details>`;
    }

    h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Pipeline</summary>`;
    h += `<code style="font-size:9px;display:block">${perf.pipeline || d.pipeline}</code>`;
    h += `<code style="font-size:9px;display:block;margin-top:4px">${perf.allAtOnce || d.allAtOnce}</code>`;
    h += `</details>`;

    if (d.watchModes) {
      h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Watch modes</summary>`;
      h += `<table class="tbl" style="margin-top:4px"><tr><th>Tool</th><th>Mechanism</th><th>Entry</th></tr>`;
      h += `<tr><td><code>${d.watchModes.perfDoctor.tool}</code></td><td style="font-size:10px">${d.watchModes.perfDoctor.mechanism}</td><td><code style="font-size:9px">${d.watchModes.perfDoctor.entry}</code></td></tr>`;
      h += `<tr><td><code>${d.watchModes.kimiDoctor.tool}</code></td><td style="font-size:10px">${d.watchModes.kimiDoctor.mechanism}</td><td><code style="font-size:9px">${d.watchModes.kimiDoctor.entry}</code></td></tr>`;
      h += `</table></details>`;
    }

    if (kimi.gateCommands?.length) {
      h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 4px">kimi-doctor (main repo)</p>`;
      h += `<ul style="margin:0 0 0 16px;font-size:9px;color:var(--muted)">`;
      for (const cmd of kimi.gateCommands) {
        h += `<li><code>${cmd}</code></li>`;
      }
      h += `</ul>`;
    }

    const artifactHint = d.artifactHint || staticDocs?.artifactHint;
    if (artifactHint && (liveArtifacts.savedCount ?? 0) === 0) {
      h += `<p class="status warn" style="font-size:9px;margin-top:8px">${artifactHint}</p>`;
    }
    const note = d.note || staticDocs?.note;
    if (note) {
      h += `<p style="font-size:9px;color:var(--muted);margin-top:4px">${note}</p>`;
    }
    card("card-kimi-doctor", h);
    const cardEl = document.getElementById("card-kimi-doctor");
    if (cardEl) wirePerfRegistryLinks(cardEl);
    document.getElementById("kimi-scroll-gates")?.addEventListener("click", () => {
      document
        .getElementById("card-gates")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function refreshPerf() {
    try {
      const d = await fetchJson("/api/kimi-doctor?fast=1");
      if (!staticDocs) staticDocs = d;
      if (effectGatesCache) {
        d.live = { ...d.live, effectGates: effectGatesCache };
      }
      renderKimiDoctorCard(d);
    } catch (e) {
      card("card-kimi-doctor", `<p class="status err">${e.message}</p>`);
    }
  }

  async function refreshEffectGates() {
    try {
      const payload = await fetchJson("/api/kimi-doctor?effectGatesOnly=1");
      effectGatesCache = payload.effectGates || payload.live?.effectGates || null;
      await refreshPerf();
    } catch {
      /* effect-gates optional on slow path */
    }
  }

  void (async () => {
    try {
      const d = await fetchJson("/api/kimi-doctor");
      staticDocs = d;
      effectGatesCache = d.live?.effectGates ?? null;
      renderKimiDoctorCard(d);
    } catch (e) {
      card("card-kimi-doctor", `<p class="status err">${e.message}</p>`);
    }
    _perfTimer = setInterval(() => void refreshPerf(), PERF_REFRESH_MS);
    _effectTimer = setInterval(() => void refreshEffectGates(), EFFECT_GATES_REFRESH_MS);
  })();
})();

// Global Store
(async () => {
  try {
    const d = await fetchJson("/api/global-store");
    let h = `<div class="row"><span>Store</span><code style="font-size:9px">${d.storePaths.links}</code></div>`;
    h += `<div class="row"><span>Packages</span><strong>${d.state.packages}</strong></div>`;
    if (d.state.example)
      h += `<div class="row"><span>Example</span><code style="font-size:9px">${d.state.example}</code></div>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:4px">${d.philosophy.warmInstall}</p>`;
    h += `<div class="row"><span>Property</span><span class="badge badge-ok">${d.philosophy.property.slice(0, 30)}…</span></div>`;
    card("card-global-store", h);
  } catch (e) {
    card("card-global-store", `<p class="status err">${e.message}</p>`);
  }
})();

// Trace Verify
(async () => {
  try {
    const d = await fetchJson("/api/trace-verify");
    let h = `<pre style="font-size:10px;background:var(--border);padding:4px;border-radius:4px;overflow-x:auto;max-height:160px">${d.table.replace(/</g, "&lt;")}</pre>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Verification (${d.verification.traceId})</p>`;
    const c = d.verification.checks;
    h += `<div class="row"><span>byteLength=32</span><span class="badge badge-${c.byteLength32 ? "ok" : "err"}">${c.byteLength32 ? "✓" : "✗"}</span></div>`;
    h += `<div class="row"><span>hexLength=64</span><span class="badge badge-${c.hexLength64 ? "ok" : "err"}">${c.hexLength64 ? "✓" : "✗"}</span></div>`;
    h += `<div class="row"><span>deepEquals</span><span class="badge badge-${c.deepEquals ? "ok" : "err"}">${c.deepEquals ? "✓" : "✗"}</span></div>`;
    h += `<div class="row"><span>Overall</span><span class="badge badge-${d.verification.valid ? "ok" : "err"}">${d.verification.valid ? "PASS" : "FAIL"}</span></div>`;
    card("card-trace-verify", h);
  } catch (e) {
    card("card-trace-verify", `<p class="status err">${e.message}</p>`);
  }
})();
// Trace Ledger
(function traceLedgerCard() {
  const REFRESH_MS = 10_000;
  let activeTool = "";
  let activeStatus = "";
  let _timer = null;

  async function render() {
    try {
      const params = new URLSearchParams();
      if (activeTool) params.set("tool", activeTool);
      if (activeStatus) params.set("status", activeStatus);
      const qs = params.toString();
      const d = await fetchJson(`/api/trace-ledger${qs ? "?" + qs : ""}`);
      const s = d.stats;
      let h = `<div class="row" style="margin-bottom:4px;flex-wrap:wrap;gap:4px">`;
      h += `<span style="font-size:11px;color:var(--muted)">${s.totalEvents} events · ${s.uniqueTraces} traces · ${s.errorCount} errors (${s.errorRate}%) · avg ${s.avgDurationMs}ms · p95 ${s.p95DurationMs}ms · max ${s.maxDurationMs}ms</span>`;
      h += `</div>`;

      // Filter controls
      const tools = Object.keys(s.byTool).sort();
      h += `<div class="row" style="margin-bottom:6px;gap:6px">`;
      h += `<select id="trace-filter-tool" style="font-size:10px;padding:1px 4px"><option value="">All tools</option>`;
      for (const t of tools)
        h += `<option value="${t}"${activeTool === t ? " selected" : ""}>${t} (${s.byTool[t]})</option>`;
      h += `</select>`;
      h += `<select id="trace-filter-status" style="font-size:10px;padding:1px 4px"><option value="">All statuses</option>`;
      for (const st of Object.keys(s.byStatus).sort())
        h += `<option value="${st}"${activeStatus === st ? " selected" : ""}>${st} (${s.byStatus[st]})</option>`;
      h += `</select>`;
      h += `</div>`;

      // Recent failures
      if (d.recentFailures && d.recentFailures.length > 0) {
        h += `<details style="margin-bottom:6px"><summary style="font-size:11px;cursor:pointer;color:var(--red)">${d.recentFailures.length} recent failure(s)</summary>`;
        h += `<table class="tbl" style="margin-top:4px"><tr><th>Tool</th><th>Taxonomy</th><th>Severity</th><th>Time</th><th>Output</th></tr>`;
        for (const f of d.recentFailures) {
          const out = f.output ? f.output.slice(0, 80) : "—";
          h += `<tr><td>${f.toolName || "—"}</td><td><code>${f.taxonomyId || "—"}</code></td><td><span class="badge badge-${f.severity === "error" ? "err" : "warn"}">${f.severity || "—"}</span></td><td style="font-size:9px">${f.timestamp || "—"}</td><td style="font-size:9px;color:var(--muted)">${out.replace(/</g, "&lt;")}</td></tr>`;
        }
        h += `</table></details>`;
      }

      // Trace summaries
      const summaries = d.traceSummaries || [];
      if (summaries.length > 0) {
        h += `<details open style="margin-bottom:6px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Trace summaries (${summaries.length})</summary>`;
        h += `<table class="tbl" style="margin-top:4px"><tr><th>Trace</th><th>Tool</th><th>Events</th><th>Status</th><th>Total</th><th>Sections</th><th>Time</th></tr>`;
        const maxDur = Math.max(...summaries.map((t) => t.totalDurationMs), 1);
        for (const t of summaries) {
          const short = t.traceId.slice(0, 8);
          const badge = t.status === "ok" ? "ok" : t.status === "error" ? "err" : "warn";
          const barW = Math.round((t.totalDurationMs / maxDur) * 60);
          const barColor = t.hasErrors ? "var(--red)" : "var(--green)";
          const time = t.startedAt ? t.startedAt.slice(11, 19) : "—";
          const secs = t.sections.length > 0 ? t.sections.join(", ") : "—";
          h += `<tr style="cursor:pointer" data-trace-id="${t.traceId}">`;
          h += `<td style="font-size:9px">${short}${t.hasFailures ? " ⚠" : ""}</td>`;
          h += `<td>${t.tool}</td>`;
          h += `<td class="num">${t.eventCount}</td>`;
          h += `<td><span class="badge badge-${badge}">${t.status}</span></td>`;
          h += `<td style="font-size:10px"><span style="display:inline-block;width:${barW}px;height:8px;background:${barColor};border-radius:2px;margin-right:4px;vertical-align:middle"></span>${t.totalDurationMs}ms</td>`;
          h += `<td style="font-size:9px;color:var(--muted)">${secs}</td>`;
          h += `<td style="font-size:9px">${time}</td>`;
          h += `</tr>`;
        }
        h += `</table></details>`;
      }

      // Recent events table
      const events = d.recentEvents || [];
      if (events.length === 0) {
        h += `<p class="status warn" style="font-size:11px">No trace events recorded yet.</p>`;
      } else {
        h += `<details style="margin-bottom:6px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Recent events (${events.length})</summary>`;
        h += `<table class="tbl" style="margin-top:4px"><tr><th>Trace</th><th>Tool</th><th>Section</th><th>Status</th><th>Dur</th><th>Time</th></tr>`;
        let lastTrace = "";
        for (const e of events) {
          const short = e.traceId.slice(0, 8);
          const isNew = e.traceId !== lastTrace;
          lastTrace = e.traceId;
          const badge = e.status === "ok" ? "ok" : e.status === "error" ? "err" : "warn";
          const dur = e.durationMs != null ? `${e.durationMs}ms` : "—";
          const time = e.startedAt ? e.startedAt.slice(11, 19) : "—";
          h += `<tr style="cursor:pointer" data-trace-id="${e.traceId}">`;
          h += `<td style="font-size:9px;${isNew ? "border-top:2px solid var(--border)" : ""}">${isNew ? short : ""}</td>`;
          h += `<td>${e.tool}</td>`;
          h += `<td style="font-size:10px">${e.section || "—"}</td>`;
          h += `<td><span class="badge badge-${badge}">${e.status}</span></td>`;
          h += `<td style="font-size:10px">${dur}</td>`;
          h += `<td style="font-size:9px">${time}</td>`;
          h += `</tr>`;
        }
        h += `</table></details>`;
      }

      h += `<div id="trace-ledger-graph-panel" style="margin-top:8px"></div>`;
      card("card-trace-ledger", h);

      // Wire filter controls
      const toolSel = document.getElementById("trace-filter-tool");
      const statusSel = document.getElementById("trace-filter-status");
      if (toolSel)
        toolSel.addEventListener("change", () => {
          activeTool = toolSel.value;
          render();
        });
      if (statusSel)
        statusSel.addEventListener("change", () => {
          activeStatus = statusSel.value;
          render();
        });

      // Wire clickable rows
      document.querySelectorAll("[data-trace-id]").forEach((row) => {
        row.addEventListener("click", async () => {
          const traceId = row.getAttribute("data-trace-id");
          const panel = document.getElementById("trace-ledger-graph-panel");
          if (!panel || !traceId) return;
          panel.innerHTML = `<p style="font-size:10px;color:var(--muted)">Loading graph…</p>`;
          try {
            const g = await fetchJson(
              `/api/trace-ledger/graph?traceId=${encodeURIComponent(traceId)}`
            );
            if (!g.found) {
              panel.innerHTML = `<p class="status warn" style="font-size:11px">Trace ${traceId.slice(0, 8)} not found.</p>`;
              return;
            }
            let gh = `<details open style="margin-bottom:6px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Trace graph tree</summary>`;
            gh += `<pre style="font-size:10px;background:var(--border);padding:6px;border-radius:4px;overflow-x:auto;max-height:200px;line-height:1.3">${g.tree.replace(/</g, "&lt;")}</pre>`;
            if (g.rootCauseChain && g.rootCauseChain.length > 0) {
              gh += `<p class="status err" style="font-size:10px;margin-top:4px">root-cause: ${g.rootCauseChain.join(" → ")}</p>`;
            }
            gh += `</details>`;
            gh += `<details style="margin-bottom:6px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Deep object inspection (${g.nodes.length} nodes)</summary>`;
            for (const node of g.nodes) {
              gh += `<p style="font-size:10px;color:var(--muted);margin:4px 0 2px">${node.traceId.slice(0, 12)} — ${node.status} — ${node.events.length} event(s) ${node.failures.length > 0 ? `· ${node.failures.length} failure(s)` : ""}</p>`;
              for (const ev of node.events) {
                gh += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px;overflow-x:auto;max-height:160px;margin:2px 0">${JSON.stringify(ev, null, 2).replace(/</g, "&lt;")}</pre>`;
              }
              for (const fail of node.failures) {
                gh += `<pre style="font-size:9px;background:rgba(255,0,0,0.08);padding:4px;border-radius:4px;overflow-x:auto;max-height:160px;margin:2px 0">${JSON.stringify(fail, null, 2).replace(/</g, "&lt;")}</pre>`;
              }
            }
            gh += `</details>`;
            panel.innerHTML = gh;
          } catch (e) {
            panel.innerHTML = `<p class="status err" style="font-size:11px">${e.message}</p>`;
          }
        });
      });
    } catch (e) {
      card("card-trace-ledger", `<p class="status err">${e.message}</p>`);
    }
  }

  render();
  _timer = setInterval(render, REFRESH_MS);
})();
// Gate artifacts — identity filters (session / workspace / pane / agent / runId)
(function wireArtifactIdentityCard() {
  const body = document.getElementById("card-artifacts-body");
  const runsBody = document.getElementById("card-artifacts-runs");
  const lineageBody = document.getElementById("card-artifacts-lineage");
  const metadataBody = document.getElementById("card-artifacts-metadata");
  const diffBody = document.getElementById("card-artifacts-diff");
  const runsHint = document.getElementById("card-artifacts-runs-hint");
  let selectedGate = new URLSearchParams(location.search).get("lineageGate") || "";
  let diffPickRunId = null;
  let diffPickGatePath = null;
  const IDENTITY_KEYS = ["sessionId", "workspaceId", "paneId", "agentId", "runId"];
  const fields = {
    sessionId: document.getElementById("artifact-filter-session"),
    workspaceId: document.getElementById("artifact-filter-workspace"),
    paneId: document.getElementById("artifact-filter-pane"),
    agentId: document.getElementById("artifact-filter-agent"),
    runId: document.getElementById("artifact-filter-run"),
  };
  const lists = {
    sessionIds: document.getElementById("artifact-opt-session"),
    workspaceIds: document.getElementById("artifact-opt-workspace"),
    paneIds: document.getElementById("artifact-opt-pane"),
    agentIds: document.getElementById("artifact-opt-agent"),
    runIds: document.getElementById("artifact-opt-run"),
  };

  window.addEventListener(CANVAS_FILTER_EVENT, (e) => {
    onCanvasFilterApplied(e.detail || {});
  });

  window.addEventListener("run-manifest-loaded", (e) => {
    const payload = e.detail?.payload;
    const runId = payload?.runId?.trim();
    if (runId && fields.runId) fields.runId.value = runId;
    syncUrlFromFields();
    void refresh();
  });

  window.addEventListener("session-runs-loaded", (e) => {
    const params = e.detail?.params;
    if (params?.sessionId && fields.sessionId) fields.sessionId.value = params.sessionId;
    if (params?.workspaceId && fields.workspaceId) fields.workspaceId.value = params.workspaceId;
    if (params?.paneId && fields.paneId) fields.paneId.value = params.paneId;
    if (params?.agentId && fields.agentId) fields.agentId.value = params.agentId;
    syncUrlFromFields();
    void refresh();
  });

  window.addEventListener("diff-manifest-loaded", (e) => {
    const { left, right, diff } = e.detail || {};
    if (diff?.runA && diff?.runB) syncDiffParam(`${diff.runA}..${diff.runB}`);
    void renderRunDiffFromServer(left, right, diff);
  });

  function fillList(listEl, values) {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const value of values || []) {
      const opt = document.createElement("option");
      opt.value = value;
      listEl.appendChild(opt);
    }
  }

  function queryParams() {
    const params = new URLSearchParams();
    for (const [key, input] of Object.entries(fields)) {
      const value = input?.value?.trim();
      if (value) params.set(key, value);
    }
    return params;
  }

  function hydrateFromUrl() {
    const params = new URLSearchParams(location.search);
    for (const key of IDENTITY_KEYS) {
      const value = params.get(key);
      if (value && fields[key]) fields[key].value = value;
    }
  }

  function syncUrlFromFields() {
    const url = new URL(location.href);
    for (const key of IDENTITY_KEYS) {
      const value = fields[key]?.value?.trim();
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history.replaceState(null, "", url);
  }

  function statusBadge(status) {
    const tone =
      status === "pass" || status === "ok"
        ? "ok"
        : status === "fail" || status === "error"
          ? "err"
          : status === "skip"
            ? "warn"
            : "warn";
    return `<span class="badge badge-${tone}">${status || "unknown"}</span>`;
  }

  function identityCell(row) {
    const ctx = [row.sessionId, row.workspaceId, row.paneId, row.agentId, row.runId]
      .filter(Boolean)
      .join(" · ");
    return ctx || "—";
  }

  function renderArtifactsTable(artifacts) {
    const rows = (artifacts || [])
      .map((row) => {
        const lin = lineageBadgeFromRow(row);
        const active = selectedGate === row.gate ? " active" : "";
        const latestPath = row.latestPath || "";
        return `<tr>
            <td><button type="button" class="artifact-gate-pick${active}" data-gate="${row.gate}" data-gate-path="${latestPath.replace(/"/g, "&quot;")}"><code>${row.gate}</code></button></td>
            <td>${statusBadge(row.status)}</td>
            <td>${lin}</td>
            <td>${row.count ?? 0}</td>
            <td><code>${(row.latestPath || "—").replace(/^\.kimi\/artifacts\//, "")}</code></td>
            <td style="color:var(--muted);font-size:11px">${identityCell(row)}</td>
          </tr>`;
      })
      .join("");
    return rows
      ? `<table><thead><tr><th>Gate</th><th>Status</th><th>Lineage</th><th>Count</th><th>Latest</th><th>Identity</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<span class="status warn">No artifacts match. Run: kimi-doctor --gate model-drift --save-artifact</span>`;
  }

  function syncLineageGateToUrl(gate) {
    const url = new URL(location.href);
    if (gate) url.searchParams.set("lineageGate", gate);
    else url.searchParams.delete("lineageGate");
    history.replaceState(null, "", url);
  }

  function syncDiffParam(value) {
    const url = new URL(location.href);
    if (value) url.searchParams.set("diff", value);
    else url.searchParams.delete("diff");
    history.replaceState(null, "", url);
  }

  function updateDiffPickHints() {
    if (runsHint) {
      runsHint.textContent = diffPickRunId
        ? `Diff pick A: ${diffPickRunId} — shift+click a second run`
        : "";
    }
  }

  function markDiffPickRows() {
    for (const btn of document.querySelectorAll(".artifact-run-pick")) {
      btn.classList.toggle("diff-pick-a", btn.getAttribute("data-run-id") === diffPickRunId);
    }
    for (const btn of document.querySelectorAll(".artifact-gate-pick")) {
      btn.classList.toggle("diff-pick-a", btn.getAttribute("data-gate-path") === diffPickGatePath);
    }
    updateDiffPickHints();
  }

  async function renderLineageExplorer(gate) {
    if (!lineageBody) return;
    if (!gate) {
      lineageBody.innerHTML =
        '<span class="status warn">Select a gate row to compare execution DAG vs artifact lineage.</span>';
      return;
    }
    lineageBody.innerHTML = `Loading lineage for <code>${gate}</code>…`;
    try {
      const [lineage, gateGraph] = await Promise.all([
        fetchJson(`/api/artifacts/${encodeURIComponent(gate)}/lineage`),
        fetchJson(`/api/gates/graph?gate=${encodeURIComponent(gate)}`),
      ]);

      const execRows = (gateGraph.gates || [])
        .map(
          (g) =>
            `<tr><td><code>${g.name}</code></td><td style="font-size:10px">${(g.dependsOn || []).join(", ") || "—"}</td></tr>`
        )
        .join("");

      const upstream = (lineage.runLineage?.upstreamArtifacts || [])
        .map((p) => `<li><code>${String(p).replace(/^\.kimi\/artifacts\//, "")}</code></li>`)
        .join("");

      const lineageMeta = lineage.ok
        ? `${lineageBadgeHtml(lineage.lineageSource || "none", lineage.dependencyCount ?? 0)} <code>${(lineage.path || "").replace(/^\.kimi\/artifacts\//, "") || "—"}</code>`
        : `<span class="status err">${lineage.error || "No lineage"}</span>`;

      const mermaidBlock =
        lineage.ok && lineage.mermaid && lineage.lineageSource !== "none"
          ? `<pre class="lineage-pre">${lineage.mermaid}</pre>`
          : `<p class="status warn" style="margin-top:8px;font-size:11px">No Mermaid on latest artifact — run <code>kimi-doctor --gate ${gate} --save-artifact</code></p>`;

      const execMermaid =
        gateGraph.ok && gateGraph.mermaid
          ? `<pre class="lineage-pre">${gateGraph.mermaid}</pre>`
          : `<p class="status warn" style="font-size:11px">Gate graph unavailable</p>`;

      lineageBody.innerHTML = `<div class="row" style="margin-bottom:8px"><span>Gate <code>${gate}</code></span>${lineageMeta}</div>
        <div class="lineage-split">
          <div>
            <strong style="font-size:11px">Execution DAG</strong> <span style="font-size:10px;color:var(--muted)">what runs before what</span>
            ${execRows ? `<table style="margin-top:6px"><thead><tr><th>Gate</th><th>dependsOn</th></tr></thead><tbody>${execRows}</tbody></table>` : ""}
            ${execMermaid}
          </div>
          <div>
            <strong style="font-size:11px">Artifact lineage</strong> <span style="font-size:10px;color:var(--muted)">what data was consumed</span>
            ${upstream ? `<ul style="margin:6px 0 0 16px;font-size:10px">${upstream}</ul>` : '<p style="font-size:10px;color:var(--muted);margin-top:6px">No upstream paths on envelope</p>'}
            ${mermaidBlock}
          </div>
        </div>`;
    } catch (e) {
      lineageBody.innerHTML = `<span class="status err">${e}</span>`;
    }
  }

  function metadataSummary(metadata) {
    if (!metadata || typeof metadata !== "object") return "—";
    const row = metadata;
    const parts = [];
    if (row.hostname) parts.push(String(row.hostname));
    if (typeof row.pid === "number" && Number.isFinite(row.pid)) parts.push(`pid:${row.pid}`);
    if (row.bunVersion) parts.push(`bun ${row.bunVersion}`);
    if (row.level !== undefined) parts.push(`L${row.level}`);
    if (Array.isArray(row.dependsOn) && row.dependsOn.length > 0) {
      parts.push(`dep:${row.dependsOn.length}`);
    }
    if (row.lineage && Array.isArray(row.lineage.upstreamArtifacts)) {
      parts.push(`rt:${row.lineage.upstreamArtifacts.length}`);
    }
    if (row.lineageMermaid) parts.push("mermaid");
    return parts.join(" · ") || "—";
  }

  async function renderMetadataCollection(gate) {
    if (!metadataBody) return;
    if (!gate) {
      metadataBody.innerHTML =
        '<span class="status warn">Select a gate row to view indexed metadata collection.</span>';
      return;
    }
    metadataBody.innerHTML = `Loading metadata for <code>${gate}</code>…`;
    try {
      const filterParams = queryParams();
      const q = filterParams.toString();
      const suffix = q ? `&${q}` : "";
      const payload = await fetchJson(
        `/api/artifacts/metadata?gate=${encodeURIComponent(gate)}&limit=5${suffix}`
      );
      const rows = (payload.entries || [])
        .map((entry) => {
          const path = String(entry.relativePath || entry.path || "—").replace(
            /^\.kimi\/artifacts\//,
            ""
          );
          return `<tr>
            <td style="font-size:10px"><code>${path}</code></td>
            <td style="font-size:10px;color:var(--muted)">${entry.savedAt || "—"}</td>
            <td style="font-size:10px">${metadataSummary(entry.metadata)}</td>
            <td style="font-size:10px;color:var(--muted)">${entry.runId || "—"}</td>
          </tr>`;
        })
        .join("");
      metadataBody.innerHTML = rows
        ? `<div class="row" style="margin-bottom:6px"><strong style="font-size:11px">Metadata collection</strong>
            <span class="badge badge-info">${payload.indexSource || "sqlite"}</span>
            <span class="badge badge-ok">${payload.total ?? rows.length} rows</span></div>
          <table><thead><tr><th>Path</th><th>savedAt</th><th>Summary</th><th>runId</th></tr></thead><tbody>${rows}</tbody></table>
          <details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--blue)">Latest envelope metadata (JSON)</summary>
            <pre class="lineage-pre">${JSON.stringify((payload.entries || [])[0]?.metadata ?? {}, null, 2)}</pre>
          </details>`
        : `<span class="status warn">No indexed metadata for <code>${gate}</code>. Run <code>kimi-doctor --gate ${gate} --save-artifact</code>.</span>`;
    } catch (e) {
      metadataBody.innerHTML = `<span class="status err">${e}</span>`;
    }
  }

  function selectLineageGate(gate) {
    selectedGate = gate || "";
    syncLineageGateToUrl(selectedGate);
    for (const btn of document.querySelectorAll(".artifact-gate-pick")) {
      btn.classList.toggle("active", btn.getAttribute("data-gate") === selectedGate);
    }
    void renderLineageExplorer(selectedGate);
    void renderMetadataCollection(selectedGate);
  }

  function renderRunsTable(runs) {
    const rows = (runs || [])
      .map((row) => {
        const gates = (row.gates || []).join(", ") || "—";
        const runBtn = `<button type="button" class="artifact-run-pick" data-run-id="${row.runId}" style="background:none;border:none;padding:0;color:var(--blue);cursor:pointer;font:inherit"><code>${row.runId}</code></button>`;
        return `<tr>
            <td>${runBtn}</td>
            <td>${statusBadge(row.status)}</td>
            <td style="font-size:11px">${gates}</td>
            <td style="font-size:11px;color:var(--muted)">${row.startedAt || "—"}</td>
            <td style="font-size:11px;color:var(--muted)">${row.completedAt || "—"}</td>
            <td style="color:var(--muted);font-size:11px">${identityCell(row)}</td>
          </tr>`;
      })
      .join("");
    return rows
      ? `<table><thead><tr><th>Run</th><th>Status</th><th>Gates</th><th>Started</th><th>Completed</th><th>Identity</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<span class="status warn">No run manifests match. Save artifacts with <code>--save-artifact</code> to populate runs.</span>`;
  }

  async function renderRunDetail(runId) {
    if (!runId) return "";
    try {
      const detail = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
      const artifactRows = (detail.artifacts || [])
        .map(
          (row) => `<tr>
              <td><code>${row.gate}</code></td>
              <td>${statusBadge(row.status)}</td>
              <td><code>${(row.path || "—").replace(/^\.kimi\/artifacts\//, "")}</code></td>
              <td style="color:var(--muted);font-size:11px">${row.summary || "—"}</td>
            </tr>`
        )
        .join("");
      if (!artifactRows) return "";
      return `<details open style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:var(--blue)">Run detail — <code>${runId}</code></summary>
        <table style="margin-top:8px"><thead><tr><th>Gate</th><th>Status</th><th>Path</th><th>Summary</th></tr></thead><tbody>${artifactRows}</tbody></table>
      </details>`;
    } catch {
      return "";
    }
  }

  function renderRunDiffRows(runA, runB, gateRows) {
    const rows = (gateRows || [])
      .map((row) => {
        const pathA = row.pathA || "—";
        const pathB = row.pathB || "—";
        const tone = row.match === "equal" ? "ok" : row.match === "diff" ? "warn" : "err";
        const label = row.match === "equal" ? "equal" : row.match === "diff" ? "diff" : "missing";
        return `<tr>
            <td><code>${row.gate}</code></td>
            <td style="font-size:10px"><code>${String(pathA).replace(/^\.kimi\/artifacts\//, "")}</code></td>
            <td style="font-size:10px"><code>${String(pathB).replace(/^\.kimi\/artifacts\//, "")}</code></td>
            <td><span class="badge badge-${tone}">${label}</span></td>
          </tr>`;
      })
      .join("");
    diffBody.innerHTML = `<div class="row" style="margin-bottom:6px"><strong style="font-size:11px">Run manifest diff</strong></div>
        <table><thead><tr><th>Gate</th><th>${runA}</th><th>${runB}</th><th>Match</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function renderRunDiffFromServer(left, right, diff) {
    if (!diffBody) return;
    const runA = diff?.runA || left?.runId || "run-a";
    const runB = diff?.runB || right?.runId || "run-b";
    if (diff?.gates?.length) {
      renderRunDiffRows(runA, runB, diff.gates);
      return;
    }
    await renderRunDiff(runA, runB);
  }

  async function renderRunDiff(runA, runB) {
    if (!diffBody) return;
    diffBody.innerHTML = `Loading run diff <code>${runA}</code> vs <code>${runB}</code>…`;
    try {
      const [detailA, detailB] = await Promise.all([
        fetchJson(`/api/runs/${encodeURIComponent(runA)}`),
        fetchJson(`/api/runs/${encodeURIComponent(runB)}`),
      ]);
      const gatesA = new Map((detailA.artifacts || []).map((row) => [row.gate, row]));
      const gatesB = new Map((detailB.artifacts || []).map((row) => [row.gate, row]));
      const allGates = [...new Set([...gatesA.keys(), ...gatesB.keys()])].sort();
      const gateRows = allGates.map((gate) => {
        const a = gatesA.get(gate);
        const b = gatesB.get(gate);
        const pathA = a?.path ?? null;
        const pathB = b?.path ?? null;
        let match = "missing";
        if (pathA && pathB) match = pathA === pathB ? "equal" : "diff";
        return { gate, pathA, pathB, match };
      });
      renderRunDiffRows(runA, runB, gateRows);
    } catch (e) {
      diffBody.innerHTML = `<span class="status err">${e}</span>`;
    }
  }

  async function renderArtifactPathDiff(gate, pathA, pathB) {
    if (!diffBody) return;
    diffBody.innerHTML = `Loading artifact diff for <code>${gate}</code>…`;
    try {
      const payload = await fetchJson(
        `/api/artifacts/${encodeURIComponent(gate)}/diff?a=${encodeURIComponent(pathA)}&b=${encodeURIComponent(pathB)}`
      );
      if (!payload.ok) {
        diffBody.innerHTML = `<span class="status err">${payload.error || "Diff failed"}</span>`;
        return;
      }
      diffBody.innerHTML = `<div class="row" style="margin-bottom:6px"><strong style="font-size:11px">Artifact path diff</strong>
        <span class="badge badge-${payload.equal ? "ok" : "warn"}">${payload.equal ? "equal" : "different"}</span></div>
        <table><thead><tr><th>Path A</th><th>Path B</th><th>Hash A</th><th>Hash B</th></tr></thead><tbody>
          <tr>
            <td style="font-size:10px"><code>${String(payload.pathA).replace(/^\.kimi\/artifacts\//, "")}</code></td>
            <td style="font-size:10px"><code>${String(payload.pathB).replace(/^\.kimi\/artifacts\//, "")}</code></td>
            <td style="font-size:10px;color:var(--muted)">${payload.hashA || "—"}</td>
            <td style="font-size:10px;color:var(--muted)">${payload.hashB || "—"}</td>
          </tr>
        </tbody></table>`;
    } catch (e) {
      diffBody.innerHTML = `<span class="status err">${e}</span>`;
    }
  }

  async function renderDiffFromUrl() {
    if (!diffBody) return;
    const params = new URLSearchParams(location.search);
    const diff = params.get("diff")?.trim();
    if (!diff || !diff.includes("..")) {
      diffBody.innerHTML = "";
      return;
    }
    const splitAt = diff.indexOf("..");
    const left = diff.slice(0, splitAt).trim();
    const right = diff.slice(splitAt + 2).trim();
    if (!left || !right) {
      diffBody.innerHTML = "";
      return;
    }
    if (!left.includes("/") && !right.includes("/")) {
      await renderRunDiff(left, right);
      return;
    }
    const gate = selectedGate || params.get("lineageGate")?.trim();
    if (!gate) {
      diffBody.innerHTML =
        '<span class="status warn">Path diff requires <code>lineageGate=</code> or a selected gate row.</span>';
      return;
    }
    await renderArtifactPathDiff(gate, left, right);
  }

  function onCanvasFilterApplied(detail) {
    hydrateFromUrl();
    selectedGate = new URLSearchParams(location.search).get("lineageGate") || selectedGate;
    if (detail?.canvasId === ARTIFACT_LINEAGE_CANVAS) {
      document
        .getElementById("card-artifacts")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    void refresh();
  }

  async function refresh() {
    if (!body) return;
    try {
      const filterParams = queryParams();
      const runQ = filterParams.toString();
      const runSuffix = runQ ? `?${runQ}` : "";
      const artifactSuffix = artifactQuerySuffix(filterParams);
      const [opts, artifactsPayload, runsPayload] = await Promise.all([
        fetchJson("/api/artifacts/filter-options"),
        fetchJson(`/api/artifacts${artifactSuffix}`),
        runsBody ? fetchJson(`/api/runs${runSuffix}`) : Promise.resolve({ runs: [] }),
      ]);
      const fo = opts.filterOptions || {};
      fillList(lists.sessionIds, fo.sessionIds);
      fillList(lists.workspaceIds, fo.workspaceIds);
      fillList(lists.paneIds, fo.paneIds);
      fillList(lists.agentIds, fo.agentIds);
      fillList(lists.runIds, fo.runIds);

      body.innerHTML = renderArtifactsTable(artifactsPayload.artifacts);
      if (runsBody) {
        const runs = runsPayload.runs || [];
        const activeRunId = fields.runId?.value?.trim();
        const detailHtml = activeRunId ? await renderRunDetail(activeRunId) : "";
        runsBody.innerHTML = renderRunsTable(runs) + detailHtml;
      }
      if (!selectedGate && (artifactsPayload.artifacts || []).some((r) => (r.count ?? 0) > 0)) {
        selectedGate =
          (artifactsPayload.artifacts || []).find((r) => (r.count ?? 0) > 0)?.gate || "";
      }
      if (selectedGate) {
        void renderLineageExplorer(selectedGate);
        void renderMetadataCollection(selectedGate);
      }
      markDiffPickRows();
      void renderDiffFromUrl();
      window.dispatchEvent(
        new CustomEvent("artifact-dashboard-refresh", {
          detail: { artifacts: artifactsPayload.artifacts || [] },
        })
      );
    } catch (e) {
      body.innerHTML = `<span class="status err">${e}</span>`;
      if (runsBody) runsBody.innerHTML = `<span class="status err">${e}</span>`;
    }
  }

  body?.addEventListener("click", (e) => {
    const gateBtn = e.target.closest(".artifact-gate-pick");
    if (!gateBtn) return;
    const gate = gateBtn.getAttribute("data-gate") || "";
    const path = gateBtn.getAttribute("data-gate-path") || "";
    if (e.shiftKey && path) {
      if (diffPickGatePath && diffPickGatePath !== path) {
        syncDiffParam(`${diffPickGatePath}..${path}`);
        if (!selectedGate && gate) selectLineageGate(gate);
        diffPickGatePath = null;
        markDiffPickRows();
        void renderDiffFromUrl();
        return;
      }
      diffPickGatePath = path;
      markDiffPickRows();
      return;
    }
    selectLineageGate(gate);
  });

  runsBody?.addEventListener("click", (e) => {
    const btn = e.target.closest(".artifact-run-pick");
    if (!btn) return;
    const runId = btn.getAttribute("data-run-id") || "";
    if (e.shiftKey) {
      if (diffPickRunId && diffPickRunId !== runId) {
        syncDiffParam(`${diffPickRunId}..${runId}`);
        diffPickRunId = null;
        markDiffPickRows();
        void renderDiffFromUrl();
        return;
      }
      diffPickRunId = runId;
      markDiffPickRows();
      return;
    }
    if (!fields.runId) return;
    fields.runId.value = runId;
    syncUrlFromFields();
    void refresh();
  });

  document.getElementById("artifact-filter-apply")?.addEventListener("click", () => {
    syncUrlFromFields();
    void refresh();
  });
  document.getElementById("artifact-filter-clear")?.addEventListener("click", () => {
    for (const input of Object.values(fields)) {
      if (input) input.value = "";
    }
    syncUrlFromFields();
    void refresh();
  });

  window.addEventListener("popstate", () => {
    hydrateFromUrl();
    selectedGate = new URLSearchParams(location.search).get("lineageGate") || selectedGate;
    void renderDiffFromUrl();
    void refresh();
  });

  hydrateFromUrl();
  if (selectedGate) void renderLineageExplorer(selectedGate);
  void renderDiffFromUrl();
  void refresh();
})();

// Bun Docs MCP — live search
(async () => {
  const root = document.getElementById("card-bun-docs");
  if (!root) return;
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  try {
    const meta = await fetchJson("/api/bun-docs");
    let h = `<div class="row"><span>Server</span><span class="badge badge-ok">${esc(meta.server)}</span></div>`;
    h += `<div class="row"><span>Tools</span><span class="badge ${meta.stability?.stable ? "badge-ok" : "badge-warn"}">${meta.toolCount}/${meta.expectedToolCount}</span></div>`;
    h += `<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">`;
    h += `<input id="bun-docs-q" placeholder="Search Bun docs…" style="flex:1;min-width:120px;font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg)">`;
    h += `<select id="bun-docs-tool" style="font-size:10px"><option value="search_bun">search</option><option value="query_docs_filesystem_bun">fs</option></select>`;
    h += `<button id="bun-docs-go" type="button" style="font-size:10px;padding:4px 8px">Go</button>`;
    h += `<button id="bun-docs-webview" type="button" style="font-size:10px;padding:4px 8px">WebView</button>`;
    h += `</div><pre id="bun-docs-out" style="font-size:10px;max-height:200px;overflow:auto;margin-top:6px;color:var(--muted)">Enter a query…</pre>`;
    card("card-bun-docs", h);
    const go = () => {
      const q = document.getElementById("bun-docs-q")?.value?.trim();
      const tool = document.getElementById("bun-docs-tool")?.value || "search_bun";
      const out = document.getElementById("bun-docs-out");
      if (!q || !out) return;
      out.textContent = "Searching…";
      const body = tool === "query_docs_filesystem_bun" ? { command: q, tool } : { query: q, tool };
      fetch("/api/bun-docs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((d) => {
          out.textContent = d.ok ? d.text || "(empty)" : d.error || "failed";
        })
        .catch((e) => {
          out.textContent = e.message;
        });
    };
    const openWebView = () => {
      const q = document.getElementById("bun-docs-q")?.value?.trim();
      const tool = document.getElementById("bun-docs-tool")?.value || "search_bun";
      const out = document.getElementById("bun-docs-out");
      if (!q || !out) return;
      out.textContent = "Opening WebView…";
      const body = { query: q, tool };
      fetch("/api/bun-docs/webview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((d) => {
          out.textContent = d.ok ? `WebView opened (pid ${d.pid})` : d.error || "failed";
        })
        .catch((e) => {
          out.textContent = e.message;
        });
    };
    document.getElementById("bun-docs-go")?.addEventListener("click", go);
    document.getElementById("bun-docs-webview")?.addEventListener("click", openWebView);
    document.getElementById("bun-docs-q")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
  } catch (e) {
    card("card-bun-docs", `<p class="status err">${esc(e.message)}</p>`);
  }
})();
