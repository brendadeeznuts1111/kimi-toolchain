/** Dashboard bootstrap — canvas filter, lineage badges, live card probes. */

// Lazy lanes: perf, governance, toolchain, runtime — see dashboard-loader-lanes.js

// DASHBOARD_CARD_LOADERS:AUTO
// /DASHBOARD_CARD_LOADERS:AUTO

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
        `<button type="button" class="canvas-pill${isActive ? " active" : ""}" data-canvas="${key}" title="${Bun.escapeHTML(c.path)}">${Bun.escapeHTML(label)}</button>`
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
    bar.innerHTML = `<span style="font-size:11px;color:var(--red)">Canvas filter unavailable: ${Bun.escapeHTML(e.message)}</span>`;
  }
})();

// Lineage badges on artifact-lineage influenced cards (synced with identity refresh)
(function wireLineageBadges() {
  const CARD_LINEAGE_MAP = [
    { cardId: "card-gates", gates: null },
    { cardId: "card-bunfig-policy", gates: ["bunfig-policy"] },
    { cardId: "card-kimi-doctor", gates: ["perf-gate", "bunfig-policy", "card-probe"] },
    { cardId: "card-metrics-schema", gates: ["metrics-schema"] },
    { cardId: "card-trace-verify", gates: ["trace-verify"] },
    { cardId: "card-trace-ledger", gates: ["trace-ledger"] },
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
          `<span class="badge badge-warn lineage-badge" title="No saved artifacts for ${gates.join(", ")} — run: kimi-doctor --gate perf-gate --save-artifact">art:0</span>`
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
