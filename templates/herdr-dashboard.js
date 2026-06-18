let lastAgentsJson = "";
let lastHandoffsJson = "";
let lastRulesJson = "";
let pollTimer = null;
let metaTimer = null;
let sseFallbackTimer = null;
let activeTab = "agents";
let metaSnapshot = null;

function auditDashboard(event, data = {}) {
  console.log(`dashboard.${event}`, data);
}

const statusClass = (status) => {
  const key = (status || "unknown").toLowerCase();
  if (["idle", "working", "blocked", "done", "stale"].includes(key)) {
    return `status-${key}`;
  }
  return "status-unknown";
};

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function ipcCommand(command, args) {
  const payload = { command, args };
  const ipcTag = "__HERDR" + "_IPC__";
  console.log(ipcTag, payload);
  if (window.herdr?.postMessage) return window.herdr.postMessage(payload);
  return fetch("/api/ipc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function attachAgent(row) {
  ipcCommand("agent.attach", {
    agent: row.agent,
    host: row.host,
    session: row.session,
    workspaceId: row.workspaceId,
    paneId: row.paneId,
  });
}
function stopAgent(row) {
  ipcCommand("agent.stop", {
    agent: row.agent,
    host: row.host,
    session: row.session,
  });
}
function restartAgent(row) {
  ipcCommand("agent.restart", {
    agent: row.agent,
    host: row.host,
    session: row.session,
  });
}

async function sendHeartbeats(agents) {
  if (!agents.length) return;
  await fetch("/api/heartbeats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agents: agents.map((row) => ({
        agent: row.agent,
        host: row.host,
        session: row.session,
      })),
    }),
  });
}

function wireAgentThumbnail(data) {
  const wrap = document.getElementById("agent-thumb-wrap");
  const img = document.getElementById("agent-thumb");
  if (!data.thumbnail || !data.thumbnailPath) {
    wrap.classList.remove("visible");
    wrap.setAttribute("aria-hidden", "true");
    return;
  }
  wrap.classList.add("visible");
  wrap.setAttribute("aria-hidden", "false");
  const thumbUrl = `${data.thumbnailPath}?width=160&height=90&quality=75`;
  if (data.placeholder) {
    img.src = data.placeholder;
    img.classList.add("lqip");
  } else {
    img.removeAttribute("src");
    img.classList.remove("lqip");
  }
  const full = new Image();
  full.decoding = "async";
  full.onload = () => {
    img.src = thumbUrl;
    img.classList.remove("lqip");
  };
  full.onerror = () => {
    if (!data.placeholder) {
      wrap.classList.remove("visible");
      wrap.setAttribute("aria-hidden", "true");
    }
  };
  full.src = thumbUrl;
}

function formatHerdrEventsLine(herdr) {
  if (herdr === undefined) {
    return '<span class="herdr-warn">control-plane API outdated — restart dashboard server (bun run sync)</span>';
  }
  if (herdr.enabled === false) {
    return '<span class="herdr-off">herdr events off (dx [herdr.orchestrator.events] enabled=false)</span>';
  }
  if (herdr.pending) {
    return '<span class="herdr-warn">herdr socket starting…</span>';
  }
  if (herdr.error) {
    return `<span class="herdr-warn">herdr events error: ${esc(herdr.error)}</span>`;
  }
  if (herdr.connected) {
    const ws = herdr.workspaceId ? ` · ${esc(herdr.workspaceId)}` : "";
    const subs = herdr.subscriptionCount ?? 0;
    const debounce = herdr.debounceMs ? ` · ${herdr.debounceMs}ms debounce` : "";
    return `<span class="herdr-ok">herdr socket connected</span> · ${subs} subscription(s)${ws}${debounce}`;
  }
  return '<span class="herdr-warn">herdr socket connecting…</span>';
}

function formatWebViewLine(webview) {
  if (webview === undefined) {
    return "webview unavailable — restart dashboard server";
  }
  const shell = webview.shell || "serve";
  const backend = webview.backend ? ` · ${esc(webview.backend)}` : "";
  if (webview.mode === "persistent") {
    const dir = webview.directory || webview.defaultProfileDir || "profile";
    return `<span class="herdr-ok">webview ${esc(shell)}</span> · persistent ${esc(dir)}${backend}`;
  }
  const configured = webview.persistProfile
    ? " (persist configured — WebKit guard may force ephemeral)"
    : "";
  return `<span class="herdr-warn">webview ${esc(shell)} · ephemeral${configured}</span>${backend}`;
}

