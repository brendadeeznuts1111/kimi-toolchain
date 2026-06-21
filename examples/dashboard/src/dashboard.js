/** Dashboard card loaders — one async IIFE per card panel. Requires dashboard-core.js. */

// Bundle
(async () => {
  try {
    const d = await fetchJson("/api/bundle"),
      bg = d.bundleGate || d,
      s = bg.summary;
    if (!s) {
      card("card-bundle", "<p class='status err'>No data</p>");
      return;
    }
    const nmPct =
      s.totalBytes > 0 ? ((s.nodeModulesBytes / s.totalBytes) * 100).toFixed(0) : 0;
    let h = `<div class="row"><span>Total</span><strong>${(s.totalBytes / 1048576).toFixed(1)} MB</strong></div>`;
    h += `<div class="row"><span>node_modules</span><strong>${nmPct}% (${s.nodeModulesFiles} files)</strong></div>`;
    if (bg.largestModules) {
      h += "<table><tr><th>Module</th><th>Size</th><th>%</th></tr>";
      for (const m of bg.largestModules.slice(0, 5)) {
        const n = m.module.length > 50 ? "…" + m.module.slice(-47) : m.module;
        h += `<tr><td>${n}</td><td>${(m.outputBytes / 1048576).toFixed(2)} MB</td><td>${m.pctOfTotal.toFixed(1)}%</td></tr>`;
      }
      h += "</table>";
    }
    if (bg.findings)
      for (const f of bg.findings)
        h += `<p class="status ${f.severity === "error" ? "err" : f.severity === "warn" ? "warn" : "ok"}">${f.severity.toUpperCase()}: ${f.message}</p>`;
    card("card-bundle", h);
  } catch (e) {
    card("card-bundle", `<p class="status err">${e.message}</p>`);
  }
})();

// Compile
(async () => {
  try {
    const d = await fetchJson("/api/compile"),
      cc = d.compileCheck,
      caps = cc.capabilities;
    let h = `<div class="row"><span>Bun</span><strong>${caps.bunVersion}</strong></div>`;
    h += `<div class="row"><span>ESM+bytecode</span><span class="badge ${caps.esmBytecode ? "badge-ok" : "badge-err"}">${caps.esmBytecode ? "SUPPORTED" : "NO"}</span></div>`;
    h += `<div class="row"><span>Format</span><span class="badge badge-info">${caps.recommendedFormat}</span></div>`;
    h += `<div class="row"><span>cpu-prof-md</span><span class="badge ${caps.cpuProfMd ? "badge-ok" : "badge-err"}">${caps.cpuProfMd ? "✓" : "✗"}</span></div>`;
    h += `<div class="row"><span>Gate</span><span class="badge ${cc.gate.status === "ok" ? "badge-ok" : "badge-err"}">${cc.gate.status.toUpperCase()}</span></div>`;
    if (cc.gate.messages)
      for (const m of cc.gate.messages.slice(0, 2)) h += `<p class="status ok">${m}</p>`;
    card("card-compile", h);
  } catch (e) {
    card("card-compile", `<p class="status err">${e.message}</p>`);
  }
})();

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
      for (const v of eg.violations.slice(0, 3))
        h += `<p class="status err">${v.message}</p>`;
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

// Bunfig policy — config surface for the bunfig-policy gate
(async () => {
  try {
    const d = await fetchJson("/api/bunfig");
    const sections = d.sections || {};
    const install = sections.install || {};
    const define = sections.define || {};
    let h = `<div class="row"><span>Policy file</span><code>${d.path || "./bunfig.toml"}</code></div>`;
    h += `<div class="row"><span>Sections</span><strong>${Object.keys(sections).length}</strong></div>`;
    h += `<div class="row"><span>Defines</span><strong>${Object.keys(define).length}</strong></div>`;
    h += `<div class="row"><span>Frozen lockfile</span><span class="badge ${install.frozenLockfile === false ? "badge-warn" : "badge-ok"}">${install.frozenLockfile === false ? "OFF" : "ON"}</span></div>`;
    h += `<div class="row"><span>Linker</span><code>${install.linker || "default"}</code></div>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:6px">${d.mergeRule || "global → project → CLI"}</p>`;
    card("card-bunfig-policy", h);
  } catch (e) {
    card("card-bunfig-policy", `<p class="status err">${e.message}</p>`);
  }
})();

// Markdown — dynamic, rendered server-side via Bun.markdown.html()
(async () => {
  try {
    const res = await fetch("/api/markdown/html");
    const html = await res.text();
    card(
      "card-markdown",
      `<div style="font-size:12px;line-height:1.5;max-height:420px;overflow-y:auto">${html}</div>`
    );
  } catch (e) {
    card("card-markdown", `<p class="status err">${e.message}</p>`);
  }
})();

// Build Info
(async () => {
  try {
    const d = await fetchJson("/api/build-info");
    let h = "";
    // Compile-time table
    h += `<p style="color:var(--blue);margin:4px 0">Table 1 — Compile-time (bunfig + git)</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Key</th><th>Value</th></tr>`;
    let i = 0;
    for (const [k, v] of Object.entries(d.compileTime)) {
      i++;
      h += `<tr><td class="num">${i}.</td><td>${k}</td><td><code style="font-size:11px">${v}</code></td></tr>`;
    }
    h += `</table>`;
    // Defines table — dynamic from real bunfig.toml [define]
    h += `<p style="color:var(--blue);margin:8px 0 4px">Table 2 — Active defines — ${d.definesSource}</p>`;
    if (d.defines) {
      h += `<table class="tbl"><tr><th>#</th><th>Identifier</th><th>Rewrites to</th></tr>`;
      let j = 0;
      for (const [k, v] of Object.entries(d.defines)) {
        j++;
        h += `<tr><td class="num">${j}.</td><td><code>${k}</code></td><td><span class="badge badge-ok">${v}</span></td></tr>`;
      }
      h += `</table>`;
    } else {
      h += `<p class="status warn" style="font-size:11px">No [define] entries in ${d.bunfigPath || "bunfig.toml"}. Add to see AST-level rewrites here.</p>`;
    }
    // Runtime table
    h += `<p style="color:var(--blue);margin:8px 0 4px">Table 3 — Runtime</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Key</th><th>Value</th></tr>`;
    let k = 0;
    for (const [key, val] of Object.entries(d.runtime)) {
      k++;
      h += `<tr><td class="num">${k}.</td><td>${key}</td><td><span class="badge badge-ok">${val}</span></td></tr>`;
    }
    h += `</table>`;
    h += `<p class="status ok" style="margin-top:4px">${d.note}</p>`;
    card("card-build", h);
  } catch (e) {
    card("card-build", `<p class="status err">${e.message}</p>`);
  }
})();
(async () => {
  try {
    const d = await fetchJson("/api/console-depth");
    const inspectRes = await fetch("/api/inspect");
    const inspectText = await inspectRes.text();
    let h = `<div class="row"><span>Depth</span><span class="badge badge-info">${d.configuredDepth}</span></div>`;
    h += `<div style="margin-top:8px;font-size:12px;background:var(--border);padding:8px;border-radius:4px;overflow-x:auto">`;
    h += `<code style="white-space:pre">${inspectText.replace(/</g, "&lt;")}</code>`;
    h += `</div>`;
    h += `<p class="status ok" style="margin-top:4px">Bun.inspect() serializes like console.log</p>`;
    // Add canonical examples from docs
    const simpleRes = await fetch("/api/inspect-simple");
    const simpleText = await simpleRes.text();
    // Config summary
    const cfg = await fetchJson("/api/inspect-config");
    h += `<details style="margin-top:8px"><summary style="color:var(--blue);cursor:pointer;font-size:11px">Config (preset: ${cfg.preset})</summary>`;
    h += `<table class="tbl"><tr><th>#</th><th>Option</th><th>Value</th></tr>`;
    Object.entries(cfg.config).forEach((kv, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td>${kv[0]}</td><td><code>${kv[1]}</code></td></tr>`;
    });
    h += `</table><p style="font-size:10px;color:var(--muted);margin-top:4px">TTY:${cfg.detected.isTTY} | CI:${cfg.detected.CI} | NODE_ENV=${cfg.detected.NODE_ENV} | DEBUG_INSPECT=${cfg.detected.DEBUG_INSPECT}</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Environment</th><th>depth</th><th>compact</th><th>colors</th></tr>`;
    cfg.presets.forEach((p, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td>${p.environment}</td><td>${p.depth}</td><td><span class="badge ${p.compact ? "badge-ok" : "badge-warn"}">${p.compact}</span></td><td><span class="badge ${p.colors ? "badge-ok" : "badge-warn"}">${p.colors}</span></td></tr>`;
    });
    h += `</table></details>`;
    h += `<div style="margin-top:8px;font-size:12px;background:var(--border);padding:8px;border-radius:4px;overflow-x:auto">`;
    h += `<code style="white-space:pre;color:var(--muted)">${simpleText.replace(/</g, "&lt;")}</code>`;
    h += `</div>`;
    card("card-depth", h);
  } catch (e) {
    card("card-depth", `<p class="status err">${e.message}</p>`);
  }
})();

// Inspect Table
(async () => {
  try {
    const res = await fetch("/api/inspect-table");
    const text = await res.text();
    card(
      "card-inspect-table",
      `<pre style="font-size:10px;background:var(--border);padding:6px;border-radius:4px;overflow-x:auto;max-height:320px;line-height:1.3"><code>${text.replace(/</g, "&lt;")}</code></pre>`
    );
  } catch (e) {
    card("card-inspect-table", `<p class="status err">${e.message}</p>`);
  }
})();

