/** Dashboard shell — hub, PATH header, landing zone, canvas filter, shared helpers (ES module). */
import { DASHBOARD_HUB_PRELOAD, DASHBOARD_LOADER_LANES } from "/dashboard-loader-lanes.js";

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/** Canonical port fallback when /api/settings is unavailable. */
const CANONICAL_DASHBOARD_PORT = 5678;

/** ASCII lineage badges (not Unicode icons, not punycode). */
const LINEAGE_BADGE = {
  runtime: { label: "lin:rt", tone: "ok", title: "Runtime lineage (metadata.lineage)" },
  declarative: { label: "lin:dec", tone: "info", title: "Declarative dependsOn" },
  stored: { label: "lin:str", tone: "info", title: "Stored lineageMermaid" },
  none: { label: "lin:none", tone: "warn", title: "No lineage on latest artifact" },
};

export function lineageBadgeHtml(source, deps) {
  const meta = LINEAGE_BADGE[source] ?? LINEAGE_BADGE.none;
  const depNote = deps > 0 ? ` - ${deps} upstream` : "";
  const title = `${meta.title}${depNote}`;
  return `<span class="badge badge-${meta.tone} lineage-badge" title="${title}">${meta.label}</span>`;
}

export function lineageBadgeFromRow(row) {
  if (!row || (row.count ?? 0) === 0) return lineageBadgeHtml("none", 0);
  return lineageBadgeHtml(row.lineageSource || "none", row.dependencyCount ?? 0);
}

export function artifactQuerySuffix(baseParams) {
  const params = new URLSearchParams(baseParams?.toString() ?? "");
  params.set("includeLineage", "1");
  const q = params.toString();
  return q ? `?${q}` : "?includeLineage=1";
}

const CANVAS_FILTER_EVENT = "canvas-filter-applied";
const ARTIFACT_LINEAGE_CANVAS = "artifact-lineage";

let filterCanvasIds = null;
let filterExampleIds = null;

function applyCanvasCardClasses(cardIds, active) {
  const ids = cardIds ?? new Set();
  for (const el of document.querySelectorAll(".grid .card")) {
    el.classList.remove("canvas-dimmed", "canvas-highlight");
    if (!active) continue;
    if (ids.has(el.id)) el.classList.add("canvas-highlight");
    else el.classList.add("canvas-dimmed");
  }
  const artifacts = document.getElementById("card-artifacts");
  if (artifacts) {
    artifacts.classList.remove("canvas-dimmed", "canvas-highlight");
    if (!active) return;
    if (ids.has("card-artifacts")) artifacts.classList.add("canvas-highlight");
    else artifacts.classList.add("canvas-dimmed");
  }
}

function dispatchCanvasFilterEvent(canvasId, cardIds) {
  window.dispatchEvent(
    new CustomEvent(CANVAS_FILTER_EVENT, {
      detail: {
        canvasId: canvasId || null,
        cardIds: cardIds ? [...cardIds] : [],
      },
    })
  );
}

