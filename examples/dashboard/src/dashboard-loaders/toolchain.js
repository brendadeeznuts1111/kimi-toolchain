/** Toolchain lane — bundle, compile, build, publish, transpiler scan. */
import { fetchJson, card } from "/dashboard-core.js";

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
    const nmPct = s.totalBytes > 0 ? ((s.nodeModulesBytes / s.totalBytes) * 100).toFixed(0) : 0;
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
      h += '<table class="tbl" style="margin-top:4px"><tr><th>Section</th><th>Command</th></tr>';
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
      card("card-bun-runtime", '<p class="status warn">Not applicable outside kimi-toolchain</p>');
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
    h += '<table class="tbl" style="margin-top:4px"><tr><th>Check</th><th>Status</th></tr>';
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

// kimi publish
(async () => {
  try {
    const d = await fetchJson("/api/kimi-publish");
    let h = `<p style="font-size:11px;color:var(--blue);margin-bottom:2px">Pipeline (${d.pipeline.length} steps)</p>`;
    d.pipeline.forEach((s) => {
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