function formatCacheLine(cache) {
  if (cache === undefined) {
    return "cache unavailable — restart dashboard server";
  }
  if (!cache) return "cache empty";
  const d = cache.discovery || {};
  const s = cache.status || {};
  const hits = d.hits ?? 0;
  const misses = d.misses ?? 0;
  const size = d.size ?? 0;
  const heartbeats = s.size ?? 0;
  return `cache ${hits}h/${misses}m · ${size} discovery · ${heartbeats} heartbeat(s)`;
}

function renderMetaDisplay(data) {
  metaSnapshot = data;
  const staleSec = (data.staleMs || 15000) / 1000;
  const sseSec = (data.ssePollMs || 5000) / 1000;
  const pollSec = (data.pollHintMs || 5000) / 1000;
  document.getElementById("meta").textContent =
    `${data.projectPath || "."} · SSE ${sseSec}s · poll ${pollSec}s · stale threshold ${staleSec}s` +
    (data.dryRun ? " · dry-run" : "");

  const control = document.getElementById("control-plane");
  control.innerHTML = `${formatHerdrEventsLine(data.herdrEvents)} · ${formatCacheLine(data.cache)} · ${formatWebViewLine(data.webview)}`;

  const legend = document.getElementById("agents-legend");
  legend.hidden = false;
  legend.title = `Agents show stale when no server or browser heartbeat for more than ${staleSec}s.`;

  auditDashboard("meta", {
    projectPath: data.projectPath,
    ssePollMs: data.ssePollMs,
    pollHintMs: data.pollHintMs,
    staleMs: data.staleMs,
    dryRun: Boolean(data.dryRun),
    herdrEvents: data.herdrEvents,
    cache: data.cache,
    webview: data.webview,
  });
}

async function loadMeta() {
  const res = await fetch("/api/meta");
  const data = await res.json();
  renderMetaDisplay(data);
  wireAgentThumbnail(data);
  return data.pollHintMs || 5000;
}

function scheduleMetaRefresh(ssePollMs) {
  if (metaTimer) clearInterval(metaTimer);
  const interval = Math.max(ssePollMs || 5000, 3000);
  metaTimer = setInterval(() => {
    void loadMeta();
  }, interval);
}

function showAgentsEmpty(message) {
  const body = document.getElementById("agents-body");
  body.replaceChildren();
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 7;
  td.className = "empty-state";
  td.innerHTML = `<strong>No agents discovered</strong>${esc(message)}`;
  tr.appendChild(td);
  body.appendChild(tr);
}