function recomputeCardHighlight(scrollToFirst = false) {
  if (filterCanvasIds && filterExampleIds) {
    const intersection = new Set([...filterCanvasIds].filter((id) => filterExampleIds.has(id)));
    const active = intersection.size > 0;
    applyCanvasCardClasses(intersection, active);
    if (scrollToFirst && active) {
      document
        .getElementById([...intersection][0])
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }
  if (filterCanvasIds) {
    applyCanvasCardClasses(filterCanvasIds, true);
    return;
  }
  if (filterExampleIds) {
    applyCanvasCardClasses(filterExampleIds, true);
    if (scrollToFirst) {
      document
        .getElementById([...filterExampleIds][0])
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }
  applyCanvasCardClasses(new Set(), false);
}

export function setCanvasFilterIds(cardIds, canvasId) {
  filterCanvasIds = cardIds && cardIds.size > 0 ? cardIds : null;
  dispatchCanvasFilterEvent(canvasId, filterCanvasIds);
  recomputeCardHighlight();
}

/** Server-side canvas deep link — runId / sessionId / diff via applyCanvasFilter. */
async function fetchAndApplyCanvasDeepLink() {
  const params = new URLSearchParams(location.search);
  if (params.get("orphans") === "true") {
    try {
      const payload = await fetchJson("/api/cards?orphans=true&probe=false");
      const ids = new Set((payload.cards || []).map((c) => c.id));
      setCanvasFilterIds(ids, "orphans");
    } catch {
      /* optional debug filter */
    }
    return;
  }
  const hasCanvasDeepLink =
    params.get("canvas") || params.get("runId") || params.get("sessionId") || params.get("diff");
  if (!hasCanvasDeepLink) return;
  if (
    !params.get("canvas") &&
    (params.get("runId") || params.get("sessionId") || params.get("diff"))
  ) {
    params.set("canvas", ARTIFACT_LINEAGE_CANVAS);
  }
  try {
    const payload = await fetchJson(`/api/canvas-filter?${params.toString()}`);
    const action = payload.action;
    if (!action) return;

    if (action.cardIds?.length) {
      setCanvasFilterIds(new Set(action.cardIds), action.canvas);
    }

    if (action.kind === "run-manifest") {
      window.dispatchEvent(
        new CustomEvent("run-manifest-loaded", {
          detail: { payload: action.payload },
        })
      );
      return;
    }
    if (action.kind === "diff-manifest") {
      window.dispatchEvent(
        new CustomEvent("diff-manifest-loaded", {
          detail: {
            left: action.left,
            right: action.right,
            diff: action.diff,
          },
        })
      );
      return;
    }
    if (action.kind === "session-runs") {
      window.dispatchEvent(
        new CustomEvent("session-runs-loaded", {
          detail: { payload: action.payload, params: payload.params },
        })
      );
    }
  } catch {
    /* canvas filter optional when dashboard is still starting */
  }
}

window.addEventListener("popstate", () => {
  void fetchAndApplyCanvasDeepLink();
});

function setExampleFilterIds(cardIds, scroll = false) {
  filterExampleIds = cardIds && cardIds.size > 0 ? cardIds : null;
  recomputeCardHighlight(scroll);
}

function highlightShowcaseCards(cardIds) {
  setExampleFilterIds(new Set(cardIds || []), true);
}

function clearShowcaseHighlight() {
  filterExampleIds = null;
  recomputeCardHighlight();
}

// Examples showcase hub — /api/examples
(async function wireShowcaseHub() {
  const hub = document.getElementById("showcase-hub");
  const body = document.getElementById("showcase-hub-body");
  if (!hub || !body) return;
  try {
    const payload = await fetchJson("/api/examples");
    const lanes = payload.lanes || [];
    const entries = payload.entries || [];
    const byLane = new Map();
    for (const entry of entries) {
      const list = byLane.get(entry.lane) || [];
      list.push(entry);
      byLane.set(entry.lane, list);
    }

    const dashUrl = payload.settings?.dashboardUrl ?? "";
    let html = `<div class="row" style="margin-bottom:10px">
      <h2>Examples Showcase</h2>
      <span class="badge badge-info">${payload.totals?.projects ?? 0} projects · ${payload.totals?.guides ?? 0} guides · ${payload.totals?.cardsMapped ?? 0} cards</span>
      ${dashUrl ? `<span class="badge badge-ok" title="Resolved from /api/settings">open ${dashUrl}</span>` : ""}
    </div><div class="showcase-lanes">`;

    for (const lane of lanes) {
      const laneEntries = byLane.get(lane.id) || [];
      if (laneEntries.length === 0) continue;
      html += `<div class="showcase-lane" style="border-left:3px solid ${lane.accent}">
        <div class="showcase-lane-header">
          <span class="showcase-lane-title" style="color:${lane.accent}">${lane.title}</span>
          <span class="showcase-lane-sub">${lane.subtitle}</span>
        </div>
        <div class="showcase-grid">`;
      for (const entry of laneEntries) {
        const level = entry.controlPlaneLevel ? `L${entry.controlPlaneLevel}` : null;
        const chips = [
          `<span class="showcase-chip ${entry.kind}">${entry.kind}</span>`,
          entry.status?.present
            ? `<span class="showcase-chip">on disk</span>`
            : `<span class="showcase-chip" style="color:var(--red)">missing</span>`,
          level ? `<span class="showcase-chip">${level}</span>` : "",
          entry.persona ? `<span class="showcase-chip">${entry.persona}</span>` : "",
        ]
          .filter(Boolean)
          .join("");
        const cmds = (entry.commands || []).slice(0, 2);
        const cmd = entry.commands?.[0] || "";
        const openCmd = entry.commands?.find((c) => c.startsWith("open http")) || "";
        const deepLink = `?example=${encodeURIComponent(entry.id)}`;
        const cardCount = (entry.cardIds || []).length;
        const commandsHtml = cmds.length
          ? `<div class="showcase-commands">${cmds.map((c) => `<code>${c}</code>`).join("")}</div>`
          : "";
        let probeLine = "";
        if (entry.probe?.cardCount) {
          probeLine = `<div class="showcase-probe">${entry.probe.cardCount} live dashboard cards</div>`;
        } else if (entry.probe?.artifactCount) {
          probeLine = `<div class="showcase-probe">${entry.probe.gateCount} gates · ${entry.probe.artifactCount} artifacts saved</div>`;
        }
        html += `<article class="showcase-card" style="border-left-color:${entry.accent}" data-entry="${entry.id}">
          <h3>${entry.title}</h3>
          <p>${entry.tagline}</p>
          ${probeLine}
          ${commandsHtml}
          <div class="showcase-meta">${chips}</div>
          <div class="showcase-actions">
            <button type="button" class="showcase-btn" data-action="cards" data-cards="${(entry.cardIds || []).join(",")}">Show ${cardCount} cards</button>
            <button type="button" class="showcase-btn muted" data-deep-link="${deepLink}" title="Copyable hub URL">⎘ ${entry.id}</button>
            ${openCmd ? `<button type="button" class="showcase-btn muted showcase-open-cmd" title="${openCmd.replace(/"/g, "&quot;")}" data-open-url="${openCmd.replace(/^open /, "").replace(/"/g, "&quot;")}">↗ open</button>` : ""}
            ${entry.kind === "project" && entry.status?.runnable ? `<button type="button" class="showcase-btn muted" title="${cmd.replace(/"/g, "&quot;")}">▶ ${entry.path}</button>` : `<button type="button" class="showcase-btn muted" title="${entry.path}">📄 ${entry.path.split("/").pop()}</button>`}
          </div>
          <div class="showcase-cards-link">${(entry.cardIds || [])
            .slice(0, 4)
            .map(
              (id) =>
                `<button type="button" data-action="scroll" data-card="${id}">${id.replace("card-", "")}</button>`
            )
            .join(" · ")}${cardCount > 4 ? ` · +${cardCount - 4}` : ""}</div>
        </article>`;
      }
      html += `</div></div>`;
    }
    html += `</div><p style="font-size:10px;color:var(--muted);margin-top:8px">Registry: <code>src/lib/examples-showcase.ts</code> · Templates: <code>bun run check:template-policy</code> · Skills: <code>bun run skills:table --verbose</code></p>`;
    hub.innerHTML = html;

    hub.addEventListener("click", (e) => {
      const deepBtn = e.target.closest("[data-deep-link]");
      if (deepBtn) {
        const link = deepBtn.getAttribute("data-deep-link");
        if (link) {
          const url = new URL(link, location.href);
          history.replaceState(null, "", url.pathname + url.search);
          const id = url.searchParams.get("example");
          const entry = entries.find((en) => en.id === id);
          if (entry) {
            setExampleFilterIds(new Set(entry.cardIds || []), false);
            hub.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
            recomputeCardHighlight(true);
          }
        }
        return;
      }
      const openBtn = e.target.closest("[data-open-url]");
      if (openBtn) {
        const target = openBtn.getAttribute("data-open-url");
        if (target) window.open(target, "_blank", "noopener");
        return;
      }
      const cardsBtn = e.target.closest("[data-action='cards']");
      if (cardsBtn) {
        const ids = (cardsBtn.getAttribute("data-cards") || "").split(",").filter(Boolean);
        highlightShowcaseCards(ids);
        return;
      }
      const scrollBtn = e.target.closest("[data-action='scroll']");
      if (scrollBtn) {
        const cardId = scrollBtn.getAttribute("data-card");
        if (cardId) highlightShowcaseCards([cardId]);
      }
    });

    const bar = document.getElementById("canvas-filter-bar");
    bar?.addEventListener("click", (e) => {
      if (e.target.closest("[data-canvas='']")) clearShowcaseHighlight();
    });

    const exampleParam = new URLSearchParams(location.search).get("example");
    if (exampleParam) {
      const entry = entries.find((e) => e.id === exampleParam);
      if (entry) {
        setExampleFilterIds(new Set(entry.cardIds || []), false);
        const card = hub.querySelector(`[data-entry="${exampleParam}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        recomputeCardHighlight(true);
      }
    }
  } catch (e) {
    body.textContent = `Showcase unavailable: ${e.message}`;
  }
})();

// Showcase badges on dashboard cards (reverse map from /api/cards)
(async function wireShowcaseCardBadges() {
  try {
    const payload = await fetchJson("/api/cards?probe=false");
    for (const card of payload.cards || []) {
      if (!card.showcaseEntries?.length) continue;
      const el = document.getElementById(card.id);
      const h2 = el?.querySelector("h2");
      if (!h2 || h2.querySelector(".card-showcase-badge")) continue;
      const label = card.showcaseEntries.slice(0, 2).join(" · ");
      const extra = card.showcaseEntries.length > 2 ? ` +${card.showcaseEntries.length - 2}` : "";
      const badge = document.createElement("span");
      badge.className = "card-showcase-badge";
      badge.title = `Examples: ${card.showcaseEntries.join(", ")}`;
      badge.textContent = `${label}${extra}`;
      h2.appendChild(badge);
    }
  } catch {
    // badges are optional
  }
})();

// PATH header
(async () => {
  const el = document.getElementById("path-header");
  try {
    const [d, rt, uuid, settings] = await Promise.all([
      fetchJson("/api/env"),
      fetchJson("/api/runtime-info"),
      fetchJson("/api/uuid"),
      fetchJson("/api/settings"),
    ]);
    const tools = d.tools
      .map(
        (t) =>
          `<span class="badge ${t.path ? "badge-ok" : "badge-err"}" style="margin:0 2px" title="${t.flags}">
        ${t.bin}${t.path ? "" : " ✗"}${t.resolution === "toolchain" ? "·tc" : t.resolution === "project" ? "·prj" : ""}
      </span>`
      )
      .join("");
    const vars = Object.entries(d.keyVars)
      .map(
        ([k, v]) =>
          `<span style="margin:0 6px;color:var(--muted)">${k}=</span><span style="color:var(--text)">${v}</span>`
      )
      .join("");
    const listenUrl =
      settings?.dashboardUrl ??
      d.dashboardUrl ??
      `http://127.0.0.1:${settings?.port ?? d.listenPort ?? CANONICAL_DASHBOARD_PORT}/`;
    const shadows =
      d.shadowWarnings.length > 0
        ? `<span class="badge badge-warn" style="margin:0 4px">shadow:${d.shadowWarnings.join(",")}</span>`
        : "";
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">
      ${tools}${shadows}
      <span class="badge badge-info" style="margin:0 4px" title="Dashboard Contract v1.0">Listening ${listenUrl}</span>
      <span class="badge badge-ok" style="margin:0 4px">${rt.runtime} ${rt.version}</span>
      <span style="margin:0 4px;color:var(--muted);font-size:10px">uuid7:${uuid.formats.hex.slice(0, 13)}…</span>
      <span style="margin:0 4px;color:var(--muted);font-size:10px">tc:${d.toolchainBinDir}</span>
      <span style="margin-left:auto">${vars}</span>
    </div>
    <details style="margin-top:8px"><summary style="color:var(--blue);cursor:pointer;font-size:11px">PATH entries (${d.path.length})</summary>
    <table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Path</th><th>Type</th></tr>
    ${d.path
      .map((p, i) => {
        const isToolchain = p.includes(".kimi-code");
        const isBun = p.includes(".bun");
        const type = isToolchain ? "toolchain" : isBun ? "bun" : "system";
        return `<tr><td class="num">${i + 1}.</td><td style="font-size:10px">${p}</td><td><span class="badge badge-${type === "toolchain" ? "ok" : type === "bun" ? "info" : "warn"}">${type}</span></td></tr>`;
      })
      .join("")}
    </table></details>
    <details style="margin-top:4px"><summary style="color:var(--blue);cursor:pointer;font-size:11px">Runtime env (${Object.keys(d.keyVars).length + 4})</summary>
    <table class="tbl" style="margin-top:4px"><tr><th>#</th><th>Variable</th><th>Value</th><th>Type</th></tr>
    ${Object.entries({
      ...d.keyVars,
      CONSOLE_DEPTH: 4,
      BUN_VERSION: rt.bunVersion,
      BUN_REVISION: rt.bunRevision,
      IS_BUN: rt.isBun,
    })
      .map((kv, i) => {
        const [k, v] = kv;
        const t =
          v === "unset"
            ? "unset"
            : k === "CONSOLE_DEPTH"
              ? "number"
              : typeof v === "boolean"
                ? "boolean"
                : "string";
        return `<tr><td class="num">${i + 1}.</td><td><code>${k}</code></td><td style="font-size:10px">${v}</td><td><span class="badge badge-${t === "unset" ? "warn" : "ok"}">${t}</span></td></tr>`;
      })
      .join("")}
    </table></details>`;
  } catch (e) {
    el.innerHTML = `<span class="status err">${e.message}</span>`;
  }
})();

// Landing zone — system overview stats with auto-refresh + probe server dual health
(async () => {
  const REFRESH_MS = 30000;
  let settings = null;
  try {
    settings = await fetchJson("/api/settings");
  } catch {
    /* optional */
  }

  function resolveProbeBase() {
    const host = settings?.probeHost ?? "127.0.0.1";
    const port =
      settings?.probePort ?? settings?.port ?? settings?.canonicalPort ?? CANONICAL_DASHBOARD_PORT;
    return `http://${host}:${port}`;
  }

  function colorForRatio(ok, total) {
    if (total === 0) return "var(--muted)";
    const ratio = ok / total;
    if (ratio >= 0.95) return "var(--green)";
    if (ratio >= 0.7) return "var(--yellow)";
    return "var(--red)";
  }

  function setStat(statId, value, label, sub, detail, valueColor) {
    const el = document.querySelector(`[data-stat="${statId}"]`);
    if (!el) return;
    const color =
      valueColor || (typeof value === "number" && value > 0 ? "var(--green)" : "var(--text)");
    el.innerHTML = `<div class="value" style="color:${color}">${value}</div>
      <div class="label">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ""}${detail ? `<div class="detail">${detail}</div>` : ""}`;
  }

  // Click-to-scroll
  document.getElementById("landing-zone").addEventListener("click", (e) => {
    const stat = e.target.closest("[data-stat]");
    if (!stat) return;
    const id = stat.getAttribute("data-stat");
    if (id === "cards" || id === "runtime") {
      document.getElementById("card-grid")?.scrollIntoView({ behavior: "smooth" });
    } else if (id === "artifacts") {
      document.getElementById("card-artifacts")?.scrollIntoView({ behavior: "smooth" });
    } else if (id === "probe") {
      document.getElementById("card-artifacts")?.scrollIntoView({ behavior: "smooth" });
    } else if (id === "convergence") {
      document.getElementById("card-convergence")?.scrollIntoView({ behavior: "smooth" });
    }
  });

  // Refresher
  async function refreshLanding() {
    const now = new Date().toLocaleTimeString();
    try {
      settings = await fetchJson("/api/settings");
    } catch {
      /* keep prior */
    }

    const probeBase = resolveProbeBase();
    let probeCards = null;
    let probeArts = null;

    // Probe server: cards + artifacts (fire-and-forget, best-effort)
    try {
      const [pc, pa] = await Promise.all([
        fetch(`${probeBase}/api/cards`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${probeBase}/api/artifacts`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      probeCards = pc;
      probeArts = pa;
    } catch {
      /* probe unreachable */
    }

    // Cards tile: dashboard + probe server
    try {
      const cards = await fetchJson("/api/cards?probe=true");
      const ok = cards.cards.filter((c) => c.status === "ok").length;
      const total = settings?.cardCount ?? cards.total;
      let sub = `${total - ok} not passing`;
      if (probeCards?.cards) {
        const probeOk = probeCards.cards.filter((c) => c.status === "pass").length;
        const probeFail = probeCards.cards.filter((c) => c.status === "fail").length;
        const probeSkip = probeCards.cards.filter((c) => c.status === "skip").length;
        sub += ` · probe ${probeOk}/${probeCards.total} pass`;
        if (probeFail > 0 || probeSkip > 0) {
          sub += ` (${probeFail} fail · ${probeSkip} skip)`;
        }
      }
      setStat(
        "cards",
        `${ok}/${total}`,
        "cards passing",
        sub,
        `dashboard · refreshed ${now}`,
        colorForRatio(ok, total)
      );
    } catch {
      setStat("cards", "—", "cards", "unavailable", `refreshed ${now}`);
    }

    // Runtime
    try {
      const rt = await fetchJson("/api/runtime-info");
      setStat(
        "runtime",
        rt.runtime,
        `${rt.version.split("-")[0]}`,
        rt.bunVersion,
        `refreshed ${now}`
      );
    } catch {
      setStat("runtime", "—", "runtime", "unavailable", `refreshed ${now}`);
    }

    // Artifact gates: dashboard + probe
    try {
      const arts = await fetchJson("/api/artifacts");
      const withSaved = (arts.artifacts || []).filter((r) => (r.count ?? 0) > 0);
      const gateNames = withSaved.map((r) => r.gate).join(", ");
      let sub = gateNames.length > 40 ? `${gateNames.slice(0, 40)}…` : gateNames;
      if (probeArts?.gates) {
        sub += ` · probe ${probeArts.count} gates`;
      }
      setStat(
        "artifacts",
        withSaved.length,
        "artifact gates",
        sub || undefined,
        `refreshed ${now}`
      );
    } catch {
      setStat("artifacts", "—", "artifacts", "unavailable", `refreshed ${now}`);
    }

    // Dual health
    try {
      const dashHealth = await fetch("/api/health", { method: "HEAD" });
      const dashOk = dashHealth.ok;
      const probeOk = !!(probeCards || probeArts); // probe reachable if either endpoint responded

      const summary = dashOk && probeOk ? "✓ ✓" : dashOk ? "✓ ✗" : probeOk ? "✗ ✓" : "✗ ✗";
      const sub = dashOk
        ? probeOk
          ? "both healthy"
          : "dashboard up · probe unreachable"
        : probeOk
          ? "dashboard down · probe up"
          : "both down";
      const dashLabel = settings ? `dashboard :${settings.port}` : "dashboard";
      const probeLabel = `${settings?.probeHost ?? "127.0.0.1"}:${settings?.probePort ?? settings?.port ?? CANONICAL_DASHBOARD_PORT}`;
      setStat(
        "probe",
        summary,
        sub,
        `${dashLabel} · probe ${probeLabel}`,
        `refreshed ${now}`,
        dashOk && probeOk ? "var(--green)" : dashOk || probeOk ? "var(--yellow)" : "var(--red)"
      );
    } catch {
      setStat("probe", "✗ ✗", "both down", "unreachable", `refreshed ${now}`, "var(--red)");
    }
  }

  // Stale indicator — dim tiles when data is >90s old
  let staleTimer = null;
  function markStale() {
    document.querySelectorAll(".landing-stat").forEach((el) => el.classList.add("stale"));
  }
  function clearStale() {
    document.querySelectorAll(".landing-stat").forEach((el) => el.classList.remove("stale"));
    clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, 90000);
  }

  // Pulse on update — brief blue glow when new data arrives
  function pulseLanding() {
    document.querySelectorAll(".landing-stat").forEach((el) => {
      el.classList.remove("refreshed");
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add("refreshed");
    });
  }

  // Error resilience: track consecutive failures per tile
  const landingErrors = { cards: 0, runtime: 0, artifacts: 0, probe: 0 };
  function setStatErrored(statId) {
    landingErrors[statId] = (landingErrors[statId] || 0) + 1;
    const warn = landingErrors[statId] >= 3 ? ' <span class="err-icon">⚠</span>' : "";
    setStat(
      statId,
      "—",
      `unavailable${warn}`,
      `failures: ${landingErrors[statId]}`,
      `refreshed ${new Date().toLocaleTimeString()}`
    );
  }
  function setStatOk(statId) {
    landingErrors[statId] = 0;
  }

  // Wrapper: tries fetch, resets error count on success, increments on failure
  async function refreshLandingSafe(statId, fetch, render) {
    try {
      await render();
      setStatOk(statId);
      return true;
    } catch {
      setStatErrored(statId);
      return false;
    }
  }

  // Refresher (rewired with error tracking)
  async function refreshLanding() {
    const now = new Date().toLocaleTimeString();
    try {
      settings = await fetchJson("/api/settings");
    } catch {
      /* keep prior */
    }

    const probeBase = resolveProbeBase();
    let probeCards = null;
    let probeArts = null;

    // Probe server: cards + artifacts (fire-and-forget, best-effort)
    try {
      const [pc, pa] = await Promise.all([
        fetch(`${probeBase}/api/cards`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${probeBase}/api/artifacts`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      probeCards = pc;
      probeArts = pa;
    } catch {
      /* probe unreachable */
    }

    // Cards tile
    await refreshLandingSafe(
      "cards",
      () => fetchJson("/api/cards?probe=true"),
      async () => {
        const cards = await fetchJson("/api/cards?probe=true");
        const ok = cards.cards.filter((c) => c.status === "ok").length;
        const total = settings?.cardCount ?? cards.total;
        let sub = `${total - ok} not passing`;
        if (probeCards?.cards) {
          const probeOk = probeCards.cards.filter((c) => c.status === "pass").length;
          const probeFail = probeCards.cards.filter((c) => c.status === "fail").length;
          const probeSkip = probeCards.cards.filter((c) => c.status === "skip").length;
          sub += ` · probe ${probeOk}/${probeCards.total} pass`;
          if (probeFail > 0 || probeSkip > 0) {
            sub += ` (${probeFail} fail · ${probeSkip} skip)`;
          }
        }
        setStat(
          "cards",
          `${ok}/${total}`,
          "cards passing",
          sub,
          `dashboard · refreshed ${now}`,
          colorForRatio(ok, total)
        );
      }
    );

    // Runtime
    await refreshLandingSafe(
      "runtime",
      () => fetchJson("/api/runtime-info"),
      async () => {
        const rt = await fetchJson("/api/runtime-info");
        setStat(
          "runtime",
          rt.runtime,
          `${rt.version.split("-")[0]}`,
          rt.bunVersion,
          `refreshed ${now}`
        );
      }
    );

    // Artifact gates
    await refreshLandingSafe(
      "artifacts",
      () => fetchJson("/api/artifacts"),
      async () => {
        const arts = await fetchJson("/api/artifacts");
        const withSaved = (arts.artifacts || []).filter((r) => (r.count ?? 0) > 0);
        const gateNames = withSaved.map((r) => r.gate).join(", ");
        let sub = gateNames.length > 40 ? `${gateNames.slice(0, 40)}…` : gateNames;
        if (probeArts?.gates) sub += ` · probe ${probeArts.count} gates`;
        setStat(
          "artifacts",
          withSaved.length,
          "artifact gates",
          sub || undefined,
          `refreshed ${now}`
        );
      }
    );

    // Dual health
    await refreshLandingSafe(
      "probe",
      () => fetch("/api/health", { method: "HEAD" }),
      async () => {
        const dashHealth = await fetch("/api/health", { method: "HEAD" });
        const dashOk = dashHealth.ok;
        const probeOk = !!(probeCards || probeArts);
        const summary = dashOk && probeOk ? "✓ ✓" : dashOk ? "✓ ✗" : probeOk ? "✗ ✓" : "✗ ✗";
        const sub = dashOk
          ? probeOk
            ? "both healthy"
            : "dashboard up · probe unreachable"
          : probeOk
            ? "dashboard down · probe up"
            : "both down";
        const dashLabel = settings ? `dashboard :${settings.port}` : "dashboard";
        const probeLabel = `${settings?.probeHost ?? "127.0.0.1"}:${settings?.probePort ?? settings?.port ?? CANONICAL_DASHBOARD_PORT}`;
        setStat(
          "probe",
          summary,
          sub,
          `${dashLabel} · probe ${probeLabel}`,
          `refreshed ${now}`,
          dashOk && probeOk ? "var(--green)" : dashOk || probeOk ? "var(--yellow)" : "var(--red)"
        );
      }
    );

    // Convergence
    await refreshLandingSafe(
      "convergence",
      () => fetchJson("/api/artifact-graph"),
      async () => {
        const cg = await fetchJson("/api/artifact-graph");
        const aligned = cg.artifactGraph?.aligned ?? false;
        const count = cg.artifactGraph?.gateCount ?? 0;
        setStat(
          "convergence",
          aligned ? "✓" : "✗",
          aligned ? "aligned" : "drift",
          `${count} gates · ${cg.artifactGraph?.artifactCount ?? 0} nodes`,
          `refreshed ${now}`,
          aligned ? "var(--green)" : "var(--red)"
        );
      }
    );
  }
  // Activity bar — latest run manifest from probe server
  function renderActivity(runManifest, probeBase) {
    const el = document.getElementById("activity-bar");
    if (!el) return;
    const m = runManifest?.manifest || runManifest;
    if (m?.runId) {
      const gates = (m.gates || []).join(", ");
      const statusColor =
        m.status === "pass" ? "var(--green)" : m.status === "fail" ? "var(--red)" : "var(--yellow)";
      el.innerHTML = `Last run: <code style="color:var(--blue)">${m.runId.slice(0, 32)}…</code> · ${m.gates?.length || 0} gates: ${gates.slice(0, 50)} · <span style="color:${statusColor}">${m.status}</span> · probe: <code>${probeBase.replace("http://", "")}</code>`;
    } else {
      el.innerHTML = `No run manifests yet · Save one with <code style="color:var(--blue)">kimi-doctor --run-gates --save-artifact</code> · probe: <code>${probeBase.replace("http://", "")}</code>`;
    }
  }

  // Attempt to load latest run manifest from probe server
  async function refreshActivity() {
    const el = document.getElementById("activity-bar");
    if (!el) return;
    try {
      const probeBase = resolveProbeBase();
      const runList = await fetch(`${probeBase}/api/runs`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      let manifest = null;
      if (runList?.runs?.length > 0) {
        const latestId = runList.runs[0].runId;
        try {
          manifest = await fetch(`${probeBase}/api/runs/${encodeURIComponent(latestId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
        } catch {
          /* manifest not found */
        }
      }
      renderActivity(manifest, probeBase);
    } catch {
      if (el) el.innerHTML = '<span style="color:var(--muted)">Activity unavailable</span>';
    }
  }

  await refreshActivity();
  await refreshLanding();
  pulseLanding();
  clearStale();
  window.__EXAMPLES_DASHBOARD_READY__ = true;
  setInterval(() => {
    refreshLanding().then(pulseLanding);
    clearStale();
  }, REFRESH_MS);
})();

export function card(id, body) {
  const el = document.getElementById(id);
  el.innerHTML = el.querySelector("h2").outerHTML + body;
}

/** Legacy dashboard.js — attach module exports to window for classic script loaders. */
if (typeof window !== "undefined") {
  window.fetchJson = fetchJson;
  window.card = card;
  window.lineageBadgeFromRow = lineageBadgeFromRow;
  window.setCanvasFilterIds = setCanvasFilterIds;
  window.fetchAndApplyCanvasDeepLink = fetchAndApplyCanvasDeepLink;
}

/** Lazy lane loaders — dynamic import() when cards enter viewport. */
(function wireLazyLaneLoaders() {
  const loaded = new Map();
  const cardToLane = new Map();
  for (const [lane, ids] of Object.entries(DASHBOARD_LOADER_LANES)) {
    for (const id of ids) cardToLane.set(id, lane);
  }

  function loadLane(lane) {
    if (loaded.has(lane)) return loaded.get(lane);
    const promise = import(`/dashboard-loaders/${lane}.js`).catch((err) => {
      loaded.delete(lane);
      throw err;
    });
    loaded.set(lane, promise);
    return promise;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const lane = cardToLane.get(entry.target.id);
        if (lane) void loadLane(lane);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "240px" }
  );

  for (const id of DASHBOARD_HUB_PRELOAD) {
    const lane = cardToLane.get(id);
    if (lane) void loadLane(lane);
  }

  for (const id of cardToLane.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
})();
