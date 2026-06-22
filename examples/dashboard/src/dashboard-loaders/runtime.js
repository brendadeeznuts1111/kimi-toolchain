/** Runtime lane — Bun API probe cards (lazy-loaded). */
import { fetchJson, card } from "/dashboard-core.js";

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
        const tone = row.status === "pass" ? "ok" : row.status === "invalid" ? "warn" : "err";
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
