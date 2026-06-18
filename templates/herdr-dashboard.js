let lastAgentsJson = "";
let lastHandoffsJson = "";
let lastRulesJson = "";
let pollTimer = null;
let activeTab = "agents";

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

async function loadMeta() {
  const res = await fetch("/api/meta");
  const data = await res.json();
  const poll = data.pollHintMs || 5000;
  document.getElementById("meta").textContent =
    `${data.projectPath || "."} · SSE live · stale ${(data.staleMs || 15000) / 1000}s` +
    (data.dryRun ? " · dry-run" : "");
  wireAgentThumbnail(data);
  return poll;
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
    console.log("dashboard.agents", 0);
    return;
  }

  for (const row of agents) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.host)}</td>
      <td>${esc(row.session)}</td>
      <td>${esc(row.workspaceId)}</td>
      <td>${esc(row.agent)}</td>
      <td><span class="status ${statusClass(row.status)}">${esc(row.status)}</span></td>
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
  console.log("dashboard.agents", data.agentCount);
}

function connectAgentsLive() {
  const status = document.getElementById("stream-status");
  const source = new EventSource("/api/agents/live");
  source.onmessage = (event) => {
    status.textContent = `SSE ${new Date().toISOString()}`;
    try {
      renderAgents(JSON.parse(event.data));
    } catch (e) {
      console.error("dashboard.sse.parse", e);
    }
    window.__HERDR_DASHBOARD_READY__ = true;
  };
  source.onerror = () => {
    status.textContent = "SSE disconnected — retrying…";
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
  const poll = await loadMeta();
  window.__HERDR_DASHBOARD_POLL_MS__ = poll;
  connectAgentsLive();
  scheduleSecondaryPoll(poll);
})();