function renderAgents(data) {
  const agentsJson = JSON.stringify(data.agents || []);
  if (agentsJson === lastAgentsJson) return;
  lastAgentsJson = agentsJson;

  const err = document.getElementById("agents-error");
  const body = document.getElementById("agents-body");
  body.replaceChildren();

  if (!data.ok) {
    err.textContent = data.error || "agents unavailable";
    showAgentsEmpty("Check that Herdr is running and [herdr] is enabled in dx.config.toml.");
    return;
  }
  err.textContent = "";

  const agents = data.agents || [];
  if (agents.length === 0) {
    const hint = data.error
      ? ` Partial errors: ${data.error}`
      : " Start agents in Herdr or run with --sessions to scan all sessions.";
    showAgentsEmpty(hint);
    auditDashboard("agents", { ok: true, count: 0, statuses: {} });
    return;
  }

  for (const row of agents) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.host)}</td>
      <td>${esc(row.session)}</td>
      <td>${esc(row.workspaceId)}</td>
      <td>${esc(row.agent)}</td>
      <td><span class="status ${statusClass(row.status)}"${
        row.status === "stale" && metaSnapshot
          ? ` title="No dashboard heartbeat for more than ${(metaSnapshot.staleMs || 15000) / 1000}s"`
          : ""
      }>${esc(row.status)}</span></td>
      <td>${esc(row.paneId)}</td>
      <td class="actions">
        <button type="button" data-action="attach">Attach</button>
        <button type="button" data-action="stop">Stop</button>
        <button type="button" data-action="restart">Restart</button>
      </td>`;
    const [attachBtn, stopBtn, restartBtn] = tr.querySelectorAll("button");
    attachBtn.addEventListener("click", () => attachAgent(row));
    stopBtn.addEventListener("click", () => stopAgent(row));
    restartBtn.addEventListener("click", () => restartAgent(row));
    body.appendChild(tr);
  }
  void sendHeartbeats(agents);
  const statuses = {};
  for (const row of agents) {
    const key = row.status || "unknown";
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  auditDashboard("agents", {
    ok: data.ok !== false,
    count: agents.length,
    statuses,
    fetchedAt: data.fetchedAt,
  });
}

function stopSseFallback() {
  if (!sseFallbackTimer) return;
  clearInterval(sseFallbackTimer);
  sseFallbackTimer = null;
}

async function pollAgentsFallback() {
  try {
    const res = await fetch("/api/agents");
    renderAgents(await res.json());
  } catch (e) {
    console.error("dashboard.agents.fallback", e);
  }
}

function startSseFallback(intervalMs) {
  stopSseFallback();
  void pollAgentsFallback();
  const interval = Math.max(intervalMs || 5000, 3000);
  sseFallbackTimer = setInterval(() => {
    void pollAgentsFallback();
  }, interval);
}

function connectAgentsLive() {
  const status = document.getElementById("stream-status");
  const source = new EventSource("/api/agents/live");

  const streamNote = () => {
    const herdr = metaSnapshot?.herdrEvents;
    if (herdr?.enabled && herdr.connected) return " · herdr socket";
    if (herdr?.enabled) return " · herdr connecting";
    return "";
  };

  source.onopen = () => {
    stopSseFallback();
    status.textContent = `SSE live ${new Date().toISOString()}${streamNote()}`;
    auditDashboard("stream", { state: "sse-open", herdr: metaSnapshot?.herdrEvents });
  };

  source.onmessage = (event) => {
    stopSseFallback();
    status.textContent = `SSE live ${new Date().toISOString()}${streamNote()}`;
    try {
      renderAgents(JSON.parse(event.data));
    } catch (e) {
      console.error("dashboard.sse.parse", e);
    }
    window.__HERDR_DASHBOARD_READY__ = true;
  };

  source.onerror = () => {
    const interval = metaSnapshot?.ssePollMs || metaSnapshot?.pollHintMs || 5000;
    status.textContent = `SSE disconnected — polling /api/agents every ${interval / 1000}s…`;
    auditDashboard("stream", { state: "sse-fallback", intervalMs: interval });
    startSseFallback(interval);
  };

  return source;
}

async function refreshHandoffs() {
  if (activeTab !== "handoffs") return;
  const res = await fetch("/api/handoffs?limit=80");
  const data = await res.json();
  const json = JSON.stringify(data.entries || []);
  if (json === lastHandoffsJson) return;
  lastHandoffsJson = json;
  const body = document.getElementById("handoffs-body");
  body.replaceChildren();
  for (const row of data.entries || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.timestamp)}</td>
      <td>${esc(row.workspace)}</td>
      <td>${esc(row.agent)}</td>
      <td>${esc(row.action)}</td>
      <td>${esc(row.detail)}</td>
      <td>${row.ok ? "✓" : "✗"}</td>`;
    body.appendChild(tr);
  }
  console.log("dashboard.handoffs", (data.entries || []).length);
}

async function refreshRules() {
  if (activeTab !== "rules") return;
  const res = await fetch("/api/rules");
  const data = await res.json();
  const json = JSON.stringify(data.rules || []);
  if (json === lastRulesJson) return;
  lastRulesJson = json;
  const rulesMeta = document.getElementById("rules-meta");
  rulesMeta.innerHTML = data.dryRun
    ? '<p class="rule-dry">Handoff dry-run is ON</p>'
    : `<p>Log: ${esc(data.logPath)}</p>`;
  rulesMeta.setAttribute("aria-hidden", "false");
  const body = document.getElementById("rules-body");
  body.replaceChildren();
  for (const row of data.rules || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.index}</td>
      <td>${esc(row.condition)}</td>
      <td>${esc(row.lastFired || "—")}</td>
      <td>${esc(row.lastAction || "—")}</td>
      <td>${row.lastOk === undefined ? "—" : row.lastOk ? "✓" : "✗"}</td>`;
    body.appendChild(tr);
  }
  console.log("dashboard.rules", (data.rules || []).length);
}

function scheduleSecondaryPoll(pollMs) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (activeTab === "agents") return;
  pollTimer = setInterval(() => {
    void refreshHandoffs();
    void refreshRules();
  }, pollMs);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`nav button[data-tab="${tab}"]`)?.classList.add("active");
  document.getElementById(tab)?.classList.add("active");
  if (tab === "handoffs") {
    lastHandoffsJson = "";
    void refreshHandoffs();
  } else if (tab === "rules") {
    lastRulesJson = "";
    void refreshRules();
  }
  if (window.__HERDR_DASHBOARD_POLL_MS__) {
    scheduleSecondaryPoll(window.__HERDR_DASHBOARD_POLL_MS__);
  }
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

(async () => {
  const res = await fetch("/api/meta");
  const meta = await res.json();
  renderMetaDisplay(meta);
  wireAgentThumbnail(meta);
  const poll = meta.pollHintMs || 5000;
  window.__HERDR_DASHBOARD_POLL_MS__ = poll;
  scheduleMetaRefresh(meta.ssePollMs);
  connectAgentsLive();
  scheduleSecondaryPoll(poll);
})();