// Semver
(async () => {
  try {
    const d = await fetchJson("/api/semver");
    let h = `<p style="color:var(--blue);margin:4px 0">Bun.semver.order()</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>a</th><th>b</th><th>result</th></tr>`;
    d.order.forEach((r, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td>${r.a}</td><td>${r.b}</td><td><span class="badge badge-${r.result === 0 ? "info" : "ok"}">${r.meaning}</span></td></tr>`;
    });
    h += `</table>`;
    h += `<p style="color:var(--blue);margin:8px 0 4px">Bun.semver.satisfies()</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>version</th><th>range</th><th>satisfies</th></tr>`;
    d.satisfies.forEach((r, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td>${r.version}</td><td><code>${r.range}</code></td><td><span class="badge badge-${r.satisfies ? "ok" : "err"}">${r.satisfies}</span></td></tr>`;
    });
    h += `</table>`;
    card("card-semver", h);
  } catch (e) {
    card("card-semver", `<p class="status err">${e.message}</p>`);
  }
})();

// Deep Equals
(async () => {
  try {
    const d = await fetchJson("/api/deep-equals");
    let h = `<table class="tbl"><tr><th>#</th><th>a</th><th>b</th><th>equal</th></tr>`;
    d.cases.forEach((c, i) => {
      const a = JSON.stringify(c.a);
      const b = JSON.stringify(c.b);
      h += `<tr><td class="num">${i + 1}.</td><td style="font-size:10px">${a}</td><td style="font-size:10px">${b}</td><td><span class="badge badge-${c.equal ? "ok" : "err"}">${c.equal ? "✓" : "✗"}</span></td></tr>`;
    });
    h += `</table>`;
    h += `<p class="status ok" style="margin-top:4px">${d.note}</p>`;
    card("card-deep-equals", h);
  } catch (e) {
    card("card-deep-equals", `<p class="status err">${e.message}</p>`);
  }
})();

// Nanoseconds
(async () => {
  try {
    const d = await fetchJson("/api/nanoseconds");
    let h = `<div class="row"><span>Elapsed</span><strong style="color:var(--green)">${d.elapsed.toLocaleString()} ns</strong></div>`;
    h += `<div class="row"><span>Unit</span><span class="badge badge-info">${d.unit}</span></div>`;
    h += `<p class="status ok" style="margin-top:4px">${d.note}</p>`;
    card("card-nanoseconds", h);
  } catch (e) {
    card("card-nanoseconds", `<p class="status err">${e.message}</p>`);
  }
})();

// Sleep
(async () => {
  try {
    const d = await fetchJson("/api/sleep");
    let h = `<div class="row"><span>Requested</span><span class="badge badge-info">${d.requested}</span></div>`;
    h += `<div class="row"><span>Actual</span><strong style="color:var(--green)">${d.actual}</strong></div>`;
    h += `<p class="status ok" style="margin-top:4px">${d.note}</p>`;
    card("card-sleep", h);
  } catch (e) {
    card("card-sleep", `<p class="status err">${e.message}</p>`);
  }
})();

// new Console() → Bun.inspect options compare
(async () => {
  try {
    const d = await fetchJson("/api/console");
    const opts = Object.entries(d.inspectOptions)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    let h = `<p style="color:var(--blue);margin-bottom:4px;font-size:11px">inspectOptions: { ${opts} }</p>`;
    h += `<p style="font-size:11px;color:var(--muted);margin:2px 0">Default (depth=2, compact, unsorted):</p>`;
    h += `<pre style="font-size:10px;background:var(--border);padding:6px;border-radius:4px;overflow-x:auto;max-height:120px">${d.defaultOutput.replace(/</g, "&lt;")}</pre>`;
    h += `<p style="font-size:11px;color:var(--muted);margin:6px 0 2px">Custom (depth=4, expanded, sorted):</p>`;
    h += `<pre style="font-size:10px;background:var(--border);padding:6px;border-radius:4px;overflow-x:auto;max-height:140px">${d.customOutput.replace(/</g, "&lt;")}</pre>`;
    card("card-console", h);
  } catch (e) {
    card("card-console", `<p class="status err">${e.message}</p>`);
  }
})();

// TTY Detection
(async () => {
  try {
    const d = await fetchJson("/api/tty");
    let h = `<div class="row"><span>isTTY</span><span class="badge ${d.isTTY ? "badge-ok" : "badge-warn"}">${d.isTTY}</span></div>`;
    h += `<div class="row"><span>isCI</span><span class="badge ${d.isCI ? "badge-warn" : "badge-ok"}">${d.isCI}</span></div>`;
    h += `<div class="row"><span>Dimensions</span><span style="font-size:11px">${d.dimensions.columns ?? "—"}×${d.dimensions.rows ?? "—"}</span></div>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:4px">TERM=${d.terminal.TERM}  COLORTERM=${d.terminal.COLORTERM}  NO_COLOR=${d.terminal.NO_COLOR}</p>`;
    h += `<p class="status ok" style="margin-top:4px;font-size:10px">${d.inspect.note}</p>`;
    card("card-tty", h);
  } catch (e) {
    card("card-tty", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.Terminal
(async () => {
  try {
    const d = await fetchJson("/api/terminal");
    if (d.error) {
      card(
        "card-terminal",
        `<p class="status warn">${d.error}<br><span style="font-size:10px;color:var(--muted)">${d.note}</span></p>`
      );
      return;
    }
    let h = `<div class="row"><span>Dimensions</span><strong>${d.dimensions.cols}×${d.dimensions.rows}</strong></div>`;
    h += `<div class="row"><span>Closed</span><span class="badge badge-${d.closed ? "ok" : "warn"}">${d.closed}</span></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">termios flags</p>`;
    h += `<table class="tbl"><tr><th>Flag</th><th>Default</th><th>Raw</th></tr>`;
    h += `<tr><td>control</td><td><code>${d.flags.controlFlags}</code></td><td><code>${d.rawModeFlags?.rawControl || "—"}</code></td></tr>`;
    h += `<tr><td>input</td><td><code>${d.flags.inputFlags}</code></td><td>—</td></tr>`;
    h += `<tr><td>local</td><td><code>${d.flags.localFlags}</code></td><td><code>${d.rawModeFlags?.rawLocal || "—"}</code></td></tr>`;
    h += `<tr><td>output</td><td><code>${d.flags.outputFlags}</code></td><td>—</td></tr>`;
    h += `</table>`;
    if (d.output)
      h += `<p style="font-size:11px;margin-top:4px">output: <code>${d.output.replace(/</g, "&lt;")}</code></p>`;
    card("card-terminal", h);
  } catch (e) {
    card("card-terminal", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.color
(async () => {
  try {
    const d = await fetchJson("/api/color");
    let h = `<table class="tbl"><tr><th>#</th><th>Input</th><th>→</th><th>Result</th></tr>`;
    d.conversions.forEach((c, i) => {
      const swatch = c.input.startsWith("#")
        ? `<span style="display:inline-block;width:10px;height:10px;background:${c.input};border-radius:2px;margin-right:4px"></span>`
        : "";
      h += `<tr><td class="num">${i + 1}.</td><td>${swatch}${c.input}</td><td><span class="badge badge-info">${c.to}</span></td><td><code>${c.result}</code></td></tr>`;
    });
    h += `</table>`;
    h += `<p class="status ok" style="margin-top:4px;font-size:10px">${d.note}</p>`;
    card("card-color", h);
  } catch (e) {
    card("card-color", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.peek
(async () => {
  try {
    const d = await fetchJson("/api/peek");
    let h = `<table class="tbl"><tr><th>#</th><th>Promise</th><th>status</th><th>peek()</th></tr>`;
    h += `<tr><td class="num">1.</td><td>pending</td><td><span class="badge badge-warn">${d.pending.status}</span></td><td><code>${JSON.stringify(d.pending.value)}</code></td></tr>`;
    h += `<tr><td class="num">2.</td><td>fulfilled</td><td><span class="badge badge-ok">${d.fulfilled.status}</span></td><td><code>${JSON.stringify(d.fulfilled.value)}</code></td></tr>`;
    h += `</table>`;
    h += `<p class="status ok" style="margin-top:4px;font-size:10px">${d.note}</p>`;
    card("card-peek", h);
  } catch (e) {
    card("card-peek", `<p class="status err">${e.message}</p>`);
  }
})();

// node:http2
(async () => {
  try {
    const d = await fetchJson("/api/http2");
    if (d.error) {
      card(
        "card-http2",
        `<p class="status warn">${d.error}<br><span style="font-size:10px;color:var(--muted)">${d.note || ""}</span></p>`
      );
      return;
    }
    let h = `<div class="row"><span>Port</span><strong>${d.h2Port}</strong></div>`;
    h += `<div class="row"><span>ALPN</span><span class="badge badge-info">${d.session.alpnProtocol}</span></div>`;
    h += `<div class="row"><span>Response</span><code>${d.session.responseBody}</code></div>`;
    if (d.session.remoteSettings) {
      h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">remoteSettings</p>`;
      h += `<code style="font-size:10px;display:block;max-height:80px;overflow-y:auto">${JSON.stringify(d.session.remoteSettings)}</code>`;
    }
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Server origins</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Origin</th></tr>`;
    d.origins.forEach((o, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code>${o}</code></td></tr>`;
    });
    h += `</table>`;
    card("card-http2", h);
  } catch (e) {
    card("card-http2", `<p class="status err">${e.message}</p>`);
  }
})();

// URL / URLSearchParams
(async () => {
  try {
    const d = await fetchJson("/api/url");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:4px">Parsed URL</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Property</th><th>Value</th></tr>`;
    let i = 0;
    for (const [k, v] of Object.entries(d.properties)) {
      i++;
      const val = v || '<span style="color:var(--muted)">""</span>';
      h += `<tr><td class="num">${i}.</td><td><code>${k}</code></td><td style="font-size:10px">${val}</td></tr>`;
    }
    h += `</table>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">URLSearchParams</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Method</th><th>Result</th></tr>`;
    const spEntries = [
      ["get('q')", d.searchParams.get_q],
      ["getAll('q')", JSON.stringify(d.searchParams.getAll_q)],
      ["has('lang')", d.searchParams.has_lang],
      ["size", d.searchParams.size],
      ["toString()", d.searchParams.toString],
    ];
    spEntries.forEach((kv, j) => {
      h += `<tr><td class="num">${j + 1}.</td><td><code>${kv[0]}</code></td><td style="font-size:10px">${kv[1]}</td></tr>`;
    });
    h += `</table>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Static methods</p>`;
    h += `<div class="row"><span>canParse(valid)</span><span class="badge badge-${d.staticMethods.canParse.valid ? "ok" : "err"}">${d.staticMethods.canParse.valid}</span></div>`;
    h += `<div class="row"><span>canParse(invalid)</span><span class="badge badge-${d.staticMethods.canParse.invalid ? "ok" : "err"}">${d.staticMethods.canParse.invalid}</span></div>`;
    if (d.staticMethods.parse.withBase) {
      h += `<div class="row"><span>parse(+base)</span><code style="font-size:10px">${d.staticMethods.parse.withBase.href}</code></div>`;
    }
    h += `<div class="row"><span>parse(invalid)</span><code>${d.staticMethods.parse.invalid}</code></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Relative resolution</p>`;
    h += `<code style="font-size:10px">new URL("${d.relativeResolution.input}", "${d.relativeResolution.base}") → ${d.relativeResolution.result}</code>`;
    if (d.i18n) {
      h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 2px">IDN / Punycode <span class="badge badge-${d.i18n.ok ? "ok" : "err"}">${d.i18n.gate}</span></p>`;
      h += `<table class="tbl"><tr><th>#</th><th>Domain</th><th>ASCII</th><th>Display</th><th>OK</th></tr>`;
      (d.i18n.domains || []).forEach((row, j) => {
        const ok =
          row.idempotent && row.roundtrip && (row.punycodePrefixCorrect ?? row.punycodeEncoded);
        h += `<tr><td class="num">${j + 1}.</td><td><code>${row.domain}</code></td><td style="font-size:10px">${row.ascii}</td><td style="font-size:10px">${row.display}</td><td><span class="badge badge-${ok ? "ok" : "err"}">${ok ? "pass" : "fail"}</span></td></tr>`;
      });
      h += `</table>`;
      if ((d.i18n.labels || []).length) {
        h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 2px">punycode.encode / decode (per label)</p>`;
        h += `<table class="tbl"><tr><th>#</th><th>Unicode</th><th>encode()</th><th>xn-- label</th></tr>`;
        (d.i18n.labels || []).forEach((row, j) => {
          h += `<tr><td class="num">${j + 1}.</td><td><code>${row.unicode}</code></td><td style="font-size:10px">${row.encoded}</td><td style="font-size:10px">${row.asciiLabel}</td></tr>`;
        });
        h += `</table>`;
      }
      h += `<p style="font-size:10px;color:var(--muted);margin-top:4px">SSOT: url-decomposer.ts · encode · toASCII · decode · gate: kimi-doctor --gate url-i18n</p>`;
    }
    if (d.emailI18n) {
      h += `<p style="font-size:11px;color:var(--blue);margin:8px 0 2px">Email i18n <span class="badge badge-${d.emailI18n.ok ? "ok" : "err"}">email-i18n</span> <span class="badge badge-info">${d.emailI18n.summary?.passed ?? 0}/${d.emailI18n.summary?.total ?? 0}</span></p>`;
      h += `<table class="tbl"><tr><th>#</th><th>Email</th><th>ASCII domain</th><th>Local UTF-8</th><th>Status</th></tr>`;
      (d.emailI18n.emails || []).forEach((row, j) => {
        const tone =
          row.status === "pass" ? "ok" : row.status === "invalid" ? "warn" : "err";
        h += `<tr><td class="num">${j + 1}.</td><td><code style="font-size:10px">${row.email || "—"}</code></td><td style="font-size:10px">${row.asciiDomain || "—"}</td><td><span class="badge badge-${row.localHasUnicode ? "info" : "neutral"}">${row.localHasUnicode ? "unicode" : "ascii"}</span></td><td><span class="badge badge-${tone}">${row.status}${row.ok ? "" : " · mismatch"}</span></td></tr>`;
      });
      h += `</table>`;
      if ((d.emailI18n.limitations || []).length) {
        h += `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:var(--muted)">Limitations (${d.emailI18n.limitations.length})</summary><ul style="margin:6px 0 0 16px;font-size:10px;color:var(--muted)">${(d.emailI18n.limitations || []).map((line) => `<li>${line}</li>`).join("")}</ul></details>`;
      }
      h += `<p style="font-size:10px;color:var(--muted);margin-top:4px">SSOT: email-i18n.ts · local≤64B · domain≤253B · gate: kimi-doctor --gate email-i18n</p>`;
    }
    card("card-url", h);
  } catch (e) {
    card("card-url", `<p class="status err">${e.message}</p>`);
  }
})();

// node:url
(async () => {
  try {
    const d = await fetchJson("/api/url-node");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:4px">domainToASCII / domainToUnicode</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Input</th><th>ASCII (Punycode)</th><th>Unicode</th></tr>`;
    d.idn.forEach((r, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td>${r.input}</td><td><code style="font-size:10px">${r.ascii}</code></td><td>${r.unicode}</td></tr>`;
    });
    h += `</table>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">fileURLToPath / pathToFileURL</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Step</th><th>Result</th></tr>`;
    h += `<tr><td class="num">1.</td><td>pathToFileURL</td><td><code style="font-size:10px">${d.fileRoundtrip.url}</code></td></tr>`;
    h += `<tr><td class="num">2.</td><td>fileURLToPath</td><td><code style="font-size:10px">${d.fileRoundtrip.backToPath}</code></td></tr>`;
    h += `</table>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">url.format()</p>`;
    h += `<code style="font-size:10px;display:block">${d.format.result}</code>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">urlToHttpOptions</p>`;
    h += `<code style="font-size:10px;display:block;max-height:60px;overflow-y:auto">${JSON.stringify(d.urlToHttpOptions)}</code>`;
    card("card-url-node", h);
  } catch (e) {
    card("card-url-node", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.password
(async () => {
  try {
    const d = await fetchJson("/api/password");
    let h = `<div class="row"><span>Algorithm</span><span class="badge badge-info">${d.algorithm}</span></div>`;
    h += `<div class="row"><span>Hash</span><code style="font-size:10px">${d.hash}</code></div>`;
    h += `<div class="row"><span>Length</span><strong>${d.fullHashLength}</strong> chars</div>`;
    h += `<div class="row"><span>Correct pw</span><span class="badge badge-${d.verify.correct ? "ok" : "err"}">${d.verify.correct ? "✓" : "✗"}</span></div>`;
    h += `<div class="row"><span>Wrong pw</span><span class="badge badge-${d.verify.wrong ? "ok" : "err"}">${d.verify.wrong ? "✓" : "✗"}</span></div>`;
    h += `<div class="row"><span>Hash time</span><span style="font-size:11px">${d.timing.hashMs.toFixed(2)}ms</span></div>`;
    card("card-password", h);
  } catch (e) {
    card("card-password", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.CryptoHasher
(async () => {
  try {
    const d = await fetchJson("/api/crypto-hash");
    let h = `<div class="row"><span>SHA-256 (incr)</span><code style="font-size:9px">${d.sha256.hex.slice(0, 24)}…</code></div>`;
    h += `<div class="row"><span>SHA-512</span><code style="font-size:9px">${d.sha512.hex}</code></div>`;
    h += `<div class="row"><span>Bytes out</span><strong>${d.bytes.length} bytes</strong></div>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:4px">Algos: ${d.algorithms.join(", ")}</p>`;
    card("card-crypto-hash", h);
  } catch (e) {
    card("card-crypto-hash", `<p class="status err">${e.message}</p>`);
  }
})();

// bun:sqlite
(async () => {
  try {
    const d = await fetchJson("/api/sqlite");
    let h = `<div class="row"><span>Engine</span><span class="badge badge-info">${d.engine}</span></div>`;
    h += `<div class="row"><span>Rows</span><strong>${d.count}</strong></div>`;
    h += `<table class="tbl"><tr><th>id</th><th>name</th><th>email</th></tr>`;
    d.rows.forEach((r) => {
      h += `<tr><td>${r.id}</td><td>${r.name}</td><td style="font-size:10px">${r.email}</td></tr>`;
    });
    h += `</table>`;
    card("card-sqlite", h);
  } catch (e) {
    card("card-sqlite", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.write / file
(async () => {
  try {
    const d = await fetchJson("/api/file-io");
    let h = `<div class="row"><span>Write</span><span style="font-size:11px">${d.writeNs.toLocaleString()} ns</span></div>`;
    h += `<div class="row"><span>Size</span><strong>${d.read.size} bytes</strong></div>`;
    h += `<div class="row"><span>MIME</span><code>${d.read.mime}</code></div>`;
    h += `<div class="row"><span>Content</span><code style="font-size:10px">${d.read.text}</code></div>`;
    h += `<div class="row"><span>exists()</span><span class="badge badge-ok">${d.read.exists}</span></div>`;
    card("card-file-io", h);
  } catch (e) {
    card("card-file-io", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.Glob
(async () => {
  try {
    const d = await fetchJson("/api/glob");
    let h = `<p style="font-size:10px;color:var(--muted);margin-bottom:4px">cwd: ${d.cwd}</p>`;
    d.results.forEach((r) => {
      h += `<div class="row"><span><code>${r.pattern}</code></span><span class="badge badge-ok">${r.count} found</span></div>`;
      r.matches.slice(0, 3).forEach((m) => {
        h += `<code style="font-size:9px;display:block;margin-left:12px;color:var(--muted)">${m}</code>`;
      });
      if (r.matches.length > 3)
        h += `<span style="font-size:9px;margin-left:12px;color:var(--muted)">…</span>`;
    });
    card("card-glob", h);
  } catch (e) {
    card("card-glob", `<p class="status err">${e.message}</p>`);
  }
})();

// Glob Autophagy
(async () => {
  try {
    const d = await fetchJson("/api/glob-orphan");
    let h = `<div class="row"><span>Snapshots</span><strong>${d.counts.snapshots}</strong></div>`;
    h += `<div class="row"><span>Tests</span><strong>${d.counts.tests}</strong></div>`;
    h += `<div class="row"><span>Orphans</span><span class="badge badge-${d.counts.orphans ? "err" : "ok"}">${d.counts.orphans}</span></div>`;
    if (d.orphans.length > 0) {
      h += `<p style="font-size:10px;color:var(--red)">${d.orphans
        .slice(0, 3)
        .map((s) => "<code>" + s + "</code>")
        .join("<br>")}</p>`;
    }
    if (d.perPackage && d.perPackage.length > 0) {
      h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Per-package (monorepo)</p>`;
      d.perPackage.forEach((p) => {
        h += `<div class="row"><span><code style="font-size:10px">${p.package}</code></span><span class="badge badge-ok">${p.snapshots} snaps</span></div>`;
      });
    }
    h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">One-liner</summary>`;
    h += `<pre style="font-size:8px;background:var(--border);padding:4px;border-radius:4px;overflow-x:auto">${d.oneLiner.replace(/</g, "&lt;")}</pre>`;
    h += `</details>`;
    card("card-glob-orphan", h);
  } catch (e) {
    card("card-glob-orphan", `<p class="status err">${e.message}</p>`);
  }
})();

// node:util/types
(async () => {
  try {
    const d = await fetchJson("/api/util-types");
    let h = `<div class="row"><span>Functions</span><span class="badge badge-info">${d.totalFunctions}</span> <span style="font-size:10px;color:var(--muted)">is* checks</span></div>`;
    h += `<table class="tbl"><tr><th>#</th><th>Function</th><th>Checked</th><th>Result</th></tr>`;
    d.checks.forEach((c, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:10px">${c.name}</code></td><td style="font-size:10px">${c.value}</td><td><span class="badge badge-${c.result ? "ok" : "err"}">${c.result ? "✓" : "✗"}</span></td></tr>`;
    });
    h += `</table>`;
    card("card-util-types", h);
  } catch (e) {
    card("card-util-types", `<p class="status err">${e.message}</p>`);
  }
})();

// Smart Write
(async () => {
  try {
    const d = await fetchJson("/api/write-smart");
    let h = `<table class="tbl"><tr><th>#</th><th>Input</th><th>Branch</th><th>Read back</th></tr>`;
    d.results.forEach((r, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td style="font-size:10px">${r.label}</td><td><span class="badge badge-info">${r.branch}</span></td><td><code style="font-size:10px">${r.read}</code></td></tr>`;
    });
    h += `</table>`;
    card("card-write-smart", h);
  } catch (e) {
    card("card-write-smart", `<p class="status err">${e.message}</p>`);
  }
})();

// Stream Hash
(async () => {
  try {
    const d = await fetchJson("/api/stream-hash");
    let h = `<table class="tbl"><tr><th>#</th><th>Approach</th><th>SHA-256</th></tr>`;
    h += `<tr><td class="num">1.</td><td>Stream (${d.stream.chunks} chunks)</td><td><code style="font-size:9px">${d.stream.digest}</code></td></tr>`;
    h += `<tr><td class="num">2.</td><td>Whole file</td><td><code style="font-size:9px">${d.whole.digest}</code></td></tr>`;
    h += `<tr><td class="num">3.</td><td>String</td><td><code style="font-size:9px">${d.string.digest}</code></td></tr>`;
    h += `<tr><td class="num">4.</td><td>Bun.SHA256 one-liner</td><td><code style="font-size:9px">${d.bunNative.digest}</code></td></tr>`;
    h += `</table>`;
    h += `<div class="row" style="margin-top:4px"><span>All 4 match</span><span class="badge badge-${d.allMatch ? "ok" : "err"}">${d.allMatch ? "✓" : "✗"}</span></div>`;
    h += `<p class="status ok" style="margin-top:4px;font-size:10px">${d.note}</p>`;
    card("card-stream-hash", h);
  } catch (e) {
    card("card-stream-hash", `<p class="status err">${e.message}</p>`);
  }
})();

// node:http
(async () => {
  try {
    const d = await fetchJson("/api/node-http");
    let h = `<div class="row"><span>Port</span><strong>${d.port}</strong></div>`;
    h += `<div class="row"><span>Status</span><span class="badge badge-ok">${d.response.statusCode} ${d.response.statusMessage}</span></div>`;
    h += `<div class="row"><span>Body</span><code>${d.response.body}</code></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Response headers</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Header</th><th>Value</th></tr>`;
    let i = 0;
    for (const [k, v] of Object.entries(d.response.headers || {})) {
      i++;
      h += `<tr><td class="num">${i}.</td><td><code>${k}</code></td><td style="font-size:10px">${v}</td></tr>`;
    }
    h += `</table>`;
    card("card-node-http", h);
  } catch (e) {
    card("card-node-http", `<p class="status err">${e.message}</p>`);
  }
})();

// node:child_process.exec
(async () => {
  try {
    const d = await fetchJson("/api/exec");
    let h = `<table class="tbl"><tr><th>#</th><th>Command</th><th>stdout</th></tr>`;
    h += `<tr><td class="num">1.</td><td>echo hello from exec</td><td><code>${d.results.basic.stdout}</code></td></tr>`;
    h += `<tr><td class="num">2.</td><td>echo "path ..."</td><td><code>${d.results.quoted.stdout}</code></td></tr>`;
    h += `<tr><td class="num">3.</td><td>echo HOME is $HOME</td><td><code>${d.results.variableExpansion.stdout.slice(0, 30)}</code></td></tr>`;
    h += `</table>`;
    card("card-exec", h);
  } catch (e) {
    card("card-exec", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.spawn IPC
(async () => {
  try {
    const d = await fetchJson("/api/ipc");
    let h = `<div class="row"><span>Child PID</span><strong>${d.childPid}</strong></div>`;
    h += `<div class="row"><span>Serialization</span><span class="badge badge-info">${d.serialization}</span></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Message exchange</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Direction</th><th>Data</th></tr>`;
    d.messages.forEach((m, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td style="font-size:10px">${m.direction}</td><td><code style="font-size:9px">${JSON.stringify(m.data)}</code></td></tr>`;
    });
    h += `</table>`;
    h += `<p style="font-size:10px;margin-top:4px;color:var(--muted)">Parent: <code>${d.parentApi}</code><br>Child: <code>${d.childApi}</code></p>`;
    card("card-ipc", h);
  } catch (e) {
    card("card-ipc", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.spawnSync
(async () => {
  try {
    const d = await fetchJson("/api/spawn-sync");
    let h = `<div class="row"><span>stdout</span><code>${d.stdout}</code></div>`;
    h += `<div class="row"><span>exitCode</span><span class="badge badge-${d.success ? "ok" : "err"}">${d.exitCode}</span></div>`;
    h += `<div class="row"><span>PID</span><strong>${d.pid}</strong></div>`;
    if (d.resourceUsage) {
      const r = d.resourceUsage;
      h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">resourceUsage()</p>`;
      h += `<div class="row"><span>maxRSS</span><strong>${r.maxRSS}</strong></div>`;
      h += `<div class="row"><span>CPU user</span><span style="font-size:10px">${r.cpuUser}</span></div>`;
      h += `<div class="row"><span>CPU sys</span><span style="font-size:10px">${r.cpuSystem}</span></div>`;
      h += `<div class="row"><span>Msg sent/recv</span><span style="font-size:10px">${r.messages.sent}/${r.messages.received}</span></div>`;
      h += `<div class="row"><span>Ctx switches</span><span style="font-size:10px">v=${r.contextSwitches.voluntary} i=${r.contextSwitches.involuntary}</span></div>`;
    }
    card("card-spawn-sync", h);
  } catch (e) {
    card("card-spawn-sync", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.Image
(async () => {
  try {
    const d = await fetchJson("/api/image");
    let h = `<div class="row"><span>Input</span><strong>${d.input.bytes}B, ${d.input.width}×${d.input.height}</strong></div>`;
    if (d.metadata) {
      h += `<div class="row"><span>Metadata</span><span class="badge badge-info">${d.metadata.format} ${d.metadata.width}×${d.metadata.height}</span></div>`;
    }
    h += `<div class="row"><span>Pipeline</span><code style="font-size:9px">${d.pipeline.join(" → ")}</code></div>`;
    h += `<div class="row"><span>webp</span><strong>${d.output.webp.bytes}B</strong></div>`;
    h += `<div class="row"><span>png</span><strong>${d.output.png.bytes}B</strong></div>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:4px">Methods: ${d.availableMethods
      .slice(0, 6)
      .map((m) => "<code>" + m + "</code>")
      .join(" ")}</p>`;
    h += `<p class="status ok" style="margin-top:2px;font-size:10px">${d.globalStore}</p>`;
    card("card-image", h);
  } catch (e) {
    card("card-image", `<p class="status err">${e.message}</p>`);
  }
})();

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
const EFFECT_BENCHMARK_FAMILY_ORDER = [
  "crypto",
  "httpClient",
  "util",
  "image",
  "clock",
  "uuid",
];

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
  const runAt = d.generatedAt
    ? new Date(d.generatedAt).toLocaleString()
    : "—";
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
      const time = m.skipped ? "—" : `${m.actualMs.toFixed(3)}ms${effectBenchmarkRegressionBadge(m)}`;
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
  const cardId = "card-effect-benchmark";
  document
    .getElementById("effect-benchmark-refresh")
    ?.addEventListener("click", () => {
      loadEffectBenchmarkCard("/api/effect-benchmark/refresh", { loading: "Refreshing…" });
    });
  document
    .getElementById("effect-benchmark-train")
    ?.addEventListener("click", () => {
      loadEffectBenchmarkCard("/api/effect-benchmark/train", { loading: "Training…" });
    });
  document
    .getElementById("effect-benchmark-retry")
    ?.addEventListener("click", () => {
      loadEffectBenchmarkCard(retryUrl, { loading: "Retrying…" });
    });
}

async function loadEffectBenchmarkCard(
  url = "/api/effect-benchmark",
  options = {}
) {
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
      const statusTone =
        g.status === "pass" ? "ok" : g.status === "skip" ? "warn" : "err";
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

// bun pm CLI capability
(async () => {
  try {
    const d = await fetchJson("/api/bun-pm");
    if (!d.applicable) {
      card("card-bun-pm", '<p class="status warn">Not applicable outside kimi-toolchain</p>');
      return;
    }
    const cap = d.bunPmCli;
    const probeTone = d.probe?.ok ? "ok" : "err";
    let h = `<div class="row"><span>Probe</span><span class="badge badge-${probeTone}">${d.probe?.ok ? "OK" : "FAIL"}</span></div>`;
    h += `<div class="row"><span>Sections</span><strong>${cap?.subcommands?.length ?? 0}</strong></div>`;
    if (cap?.docsUrl) {
      h += `<div class="row"><span>Docs</span><a href="${cap.docsUrl}" style="font-size:9px">${cap.docsUrl}</a></div>`;
    }
    if (cap?.sections?.length) {
      h +=
        '<table class="tbl" style="margin-top:4px"><tr><th>Section</th><th>Command</th></tr>';
      for (const section of cap.sections) {
        h += `<tr><td style="font-size:9px">${section.id}</td><td style="font-size:9px">${section.command}</td></tr>`;
      }
      h += "</table>";
    }
    if (cap?.pkgOperations?.length) {
      h += '<p style="margin:6px 0 2px;font-size:10px;color:var(--muted)">pkg operations</p>';
      h += '<ul style="margin:0 0 0 16px;font-size:9px">';
      for (const op of cap.pkgOperations) {
        h += `<li><code>${op.verb}</code> — ${op.example}</li>`;
      }
      h += "</ul>";
    }
    const fetched = d.fetchedAt ? new Date(d.fetchedAt).toLocaleString() : "—";
    h += `<p class="status ok" style="margin-top:8px;font-size:10px">Fetched at ${fetched}</p>`;
    card("card-bun-pm", h);
  } catch (e) {
    card("card-bun-pm", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun Runtime capabilities
(async () => {
  try {
    const d = await fetchJson("/api/bun-runtime");
    if (!d.applicable) {
      card(
        "card-bun-runtime",
        '<p class="status warn">Not applicable outside kimi-toolchain</p>'
      );
      return;
    }
    const tone = d.aligned ? "ok" : "err";
    const label = d.aligned ? "ALIGNED" : "MISALIGNED";
    let h = `<div class="row"><span>Inventory</span><strong>${d.capabilityCount} keys</strong></div>`;
    h += `<div class="row"><span>Status</span><span class="badge badge-${tone}">${label}</span></div>`;
    if (d.runtimeApiDocs) {
      h +=
        '<div class="row" style="flex-direction:column;align-items:flex-start;gap:2px"><span>runtimeApiDocs</span>';
      h += `<a href="${d.runtimeApiDocs.globalsUrl}" style="font-size:9px">globals</a>`;
      h += `<a href="${d.runtimeApiDocs.bunApisUrl}" style="font-size:9px">bun-apis</a>`;
      h += `<a href="${d.runtimeApiDocs.webApisUrl}" style="font-size:9px">web-apis</a>`;
      if (d.runtimeApiDocs.apiReferenceUrl) {
        h += `<a href="${d.runtimeApiDocs.apiReferenceUrl}" style="font-size:9px">reference/bun</a>`;
      }
      if (d.runtimeApiDocs.docsRssUrl) {
        h += `<a href="${d.runtimeApiDocs.docsRssUrl}" style="font-size:9px">docs rss</a>`;
      }
      h += "</div>";
    }
    if (d.fixPlan?.length) {
      h += `<ul style="margin:4px 0 0 16px;font-size:10px;color:var(--muted)">${d.fixPlan
        .map((f) => `<li>${f}</li>`)
        .join("")}</ul>`;
    }
    h +=
      '<table class="tbl" style="margin-top:4px"><tr><th>Check</th><th>Status</th></tr>';
    for (const c of d.checks ?? []) {
      const statusTone = c.status === "ok" ? "ok" : "err";
      h += `<tr><td style="font-size:9px">${c.name}</td><td><span class="badge badge-${statusTone}">${c.status}</span></td></tr>`;
    }
    h += "</table>";
    const fetched = d.fetchedAt ? new Date(d.fetchedAt).toLocaleString() : "—";
    h += `<p class="status ok" style="margin-top:8px;font-size:10px">Fetched at ${fetched}</p>`;
    card("card-bun-runtime", h);
  } catch (e) {
    card("card-bun-runtime", `<p class="status err">${e.message}</p>`);
  }
})();

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

// kimi publish
(async () => {
  try {
    const d = await fetchJson("/api/kimi-publish");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">Pipeline (${d.pipeline.length} steps)</p>`;
    d.pipeline.forEach((s, i) => {
      h += `<code style="font-size:9px;display:block;margin-left:8px;color:var(--muted)">${s}</code>`;
    });
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Flags</p>`;
    h += `<table class="tbl"><tr><th>Flag</th><th>Purpose</th></tr>`;
    d.flags.forEach((f) => {
      h += `<tr><td><code style="font-size:10px">${f.flag}</code></td><td style="font-size:10px">${f.description}</td></tr>`;
    });
    h += `</table>`;
    card("card-kimi-publish", h);
  } catch (e) {
    card("card-kimi-publish", `<p class="status err">${e.message}</p>`);
  }
})();

// Scaffold
(async () => {
  try {
    const d = await fetchJson("/api/scaffold");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">Architecture</p>`;
    Object.entries(d.architecture).forEach(([k, v]) => {
      h += `<div class="row"><span style="font-size:9px">${k}</span><code style="font-size:9px">${v.file}</code></div>`;
    });
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Generated scripts</p>`;
    h += `<table class="tbl"><tr><th>Script</th><th>Command</th></tr>`;
    Object.entries(d.scripts).forEach(([k, v]) => {
      h += `<tr><td><code style="font-size:9px">${k}</code></td><td><code style="font-size:8px">${v}</code></td></tr>`;
    });
    h += `</table>`;
    h += `<p style="font-size:10px;color:var(--muted);margin-top:4px"><code>${d.example.command}</code></p>`;
    card("card-scaffold", h);
  } catch (e) {
    card("card-scaffold", `<p class="status err">${e.message}</p>`);
  }
})();

// File Splitter
(async () => {
  try {
    const d = await fetchJson("/api/file-split");
    let h = `<div class="row"><span>Input</span><strong>${d.inputLines} lines</strong> → <strong>${d.sections.length} files</strong></div>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>File</th><th>Lines</th><th>Preview</th></tr>`;
    d.sections.forEach((s, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${s.file}</code></td><td>${s.lines}</td><td style="font-size:9px">${s.preview.replace(/</g, "&lt;")}</td></tr>`;
    });
    h += `</table>`;
    h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">awk one-liner</summary>`;
    h += `<code style="font-size:8px;display:block;word-break:break-all">${d.awkCommand}</code>`;
    h += `</details>`;
    card("card-file-split", h);
  } catch (e) {
    card("card-file-split", `<p class="status err">${e.message}</p>`);
  }
})();

// Effect: Image
(async () => {
  try {
    const d = await fetchJson("/api/effect-image");
    let h = `<div class="row"><span>Scan</span><span class="badge badge-info">${d.scan.exports.length} exports</span> <code style="font-size:9px">${d.scan.file}</code></div>`;
    h += `<div class="row"><span>Symbol</span><code style="font-size:9px">${d.symbolKey}</code></div>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Operation</th><th>Time</th><th>≤Thr</th><th>Train</th></tr>`;
    d.metrics.forEach((m, i) => {
      const t = d.trained[`kimi.effect.image.${m.operation}`];
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${m.operation}</code></td><td style="font-size:10px">${m.actualMs > 0 ? m.actualMs.toFixed(3) + "ms" : "ERR"}</td><td><span class="badge badge-${m.pass ? "ok" : "err"}">${m.pass ? "✓" : "✗"}</span></td><td style="font-size:9px">${t ? t + "ms" : "—"}</td></tr>`;
    });
    h += `</table>`;
    h += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px;margin-top:4px">${d.report}</pre>`;
    card("card-effect-image", h);
  } catch (e) {
    card("card-effect-image", `<p class="status err">${e.message}</p>`);
  }
})();

// Extract Methods
(async () => {
  try {
    const d = await fetchJson("/api/extract-methods");
    let h = `<div class="row"><span>Scanned</span><strong>${d.summary}</strong></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Exported from src/index.ts</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Method</th><th>Async</th><th>Params</th></tr>`;
    d.exportedFromIndex.forEach((m, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${m.name}</code></td><td><span class="badge badge-${m.async ? "ok" : "warn"}">${m.async ? "async" : "sync"}</span></td><td style="font-size:9px">${m.params.join(", ") || "—"}</td></tr>`;
    });
    h += `</table>`;
    card("card-extract-methods", h);
  } catch (e) {
    card("card-extract-methods", `<p class="status err">${e.message}</p>`);
  }
})();

// Transpiler.scan
(async () => {
  try {
    const d = await fetchJson("/api/transpiler-scan");
    let h = `<div class="row"><span>Files</span><strong>${d.results.length}</strong> <span style="font-size:10px;color:var(--muted)">${d.totalExports} exports total</span></div>`;
    d.results.forEach((r) => {
      h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">${r.file} (${r.exports.length} exports, ${r.importCount} imports)</p>`;
      h += `<div style="font-size:10px;display:flex;flex-wrap:wrap;gap:2px 4px;color:var(--muted)">`;
      r.exports.slice(0, 8).forEach((e) => {
        h += `<code>${e}</code>`;
      });
      if (r.exports.length > 8) h += `<span>+${r.exports.length - 8} more</span>`;
      h += `</div>`;
    });
    card("card-transpiler-scan", h);
  } catch (e) {
    card("card-transpiler-scan", `<p class="status err">${e.message}</p>`);
  }
})();

// ShadowRealm
(async () => {
  try {
    const d = await fetchJson("/api/shadow-realm");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:4px">Isolation</p>`;
    h += `<div class="row"><span>Inner secret</span><code>${d.isolate.innerSecret}</code></div>`;
    h += `<div class="row"><span>Outer secret</span><span class="badge badge-${d.isolate.verified ? "ok" : "err"}">${d.isolate.outerSecret}</span></div>`;
    h += `<div class="row"><span>Verified</span><span class="badge badge-ok">${d.isolate.verified}</span></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Imports</p>`;
    h += `<div class="row"><span>add(2,3)</span><strong>${d.imports["add(2,3)"]}</strong></div>`;
    h += `<div class="row"><span>multiply(4,5)</span><strong>${d.imports["multiply(4,5)"]}</strong></div>`;
    h += `<div class="row"><span>version</span><code>${d.imports.version}</code></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Bridging</p>`;
    h += `<div class="row"><span>${d.bridging.expression}</span><strong>${d.bridging.result}</strong> <span class="badge badge-${d.bridging.result === d.bridging.expected ? "ok" : "err"}">${d.bridging.result === d.bridging.expected ? "✓" : "✗"}</span></div>`;
    card("card-shadow-realm", h);
  } catch (e) {
    card("card-shadow-realm", `<p class="status err">${e.message}</p>`);
  }
})();

// vm.Context
(async () => {
  try {
    const d = await fetchJson("/api/vm-context");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">vm.createContext</p>`;
    h += `<div class="row"><span>x initial</span><strong>${d.vmContext.initial}</strong></div>`;
    h += `<div class="row"><span>x after runInContext</span><strong>${d.vmContext.afterRunInContext}</strong></div>`;
    h += `<div class="row"><span>Verified</span><span class="badge badge-${d.vmContext.verified ? "ok" : "err"}">${d.vmContext.verified}</span></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">MessageChannel</p>`;
    h += `<div class="row"><span>Sent</span><code>${d.messageChannel.sent}</code></div>`;
    h += `<div class="row"><span>Received</span><code>${d.messageChannel.received.join(", ")}</code></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Isolation factory</p>`;
    if (d.isolationFactory) {
      h += `<div class="row"><span>Mode</span><code>${d.isolationFactory.resolvedMode}</code> <span style="font-size:9px;color:var(--muted)">(requested: ${d.isolationFactory.requestedMode})</span></div>`;
      h += `<div class="row"><span>eval 1+1</span><strong>${d.isolationFactory.evalResult}</strong></div>`;
      if (d.isolationFactory.roundtripMs != null) {
        h += `<div class="row"><span>Roundtrip</span><strong>${d.isolationFactory.roundtripMs.toFixed(3)}ms</strong></div>`;
      }
    }
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Isolation stack</p>`;
    Object.entries(d.isolationStack).forEach(([k, v]) => {
      const ok = String(v).startsWith("✅");
      h += `<div class="row"><span>${k}</span><span class="badge badge-${ok ? "ok" : "warn"}" style="font-size:10px">${v}</span></div>`;
    });
    card("card-vm-context", h);
  } catch (e) {
    card("card-vm-context", `<p class="status err">${e.message}</p>`);
  }
})();

// IPC Matrix
(async () => {
  try {
    const d = await fetchJson("/api/ipc-matrix");
    let h = `<table class="tbl"><tr><th>#</th><th>Mechanism</th><th>Isolation</th><th>Thread</th><th>Status</th></tr>`;
    d.mechanisms.forEach((m, i) => {
      const ok = m.status.startsWith("✅");
      h += `<tr><td class="num">${i + 1}.</td><td style="font-size:10px">${m.mechanism}</td><td style="font-size:9px">${m.isolation}</td><td>${m.thread}</td><td><span class="badge badge-${ok ? "ok" : "warn"}" style="font-size:9px">${m.status}</span></td></tr>`;
    });
    h += `</table>`;
    card("card-ipc-matrix", h);
  } catch (e) {
    card("card-ipc-matrix", `<p class="status err">${e.message}</p>`);
  }
})();

// Symbol Registry
(async () => {
  try {
    const d = await fetchJson("/api/symbols");
    let h = "";
    const layers = [
      { label: "Domain (pure contracts)", key: "domain" },
      { label: "Effect (impure handlers)", key: "effect" },
      { label: "Harness (internal)", key: "harness" },
    ];
    layers.forEach((layer) => {
      const items = d.symbols[layer.key];
      if (!items || !items.length) return;
      h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">${layer.label} (${items.length})</p>`;
      h += `<table class="tbl"><tr><th>#</th><th>Symbol</th><th>Module</th></tr>`;
      items.forEach((s, i) => {
        h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:9px">${s.key}</code></td><td style="font-size:9px">${s.module}</td></tr>`;
      });
      h += `</table>`;
    });
    if (d.pipeline) {
      h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Pipeline order (${d.pipeline.length})</summary>`;
      h += `<code style="font-size:9px;display:block">${d.pipeline.join(" → ")}</code>`;
      h += `</details>`;
    }
    card("card-symbols", h);
  } catch (e) {
    card("card-symbols", `<p class="status err">${e.message}</p>`);
  }
})();

// setHeaders
(async () => {
  try {
    const d = await fetchJson("/api/set-headers");
    let h = `<div class="row"><span>Method</span><code style="font-size:10px">${d.method}</code></div>`;
    h += `<div class="row"><span>Input</span><code style="font-size:10px">${d.input}</code></div>`;
    h += `<div class="row"><span>Body</span><code>${d.body}</code></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Response headers</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Header</th><th>Value</th></tr>`;
    let i = 0;
    for (const [k, v] of Object.entries(d.responseHeaders || {})) {
      if (k === "date" || k === "connection" || k === "keep-alive" || k === "content-length")
        continue;
      i++;
      h += `<tr><td class="num">${i}.</td><td><code>${k}</code></td><td>${v}</td></tr>`;
    }
    h += `</table>`;
    card("card-set-headers", h);
  } catch (e) {
    card("card-set-headers", `<p class="status err">${e.message}</p>`);
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

// kimi-doctor CLI
(async () => {
  try {
    const d = await fetchJson("/api/kimi-doctor");
    let h = `<table class="tbl"><tr><th>#</th><th>Flag</th><th>Purpose</th></tr>`;
    d.commands.forEach((c, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td><code style="font-size:10px">${c.flag}</code></td><td style="font-size:10px">${c.description}</td></tr>`;
    });
    h += `</table>`;
    h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Pipeline</summary>`;
    h += `<code style="font-size:9px;display:block">${d.pipeline}</code>`;
    h += `</details>`;
    if (d.watchModes) {
      h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Watch modes</summary>`;
      h += `<table class="tbl" style="margin-top:4px"><tr><th>Tool</th><th>Mechanism</th><th>Entry</th></tr>`;
      h += `<tr><td><code>${d.watchModes.perfDoctor.tool}</code></td><td style="font-size:10px">${d.watchModes.perfDoctor.mechanism}</td><td><code style="font-size:9px">${d.watchModes.perfDoctor.entry}</code></td></tr>`;
      h += `<tr><td><code>${d.watchModes.kimiDoctor.tool}</code></td><td style="font-size:10px">${d.watchModes.kimiDoctor.mechanism}</td><td><code style="font-size:9px">${d.watchModes.kimiDoctor.entry}</code></td></tr>`;
      h += `</table></details>`;
    }
    h += `<p style="font-size:10px;color:var(--muted);margin-top:4px"><code>${d.allAtOnce}</code></p>`;
    card("card-kimi-doctor", h);
  } catch (e) {
    card("card-kimi-doctor", `<p class="status err">${e.message}</p>`);
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

// Bun.deepMatch
(async () => {
  try {
    const d = await fetchJson("/api/deep-match");
    let h = `<p style="font-size:10px;color:var(--muted);margin-bottom:4px">Shape validation: manual typeof checks</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Trace</th><th>Shape</th><th>Exact</th></tr>`;
    d.results.forEach((r, i) => {
      const traceShort = r.trace.length > 50 ? r.trace.slice(0, 47) + "…" : r.trace;
      h += `<tr><td class="num">${i + 1}.</td><td style="font-size:9px">${traceShort}</td><td><span class="badge badge-${r.shape === "valid" ? "ok" : "err"}">${r.shape}</span></td><td><span class="badge badge-${r.exactMatch ? "ok" : "warn"}">${r.exactMatch ? "match" : "—"}</span></td></tr>`;
    });
    h += `</table>`;
    h += `<div class="row"><span>Valid</span><strong>${d.validCount}/${d.results.length}</strong></div>`;
    card("card-deep-match", h);
  } catch (e) {
    card("card-deep-match", `<p class="status err">${e.message}</p>`);
  }
})();

// bun:test
(async () => {
  try {
    const d = await fetchJson("/api/bun-test");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">Imports: ${d.imports.map((s) => "<code>" + s + "</code>").join(", ")}</p>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">expect matchers (${d.expectMatchers.length})</p>`;
    h += `<div style="font-size:10px;display:flex;flex-wrap:wrap;gap:2px 6px;color:var(--muted)">`;
    d.expectMatchers.forEach((m) => {
      h += `<code>${m}</code>`;
    });
    h += `</div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Run</p>`;
    h += `<code style="font-size:10px;display:block">${d.runCommand}</code>`;
    if (d.changedImportGraph) {
      const g = d.changedImportGraph;
      h += `<details open style="margin-top:6px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">${g.title}</summary>`;
      h += `<p style="font-size:10px;color:var(--muted);margin:4px 0">${g.summary}</p>`;
      h += `<table class="tbl"><tr><th>#</th><th>Stage</th><th>Mechanics</th></tr>`;
      (g.pipeline || []).forEach((row) => {
        h += `<tr><td class="num">${row.step}</td><td><strong style="font-size:10px">${row.label}</strong></td><td style="font-size:9px">${row.detail}</td></tr>`;
      });
      h += `</table>`;
      if (g.graphScan) {
        h += `<p style="font-size:10px;color:var(--blue);margin:6px 0 2px">Graph scan</p>`;
        h += `<div style="font-size:9px;color:var(--muted)">`;
        h += `<div class="row"><span>Edges</span><code>${g.graphScan.edges}</code></div>`;
        h += `<div class="row"><span>node_modules</span><span class="badge ${g.graphScan.entersNodeModules ? "badge-warn" : "badge-ok"}">${g.graphScan.entersNodeModules ? "enters" : "skipped"}</span></div>`;
        h += `<div class="row"><span>Link/emit</span><span class="badge ${g.graphScan.linksOrEmitsCode ? "badge-warn" : "badge-ok"}">${g.graphScan.linksOrEmitsCode ? "yes" : "no"}</span></div>`;
        h += `</div>`;
      }
      if (g.refModes?.length) {
        h += `<p style="font-size:10px;color:var(--blue);margin:6px 0 2px">Ref modes</p>`;
        h += `<table class="tbl"><tr><th>Flag</th><th>Scope</th><th>No changes</th></tr>`;
        g.refModes.forEach((m) => {
          h += `<tr><td><code style="font-size:9px">${m.flag}</code></td><td style="font-size:9px">${m.scope}</td><td style="font-size:9px">${m.noChanges}</td></tr>`;
        });
        h += `</table>`;
      }
      if (g.kimiScripts?.length) {
        h += `<p style="font-size:10px;color:var(--blue);margin:6px 0 2px">kimi-toolchain scripts</p>`;
        h += `<table class="tbl"><tr><th>Script</th><th>Ref</th><th>Runner</th></tr>`;
        g.kimiScripts.forEach((s) => {
          h += `<tr><td><code style="font-size:9px">${s.script}</code></td><td style="font-size:9px">${s.ref}</td><td style="font-size:9px">${s.runner}</td></tr>`;
        });
        h += `</table>`;
      }
      if (g.limitations?.length) {
        h += `<p style="font-size:10px;color:var(--amber,#b8860b);margin:6px 0 2px">Limitations</p><ul style="font-size:9px;color:var(--muted);margin:0;padding-left:16px">`;
        g.limitations.forEach((line) => {
          h += `<li>${line}</li>`;
        });
        h += `</ul>`;
      }
      if (g.safetyNet) {
        h += `<p style="font-size:10px;color:var(--muted);margin:6px 0 2px">Safety net: <code>${(g.safetyNet.scripts || []).join(", ")}</code></p>`;
      }
      if (g.referenceDoc) {
        h += `<p style="font-size:9px;color:var(--muted)">SSOT: <code>${g.referenceDoc}</code></p>`;
      }
      h += `</details>`;
    }
    if (d.cliFlags) {
      h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">CLI flags</summary>`;
      h += `<table class="tbl"><tr><th>Flag</th><th>Value</th><th>Purpose</th></tr>`;
      d.cliFlags.forEach((f) => {
        h += `<tr><td><code style="font-size:9px">${f.flag}</code></td><td style="font-size:9px">${f.value || "—"}</td><td style="font-size:9px">${f.description}</td></tr>`;
      });
      h += `</table></details>`;
    }
    if (d.snapshotHelper) {
      h += `<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Snapshot helper pattern</summary>`;
      h += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px;max-height:160px;overflow-y:auto">${d.snapshotHelper.replace(/</g, "&lt;")}</pre>`;
      h += `</details>`;
    }
    card("card-bun-test", h);
  } catch (e) {
    card("card-bun-test", `<p class="status err">${e.message}</p>`);
  }
})();

// bun build --compile
(async () => {
  try {
    const d = await fetchJson("/api/build-compile");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">New: ${d.cliFlags.length} flags</p>`;
    h += `<details><summary style="font-size:11px;cursor:pointer;color:var(--blue)">Windows metadata (6 flags)</summary>`;
    h += `<table class="tbl"><tr><th>Flag</th><th>For</th></tr>`;
    d.cliFlags
      .filter((f) => f.flag.startsWith("--windows"))
      .forEach((f) => {
        h += `<tr><td><code style="font-size:9px">${f.flag}</code></td><td style="font-size:10px">${f.description.split(":")[1] || f.description}</td></tr>`;
      });
    h += `</table></details>`;
    h += `<details><summary style="font-size:11px;cursor:pointer;color:var(--blue)">API: shorthand target</summary>`;
    h += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px;max-height:80px">${d.apiExamples[0].code}</pre>`;
    h += `</details>`;
    h += `<details><summary style="font-size:11px;cursor:pointer;color:var(--blue)">API: --compile-exec-argv</summary>`;
    h += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px">${d.apiExamples[2].code}</pre>`;
    h += `</details>`;
    card("card-build-compile", h);
  } catch (e) {
    card("card-build-compile", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.stripANSI
(async () => {
  try {
    const d = await fetchJson("/api/strip-ansi");
    let h = `<table class="tbl"><tr><th>#</th><th>Input (raw)</th><th>Stripped</th></tr>`;
    d.samples.forEach((s, i) => {
      h += `<tr><td class="num">${i + 1}.</td><td style="font-size:10px"><code>${s.input}</code></td><td>${s.stripped}</td></tr>`;
    });
    h += `</table>`;
    h += `<div class="row" style="margin-top:4px"><span>stringWidth</span><span style="font-size:10px">raw=${d.stringWidth.raw} stripped=${d.stringWidth.stripped}</span></div>`;
    card("card-strip-ansi", h);
  } catch (e) {
    card("card-strip-ansi", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun Shell
(async () => {
  try {
    const d = await fetchJson("/api/shell");
    let h = `<div class="row"><span>pkg name</span><code>${d.pkgFields.name}</code></div>`;
    h += `<div class="row"><span>pkg version</span><code>${d.pkgFields.version}</code></div>`;
    h += `<div class="row"><span>echo</span><code>${d.stdout}</code></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">ShellError demo</p>`;
    h += `<div class="row"><span>triggered</span><span class="badge badge-${d.shellError.triggered ? "ok" : "warn"}">${d.shellError.triggered}</span></div>`;
    h += `<div class="row"><span>exitCode</span><strong>${d.shellError.exitCode}</strong></div>`;
    h += `<div class="row"><span>stderr</span><code style="font-size:10px">${d.shellError.stderr}</code></div>`;
    h += `<p style="font-size:10px;margin-top:4px;color:var(--muted)">Methods: ${d.methods.map((m) => "<code>" + m + "</code>").join(", ")}</p>`;
    card("card-shell", h);
  } catch (e) {
    card("card-shell", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.cron
(async () => {
  try {
    const d = await fetchJson("/api/cron");
    let h = `<div class="row"><span>Pattern</span><code style="font-size:10px">${d.pattern}</code></div>`;
    h += `<div class="row"><span>Fired</span><span class="badge badge-${d.fired ? "ok" : "warn"}">${d.fired ? "✓" : "✗"}</span></div>`;
    if (d.latencyMs)
      h += `<div class="row"><span>Latency</span><strong>${d.latencyMs}ms</strong></div>`;
    if (d.error) h += `<p class="status warn">${d.error}</p>`;
    card("card-cron", h);
  } catch (e) {
    card("card-cron", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.Transpiler
(async () => {
  try {
    const d = await fetchJson("/api/transpiler");
    let h = `<div class="row"><span>TS input</span><strong>${d.inputLines} lines, ${d.inputBytes}B</strong></div>`;
    h += `<div class="row"><span>JS output</span><strong>${d.outputBytes}B (${d.ratio}x)</strong></div>`;
    h += `<p style="font-size:10px;color:var(--muted);margin:2px 0">${d.features.join(" · ")}</p>`;
    h += `<pre style="font-size:9px;background:var(--border);padding:4px;border-radius:4px;max-height:160px;overflow-y:auto">${d.output.replace(/</g, "&lt;")}</pre>`;
    card("card-transpiler", h);
  } catch (e) {
    card("card-transpiler", `<p class="status err">${e.message}</p>`);
  }
})();

// node:os
(async () => {
  try {
    const d = await fetchJson("/api/os");
    let h = `<div class="row"><span>Platform</span><span class="badge badge-info">${d.platform} ${d.arch}</span></div>`;
    h += `<div class="row"><span>Hostname</span><code>${d.hostname}</code></div>`;
    h += `<div class="row"><span>CPUs</span><strong>${d.cpus.count}</strong> <span style="font-size:10px;color:var(--muted)">${d.cpus.model.slice(0, 20)}…</span></div>`;
    h += `<div class="row"><span>Memory</span><span>${d.memory.freeMB}MB free / ${d.memory.totalGB}GB</span></div>`;
    h += `<div class="row"><span>Uptime</span><strong>${d.uptime.hours}h</strong></div>`;
    h += `<div class="row"><span>User</span><code>${d.userInfo.username}</code></div>`;
    card("card-os", h);
  } catch (e) {
    card("card-os", `<p class="status err">${e.message}</p>`);
  }
})();

// node:crypto randomBytes
(async () => {
  try {
    const d = await fetchJson("/api/random-bytes");
    let h = `<table class="tbl"><tr><th>#</th><th>Method</th><th>Output (hex)</th></tr>`;
    h += `<tr><td class="num">1.</td><td>randomBytes(16)</td><td><code style="font-size:9px">${d.randomBytes16}</code></td></tr>`;
    h += `<tr><td class="num">2.</td><td>randomBytes(8)</td><td><code style="font-size:9px">${d.randomBytes8}</code></td></tr>`;
    h += `<tr><td class="num">3.</td><td>randomFillSync(buf[12])</td><td><code style="font-size:9px">${d.randomFill12}</code></td></tr>`;
    h += `</table>`;
    card("card-random-bytes", h);
  } catch (e) {
    card("card-random-bytes", `<p class="status err">${e.message}</p>`);
  }
})();

// inspect.defaultOptions
(async () => {
  try {
    const d = await fetchJson("/api/inspect-defaults");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:4px">Configured (depth=6, colors=false)</p>`;
    h += `<pre style="font-size:10px;background:var(--border);padding:4px;border-radius:4px;overflow-x:auto;max-height:80px">${d.deepOutput.replace(/</g, "&lt;")}</pre>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:4px 0">Default (depth=${d.defaults.depth}, restored)</p>`;
    h += `<pre style="font-size:10px;background:var(--border);padding:4px;border-radius:4px;overflow-x:auto;max-height:60px">${d.normalOutput.replace(/</g, "&lt;")}</pre>`;
    card("card-inspect-defaults", h);
  } catch (e) {
    card("card-inspect-defaults", `<p class="status err">${e.message}</p>`);
  }
})();

// Bun.env / .env
(async () => {
  try {
    const d = await fetchJson("/api/dotenv");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:4px">Loading order (→ increasing precedence)</p>`;
    h += `<ol style="font-size:10px;margin:0 0 8px 16px;color:var(--muted)">`;
    d.loadingOrder.forEach((s) => {
      h += `<li>${s}</li>`;
    });
    h += `</ol>`;
    h += `<div class="row"><span>NODE_ENV</span><span class="badge badge-${d.nodeEnv === "unset" ? "warn" : "ok"}">${d.nodeEnv}</span></div>`;
    h += `<p style="font-size:11px;color:var(--blue);margin:6px 0 2px">Loaded from .env</p>`;
    h += `<table class="tbl"><tr><th>#</th><th>Key</th><th>Value</th></tr>`;
    let i = 0;
    for (const [k, v] of Object.entries(d.runtimeValues)) {
      i++;
      h += `<tr><td class="num">${i}.</td><td><code>${k}</code></td><td><span class="badge badge-${v === "unset" ? "warn" : "ok"}">${v}</span></td></tr>`;
    }
    h += `</table>`;
    // Bun special vars summary
    h += `<details style="margin-top:6px"><summary style="color:var(--blue);cursor:pointer;font-size:11px">Bun-specific env vars (${d.setCount}/${d.totalCount} set)</summary>`;
    h += `<table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Variable</th><th>Status</th></tr>`;
    d.bunSpecialVars.forEach((v, j) => {
      h += `<tr><td class="num">${j + 1}.</td><td title="${v.description.replace(/"/g, "&quot;")}"><code style="font-size:10px">${v.name}</code></td><td><span class="badge badge-${v.set ? "ok" : "warn"}">${v.set ? v.value : "unset"}</span></td></tr>`;
    });
    h += `</table></details>`;
    h += `<p class="status ok" style="margin-top:4px;font-size:10px">${d.note}</p>`;
    card("card-dotenv", h);
  } catch (e) {
    card("card-dotenv", `<p class="status err">${e.message}</p>`);
  }
})();

// Canvas ↔ card filter (v5.4) — ?canvas=<manifestId|canvasId>
(async function wireCanvasFilter() {
  const bar = document.getElementById("canvas-filter-bar");
  if (!bar) return;

  function applyFilter(cardIds, activeId) {
    const ids = cardIds && activeId ? cardIds : null;
    setCanvasFilterIds(ids, activeId || null);
  }

  function setQuery(canvasId) {
    const url = new URL(location.href);
    if (canvasId) url.searchParams.set("canvas", canvasId);
    else url.searchParams.delete("canvas");
    history.replaceState(null, "", url);
  }

  try {
    const params = new URLSearchParams(location.search);
    const active = params.get("canvas");
    const [canvasesRes, cardsRes] = await Promise.all([
      fetch("/api/canvases"),
      fetch(active ? `/api/cards?canvas=${encodeURIComponent(active)}` : "/api/cards"),
    ]);
    const canvasesPayload = await canvasesRes.json();
    const cardsPayload = await cardsRes.json();
    const canvases = canvasesPayload.canvases ?? [];
    const highlightIds = new Set((cardsPayload.cards ?? []).map((c) => c.id));

    const pills = [
      `<button type="button" class="canvas-pill${active ? "" : " active"}" data-canvas="">All cards</button>`,
    ];
    for (const c of canvases) {
      const key = c.id;
      const label = c.page || c.canvasId;
      const isActive = active === key || active === c.canvasId;
      pills.push(
        `<button type="button" class="canvas-pill${isActive ? " active" : ""}" data-canvas="${key}" title="${c.path}">${label}</button>`
      );
    }
    bar.innerHTML = `<span style="font-size:11px;color:var(--muted);margin-right:4px">Canvas filter:</span>${pills.join("")}`;

    if (active && highlightIds.size > 0) applyFilter(highlightIds, active);
    void fetchAndApplyCanvasDeepLink();

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-canvas]");
      if (!btn) return;
      const id = btn.getAttribute("data-canvas") || "";
      setQuery(id || null);
      if (!id) {
        applyFilter(new Set(), null);
        bar
          .querySelectorAll(".canvas-pill")
          .forEach((p) => p.classList.toggle("active", p === btn));
        return;
      }
      fetch(`/api/cards?canvas=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((payload) => {
          const ids = new Set((payload.cards ?? []).map((c) => c.id));
          applyFilter(ids, id);
          bar
            .querySelectorAll(".canvas-pill")
            .forEach((p) => p.classList.toggle("active", p === btn));
          void fetchAndApplyCanvasDeepLink();
        });
    });
  } catch (e) {
    bar.innerHTML = `<span style="font-size:11px;color:var(--red)">Canvas filter unavailable: ${e.message}</span>`;
  }
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
      btn.classList.toggle(
        "diff-pick-a",
        btn.getAttribute("data-run-id") === diffPickRunId
      );
    }
    for (const btn of document.querySelectorAll(".artifact-gate-pick")) {
      btn.classList.toggle(
        "diff-pick-a",
        btn.getAttribute("data-gate-path") === diffPickGatePath
      );
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
        const tone =
          row.match === "equal" ? "ok" : row.match === "diff" ? "warn" : "err";
        const label = row.match === "equal" ? "equal" : row.match === "diff" ? "diff" : "missing";
        return `<tr>
            <td><code>${row.gate}</code></td>
            <td style="font-size:10px"><code>${String(pathA).replace(/^\\.kimi\\/artifacts\\//, "")}</code></td>
            <td style="font-size:10px"><code>${String(pathB).replace(/^\\.kimi\\/artifacts\\//, "")}</code></td>
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
            <td style="font-size:10px"><code>${String(payload.pathA).replace(/^\\.kimi\\/artifacts\\//, "")}</code></td>
            <td style="font-size:10px"><code>${String(payload.pathB).replace(/^\\.kimi\\/artifacts\\//, "")}</code></td>
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
      if (
        !selectedGate &&
        (artifactsPayload.artifacts || []).some((r) => (r.count ?? 0) > 0)
      ) {
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

// Lineage badges on artifact-lineage influenced cards (synced with identity refresh)
(function wireLineageBadges() {
  const CARD_LINEAGE_MAP = [
    { cardId: "card-gates", gates: null },
    { cardId: "card-bunfig-policy", gates: ["bunfig-policy"] },
    { cardId: "card-kimi-doctor", gates: ["perf-gate", "bunfig-policy", "card-probe"] },
    { cardId: "card-metrics-schema", gates: ["metrics-schema"] },
    { cardId: "card-trace-verify", gates: ["trace-verify"] },
    { cardId: "card-url", gates: ["url-i18n", "email-i18n"] },
  ];

  function setCardLineageBadge(h2, html) {
    if (!h2) return;
    let wrap = h2.querySelector(".card-lineage-badge");
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.className = "card-lineage-badge";
      h2.appendChild(wrap);
    }
    wrap.innerHTML = html;
  }

  function applyBadges(artifacts) {
    const byGate = new Map((artifacts || []).map((row) => [row.gate, row]));
    for (const { cardId, gates } of CARD_LINEAGE_MAP) {
      const h2 = document.getElementById(cardId)?.querySelector("h2");
      if (!h2) continue;

      if (!gates) {
        const n = (artifacts || []).filter((row) => (row.count ?? 0) > 0).length;
        setCardLineageBadge(
          h2,
          `<span class="badge badge-info lineage-badge" title="Gates with saved artifacts">art:${n}</span>`
        );
        continue;
      }

      const hit = gates.find((gate) => (byGate.get(gate)?.count ?? 0) > 0);
      if (!hit) {
        setCardLineageBadge(
          h2,
          `<span class="badge badge-warn lineage-badge" title="No saved artifacts for mapped gates (${gates.join(", ")})">art:0</span>`
        );
        continue;
      }

      const row = byGate.get(hit);
      const count = row?.count ?? 0;
      const lin = lineageBadgeFromRow(row);
      setCardLineageBadge(
        h2,
        `<span class="badge badge-ok lineage-badge" title="Saved artifacts for ${hit}">art:${count}</span>${lin}`
      );
    }
  }

  async function loadInitial() {
    try {
      const payload = await fetchJson("/api/artifacts?includeLineage=1");
      applyBadges(payload.artifacts || []);
    } catch {
      /* optional */
    }
  }

  window.addEventListener("artifact-dashboard-refresh", (e) => {
    applyBadges(e.detail?.artifacts || []);
  });

  void loadInitial();
})();

// Live card status probes — update borders every 10s (full route probe)
(function pollCardStatus() {
  const REFRESH_MS = 10_000;

  function applyStatus(payload) {
    const cards = payload?.cards ?? [];
    for (const c of cards) {
      const el = document.getElementById(c.id);
      if (!el) continue;
      el.classList.remove("live-ok", "live-warn", "live-error");
      if (c.status === "ok") el.classList.add("live-ok");
      else if (c.status === "warn") el.classList.add("live-warn");
      else if (c.status === "error") el.classList.add("live-error");
      const statusEl = el.querySelector(".card-live-status");
      if (statusEl) statusEl.textContent = c.status;
    }
  }

  async function refreshStatuses() {
    try {
      const active = new URLSearchParams(location.search).get("canvas");
      const url = active
        ? `/api/cards?probe=true&canvas=${encodeURIComponent(active)}`
        : "/api/cards?probe=true";
      const payload = await fetch(url).then((r) => r.json());
      applyStatus(payload);
    } catch {
      /* dashboard may still be starting */
    }
  }

  refreshStatuses();
  setInterval(refreshStatuses, REFRESH_MS);
})();
