const SESSION_STORAGE_KEY = "herdr-dashboard.activeSession";
const SESSION_ALL = "__all__";
const STATIC_PREVIEW = window.location.protocol === "file:";
const STATIC_API_ORIGIN = globalThis.__HERDR_DASHBOARD_API_ORIGIN__ || "http://127.0.0.1:18412";
const nativeFetch = globalThis.fetch.bind(globalThis);
let lastFilteredAgentsJson = "";
let lastHandoffsJson = "";
let lastRulesJson = "";
let lastScanJson = "";
let lastCanvasesJson = "";
let lastArtifactsJson = "";
let lastLineageGateGraph = "";
let lastLineageArtifactKey = "";
let mermaidReady = false;
let gateHealthPollTimer = null;
let lastEventsJson = "";
let eventsTypeFilter = "";
let lastDebugLogsJson = "";
let debugLogsSink = "tool-failures";
let debugLogsTail = 50;
let debugLogsTabTimer = null;
const DEBUG_LOGS_POLL_MS = 10_000;
let pollTimer = null;
let processesPollTimer = null;
let metaTimer = null;
let sseFallbackTimer = null;
let lastProcessesJson = "";
let lastGitJson = "";
let processesExpanded = false;
let gitExpanded = false;
const LOGS_DEFAULT_LINES = 50;
const LOGS_MAX_LINES = 200;
const LOGS_LINE_STEP = 50;
const LOGS_TAIL_POLL_MS = 1500;
let activeLogsPaneId = null;
let activeLogsLineLimit = LOGS_DEFAULT_LINES;
let lastLogsPayload = null;
let logsTailEnabled = false;
let logsTailPaused = false;
let logsTotalLines = 0;
let logsDisplayedLines = [];
let logsTailTimer = null;
let activeTab = "agents";
let metaSnapshot = null;
let lastAgentsPayload = null;
let lastHealthPayload = null;
let healthPollTimer = null;
const HEALTH_POLL_MS = 10_000;
let activeSession = loadActiveSession();
let thumbLive = false;
let examplesDashboardUrl = null;
let examplesLoadTimer = null;

function apiUrl(path) {
  if (!STATIC_PREVIEW || typeof path !== "string" || !path.startsWith("/api/")) {
    return path;
  }
  return new URL(path, STATIC_API_ORIGIN).toString();
}

function resolveFetchInput(input) {
  if (typeof input === "string") return apiUrl(input);
  if (input instanceof URL) return new URL(apiUrl(`${input.pathname}${input.search}${input.hash}`));
  return input;
}

globalThis.fetch = (input, init) => nativeFetch(resolveFetchInput(input), init);

/**
 * Panel registry — central place for adding/removing dashboard tabs.
 *
 * Each entry maps a tab id (matching the HTML `id="<id>"` and `data-tab="<id>"`)
 * to lifecycle hooks. `activate` runs when the tab becomes visible; `deactivate`
 * runs when the user leaves it. Keep panel-specific timers in these hooks so
 * unused tabs do not poll the server.
 *
 * To add a new tab:
 *   1. Add a `<button data-tab="my-tab">Label</button>` in `<nav>`.
 *   2. Add a `<section id="my-tab" class="panel">...</section>` in `<main>`.
 *   3. Register it here: PANELS["my-tab"] = { label: "Label", activate() {...} }.
 */
const PANELS = {
  agents: {
    label: "Agents",
    activate() {
      if (lastAgentsPayload) renderAgents(lastAgentsPayload);
      if (lastHealthPayload) renderSummaryCards(lastHealthPayload);
    },
  },
  handoffs: {
    label: "Handoff history",
    activate() {
      lastHandoffsJson = "";
      void refreshHandoffs();
    },
  },
  rules: {
    label: "Rules",
    activate() {
      lastRulesJson = "";
      void refreshRules();
    },
  },
  scan: {
    label: "Upgrade scan",
    activate() {
      lastScanJson = "";
      void refreshScan();
    },
  },
  canvases: {
    label: "Canvases",
    activate() {
      lastCanvasesJson = "";
      void refreshCanvases();
    },
  },
  metrics: {
    label: "Metrics",
    activate() {
      void refreshMetrics();
    },
  },
  artifacts: {
    label: "Artifacts",
    activate() {
      lastArtifactsJson = "";
      void refreshArtifacts();
    },
  },
  lineage: {
    label: "Lineage",
    activate() {
      lastLineageGateGraph = "";
      lastLineageArtifactKey = "";
      void refreshLineage();
    },
  },
  events: {
    label: "Events",
    activate() {
      lastEventsJson = "";
      void refreshEvents();
    },
  },
  logs: {
    label: "Logs",
    activate() {
      lastDebugLogsJson = "";
      void refreshDebugLogs();
      scheduleDebugLogsPoll();
    },
    deactivate() {
      if (debugLogsTabTimer) {
        clearInterval(debugLogsTabTimer);
        debugLogsTabTimer = null;
      }
    },
  },
  examples: {
    label: "Examples",
    activate() {
      const frame = document.getElementById("examples-frame");
      if (examplesDashboardUrl && frame && !frame.src.includes(examplesDashboardUrl)) {
        void loadExamplesDashboard(examplesDashboardUrl);
      }
    },
  },
};

/** Register a new panel at runtime (useful for plugin-style extensions). */
globalThis.__herdrRegisterPanel = function registerPanel(id, panel) {
  PANELS[id] = panel;
};

function loadActiveSession() {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored === null) return "";
    return stored === SESSION_ALL ? SESSION_ALL : String(stored);
  } catch {
    return "";
  }
}

function saveActiveSession(value) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, value);
  } catch {
    /* sessionStorage unavailable */
  }
}

function showStaticPanelNotice(tab = activeTab) {
  const panel = document.getElementById(tab);
  const target =
    panel?.querySelector(".error") ||
    panel?.querySelector(".empty-state") ||
    document.getElementById("agents-error");
  if (!target) return;
  target.innerHTML = `Waiting for the local dashboard API at <a href="${STATIC_API_ORIGIN}/">${STATIC_API_ORIGIN}</a>.`;
}

function normalizeSessionValue(session) {
  return String(session ?? "").trim();
}

function sessionDisplayLabel(session, primaryLabel = "primary") {
  return normalizeSessionValue(session) ? session : primaryLabel;
}

function distinctSessionsFromAgents(agents) {
  const seen = new Set();
  for (const row of agents || []) {
    seen.add(normalizeSessionValue(row.session));
  }
  return [...seen].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
}

function sessionIdsFromDiscovery(discovery, agents) {
  const fromMeta = discovery?.sessionsAvailable;
  if (Array.isArray(fromMeta) && fromMeta.length > 0)
    return fromMeta.map((id) => normalizeSessionValue(id));
  return distinctSessionsFromAgents(agents);
}

function sessionCatalogById(discovery) {
  const catalog = discovery?.sessionCatalog;
  if (!Array.isArray(catalog)) return new Map();
  return new Map(catalog.map((row) => [normalizeSessionValue(row.session), row]));
}

function shouldShowSessionSelector(discovery, agents) {
  if (discovery?.multiSessionEnabled) return true;
  const sessions = sessionIdsFromDiscovery(discovery, agents);
  return sessions.length > 1 || (sessions.length === 1 && sessions[0] !== "");
}

function filterAgentsBySession(agents, session) {
  const rows = agents || [];
  if (session === SESSION_ALL) return rows;
  const target = normalizeSessionValue(session);
  return rows.filter((row) => normalizeSessionValue(row.session) === target);
}

function processesSessionParam() {
  if (activeSession === SESSION_ALL) return null;
  return normalizeSessionValue(activeSession);
}

function gitSessionParam() {
  return processesSessionParam();
}

function truncateCwd(cwd, max = 48) {
  const text = String(cwd ?? "").trim();
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
}

function updateProcessesSummary(count, label, details = {}) {
  const summary = document.getElementById("processes-summary");
  if (!summary) return;
  const suffix = label ? ` · ${label}` : "";
  const agentCount = typeof details.agentCount === "number" ? details.agentCount : null;
  const shellCount = typeof details.shellCount === "number" ? details.shellCount : null;
  const focusedPane = details.focusedPane ? ` · focus ${details.focusedPane}` : "";
  const composition =
    agentCount === null || shellCount === null
      ? ""
      : ` · ${agentCount} agent · ${shellCount} shell`;
  summary.textContent = `· ${count} pane${count === 1 ? "" : "s"}${composition}${focusedPane}${suffix}`;
}

function updateGitSummary(branch, changedCount, label) {
  const summary = document.getElementById("git-summary");
  if (!summary) return;
  const suffix = label ? ` · ${label}` : "";
  const branchLabel = branch || "—";
  const dirtyLabel =
    typeof changedCount === "number"
      ? changedCount === 0
        ? "clean"
        : `${changedCount} changed`
      : "—";
  summary.textContent = `· ${branchLabel} · ${dirtyLabel}${suffix}`;
}

function gitStatusClass(xy) {
  const code = String(xy ?? "").trim();
  if (code.includes("?")) return "git-xy-untracked";
  if (code.includes("D")) return "git-xy-deleted";
  if (code.includes("A")) return "git-xy-added";
  if (code.includes("M")) return "git-xy-modified";
  return "git-xy-untracked";
}

function gitStatusLabel(xy) {
  const code = String(xy ?? "");
  if (code.includes("?")) return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("M")) return "modified";
  return code.trim() ? "changed" : "clean";
}

function gitStatusTone(xy) {
  const label = gitStatusLabel(xy);
  if (label === "deleted") return "error";
  if (label === "added") return "ok";
  if (label === "modified" || label === "renamed") return "warn";
  if (label === "untracked") return "neutral";
  return "info";
}

function wireGitToggle() {
  const toggle = document.getElementById("git-toggle");
  const content = document.getElementById("git-content");
  if (!toggle || !content || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  toggle.addEventListener("click", () => {
    gitExpanded = !gitExpanded;
    toggle.setAttribute("aria-expanded", gitExpanded ? "true" : "false");
    content.hidden = !gitExpanded;
    if (gitExpanded) {
      lastGitJson = "";
      void fetchGit();
    }
  });
}

function renderGitEmpty(tbodyId, message, colSpan) {
  const body = document.getElementById(tbodyId);
  if (!body) return;
  body.replaceChildren();
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colSpan;
  td.className = "empty-state";
  td.textContent = message;
  tr.appendChild(td);
  body.appendChild(tr);
}

function renderGit(data) {
  const primaryLabel = metaSnapshot?.discovery?.herdrSessionLabel || "primary";
  const sessionLabel = data.sessionLabel || sessionDisplayLabel(data.session, primaryLabel);
  const err = document.getElementById("git-error");
  if (err) err.textContent = "";

  if (!data.available) {
    updateGitSummary("—", null, sessionLabel);
    const message = data.error || data.message || "git unavailable";
    if (err) err.textContent = message;
    if (gitExpanded) {
      renderGitEmpty("git-status-body", message, 3);
      renderGitEmpty("git-commits-body", message, 3);
    }
    auditDashboard("git", {
      available: false,
      session: data.session,
      error: data.error || data.message,
    });
    return;
  }

  const payload = data.data || {};
  const branch = payload.branch || "unknown";
  const changedCount = payload.changedCount ?? payload.status?.length ?? 0;
  updateGitSummary(branch, changedCount, sessionLabel);

  const json = JSON.stringify(payload);
  if (json === lastGitJson) return;
  lastGitJson = json;

  if (!gitExpanded) {
    auditDashboard("git", {
      available: true,
      branch,
      changedCount,
      session: data.session,
      collapsed: true,
    });
    return;
  }

  const statusRows = payload.status || [];
  const statusBody = document.getElementById("git-status-body");
  if (statusBody) {
    statusBody.replaceChildren();
    if (statusRows.length === 0) {
      renderGitEmpty("git-status-body", "Working tree clean", 3);
    } else {
      for (const row of statusRows) {
        const tr = document.createElement("tr");
        const kind = gitStatusLabel(row.xy);
        tr.innerHTML = `
          <td><span class="git-xy ${gitStatusClass(row.xy)}">${esc(row.xy)}</span></td>
          <td>${tagHtml(kind, gitStatusTone(row.xy))}</td>
          <td>${esc(row.path)}</td>`;
        statusBody.appendChild(tr);
      }
    }
  }

  const commits = payload.commits || [];
  const commitsBody = document.getElementById("git-commits-body");
  if (commitsBody) {
    commitsBody.replaceChildren();
    if (commits.length === 0) {
      renderGitEmpty("git-commits-body", "No commits", 3);
    } else {
      for (const row of commits) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="git-sha">${esc(row.sha)}</span></td>
          <td>${esc(row.subject)}</td>
          <td class="git-date">${esc(row.date)}</td>`;
        commitsBody.appendChild(tr);
      }
    }
  }

  auditDashboard("git", {
    available: true,
    branch,
    changedCount,
    commitCount: commits.length,
    session: data.session,
    fetchedAt: data.fetchedAt,
  });
}

async function fetchGit() {
  const session = gitSessionParam();
  if (session === null) {
    lastGitJson = "";
    updateGitSummary("—", null, "all sessions");
    const err = document.getElementById("git-error");
    if (err) err.textContent = "";
    if (gitExpanded) {
      renderGitEmpty("git-status-body", "Select a single session to view git status", 3);
      renderGitEmpty("git-commits-body", "Select a single session to view git status", 3);
    }
    return;
  }

  try {
    const res = await fetch(`/api/widgets/git?session=${encodeURIComponent(session)}`);
    const data = await res.json();
    renderGit(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = document.getElementById("git-error");
    if (err) err.textContent = message;
    updateGitSummary("—", null);
    if (gitExpanded) {
      renderGitEmpty("git-status-body", message, 3);
      renderGitEmpty("git-commits-body", message, 3);
    }
    console.error("dashboard.git", error);
  }
}

function wireProcessesToggle() {
  const toggle = document.getElementById("processes-toggle");
  const content = document.getElementById("processes-content");
  if (!toggle || !content || toggle.dataset.wired === "1") return;
  toggle.dataset.wired = "1";
  toggle.addEventListener("click", () => {
    processesExpanded = !processesExpanded;
    toggle.setAttribute("aria-expanded", processesExpanded ? "true" : "false");
    content.hidden = !processesExpanded;
    if (processesExpanded) {
      lastProcessesJson = "";
      void fetchProcesses();
    }
  });
}

function renderProcessesEmpty(message) {
  const body = document.getElementById("processes-body");
  if (!body) return;
  body.replaceChildren();
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 9;
  td.className = "empty-state";
  td.textContent = message;
  tr.appendChild(td);
  body.appendChild(tr);
}

const PANE_ACTION_LABELS = {
  focus: "Focus pane",
  zoom: "Zoom pane",
  kill: "Close pane",
};

function appendPaneActionButtons(tr, paneId) {
  const td = document.createElement("td");
  td.className = "processes-actions";
  for (const action of ["focus", "zoom", "kill"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `processes-action${action === "kill" ? " processes-action-kill" : ""}`;
    btn.dataset.action = action;
    btn.title = PANE_ACTION_LABELS[action];
    btn.setAttribute("aria-label", PANE_ACTION_LABELS[action]);
    btn.textContent = action === "kill" ? "✕" : action === "focus" ? "⌖" : "⤢";
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      void runPaneAction(paneId, action);
    });
    td.appendChild(btn);
  }
  tr.appendChild(td);
}

async function runPaneAction(paneId, action) {
  const session = processesSessionParam();
  if (!session) {
    const err = document.getElementById("processes-error");
    if (err) err.textContent = "Select a single session to run pane actions";
    return;
  }
  if (action === "kill") {
    const ok = confirm(`Close pane ${paneId}?`);
    if (!ok) return;
  }

  const err = document.getElementById("processes-error");
  if (err) err.textContent = "";

  try {
    const res = await fetch("/api/widgets/processes/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paneId, session, action }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || data.message || `${action} failed`);
    }
    if (action === "kill" && activeLogsPaneId === paneId) {
      resetLogsPanelState();
      removeLogsRows();
    }
    lastProcessesJson = "";
    void fetchProcesses();
    auditDashboard("processes.action", {
      ok: true,
      action,
      paneId,
      session: data.session,
      message: data.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (err) err.textContent = message;
    console.error("dashboard.processes.action", error);
    auditDashboard("processes.action", { ok: false, action, paneId, error: message });
  }
}

function renderProcesses(data) {
  const primaryLabel = metaSnapshot?.discovery?.herdrSessionLabel || "primary";
  const sessionLabel = data.sessionLabel || sessionDisplayLabel(data.session, primaryLabel);
  const err = document.getElementById("processes-error");
  if (err) err.textContent = "";

  if (!data.available) {
    updateProcessesSummary(0, sessionLabel);
    const message = data.error || data.message || "processes unavailable";
    if (err) err.textContent = message;
    if (processesExpanded) {
      renderProcessesEmpty(message);
    }
    auditDashboard("processes", {
      available: false,
      session: data.session,
      error: data.error || data.message,
    });
    return;
  }

  const panes = data.data?.panes || [];
  const count = data.data?.paneCount ?? panes.length;
  const agentCount = panes.filter((pane) => pane.agent).length;
  const shellCount = Math.max(0, panes.length - agentCount);
  const focusedPane = panes.find((pane) => pane.focused)?.paneId || "";
  updateProcessesSummary(count, sessionLabel, { agentCount, shellCount, focusedPane });

  const json = JSON.stringify(panes);
  if (json === lastProcessesJson) return;
  lastProcessesJson = json;

  if (!processesExpanded) {
    auditDashboard("processes", { available: true, count, session: data.session, collapsed: true });
    return;
  }

  const body = document.getElementById("processes-body");
  if (!body) return;
  body.replaceChildren();

  if (panes.length === 0) {
    renderProcessesEmpty("No panes in this session");
    auditDashboard("processes", { available: true, count: 0, session: data.session });
    return;
  }

  for (const row of panes) {
    const tr = document.createElement("tr");
    tr.className = "processes-row";
    tr.dataset.paneId = row.paneId;
    if (row.focused) tr.classList.add("processes-focused");
    if (activeLogsPaneId === row.paneId) tr.classList.add("processes-row-active");
    const agent = row.agent ? esc(row.agent) : "—";
    const kind = row.agent ? "agent" : "shell";
    const agentStatus = row.agentStatus
      ? `<span class="status ${statusClass(row.agentStatus)}">${esc(row.agentStatus)}</span>`
      : "—";
    tr.innerHTML = `
      <td>${esc(row.paneId)}</td>
      <td title="${esc(row.title || "")}">${esc(row.tabId || "—")}</td>
      <td>${esc(row.workspaceId || "—")}</td>
      <td>${tagHtml(row.focused ? "focused" : "background", row.focused ? "ok" : "neutral")}</td>
      <td>${tagHtml(kind, kind === "agent" ? "info" : "neutral")}</td>
      <td>${agent}</td>
      <td>${agentStatus}</td>
      <td class="processes-cwd" title="${esc(row.cwd)}">${esc(truncateCwd(row.cwd))}</td>`;
    appendPaneActionButtons(tr, row.paneId);
    tr.addEventListener("click", () => onProcessesPaneClick(row.paneId));
    body.appendChild(tr);
  }

  if (activeLogsPaneId && !panes.some((row) => row.paneId === activeLogsPaneId)) {
    resetLogsPanelState();
  } else if (activeLogsPaneId) {
    if (lastLogsPayload?.paneId === activeLogsPaneId) {
      attachLogsRow(lastLogsPayload);
    } else {
      void fetchPaneLogs(activeLogsPaneId);
    }
  }

  auditDashboard("processes", {
    available: true,
    count: panes.length,
    session: data.session,
    focused: panes.filter((row) => row.focused).map((row) => row.paneId),
    fetchedAt: data.fetchedAt,
  });
}

async function fetchProcesses() {
  const session = processesSessionParam();
  if (session === null) {
    lastProcessesJson = "";
    updateProcessesSummary(0, "all sessions");
    const err = document.getElementById("processes-error");
    if (err) err.textContent = "";
    if (processesExpanded) {
      renderProcessesEmpty("Select a single session to view processes");
    }
    return;
  }

  try {
    const res = await fetch(`/api/widgets/processes?session=${encodeURIComponent(session)}`);
    const data = await res.json();
    renderProcesses(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = document.getElementById("processes-error");
    if (err) err.textContent = message;
    updateProcessesSummary(0);
    if (processesExpanded) renderProcessesEmpty("No panes in this session");
    console.error("dashboard.processes", error);
  }
}

function resetLogsPanelState() {
  stopLogsTailPoll();
  activeLogsPaneId = null;
  lastLogsPayload = null;
  activeLogsLineLimit = LOGS_DEFAULT_LINES;
  logsTailEnabled = false;
  logsTailPaused = false;
  logsTotalLines = 0;
  logsDisplayedLines = [];
}

function stopLogsTailPoll() {
  if (logsTailTimer) {
    clearInterval(logsTailTimer);
    logsTailTimer = null;
  }
}

function startLogsTailPoll() {
  stopLogsTailPoll();
  if (!activeLogsPaneId || !logsTailEnabled) return;
  logsTailTimer = setInterval(() => {
    if (!activeLogsPaneId || logsTailPaused || !logsTailEnabled) return;
    void fetchPaneLogs(activeLogsPaneId, { since: logsTotalLines, append: true });
  }, LOGS_TAIL_POLL_MS);
}

function removeLogsRows() {
  document.querySelectorAll(".processes-logs-row").forEach((row) => row.remove());
}

function getLogsPre() {
  return document.querySelector(".processes-logs-pre");
}

function isLogsPreAtBottom(pre) {
  if (!pre) return true;
  return pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
}

function scrollLogsToBottom() {
  const pre = getLogsPre();
  if (pre) pre.scrollTop = pre.scrollHeight;
}

function logsLineCountLabel(count) {
  return `${count} line${count === 1 ? "" : "s"}`;
}

function setLogsRestartedVisible(visible) {
  const badge = document.querySelector(".processes-logs-restarted");
  if (badge) badge.hidden = !visible;
}

function setLogsResumeVisible(visible) {
  const btn = document.querySelector(".processes-logs-resume");
  if (btn) btn.hidden = !visible;
}

function updateLogsHeaderMeta(paneId, lineCount) {
  const title = document.querySelector(".processes-logs-title");
  if (title) {
    title.textContent = `Logs · ${paneId} · ${logsLineCountLabel(lineCount)}`;
  }
}

function renderLogsPreContent(lines) {
  const pre = getLogsPre();
  if (!pre) return;
  pre.replaceChildren();
  if (!lines.length) {
    pre.textContent = "(empty)";
    return;
  }
  lines.forEach((line, index) => {
    const row = document.createElement("div");
    row.className = "process-log-line";
    row.innerHTML = `<span class="log-number">${index + 1}</span><span>${esc(line)}</span>`;
    pre.appendChild(row);
  });
}

function wireLogsPreScroll(pre) {
  if (!pre || pre.dataset.wired === "1") return;
  pre.dataset.wired = "1";
  pre.addEventListener("scroll", () => {
    if (!logsTailEnabled) return;
    const atBottom = isLogsPreAtBottom(pre);
    if (!atBottom && !logsTailPaused) {
      logsTailPaused = true;
      setLogsResumeVisible(true);
    } else if (atBottom && logsTailPaused) {
      logsTailPaused = false;
      setLogsResumeVisible(false);
    }
  });
}

function wireLogsControls(tr, paneId) {
  const tailBtn = tr.querySelector(".processes-logs-tail");
  if (tailBtn) {
    tailBtn.setAttribute("aria-pressed", logsTailEnabled ? "true" : "false");
    tailBtn.classList.toggle("processes-logs-tail-active", logsTailEnabled);
    tailBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      logsTailEnabled = !logsTailEnabled;
      logsTailPaused = false;
      setLogsResumeVisible(false);
      tailBtn.setAttribute("aria-pressed", logsTailEnabled ? "true" : "false");
      tailBtn.classList.toggle("processes-logs-tail-active", logsTailEnabled);
      if (logsTailEnabled) {
        startLogsTailPoll();
      } else {
        stopLogsTailPoll();
      }
      auditDashboard("logs.tail", { enabled: logsTailEnabled, paneId });
    });
  }

  const resumeBtn = tr.querySelector(".processes-logs-resume");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      logsTailPaused = false;
      setLogsResumeVisible(false);
      scrollLogsToBottom();
    });
  }

  const moreBtn = tr.querySelector(".processes-logs-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      logsTailEnabled = false;
      logsTailPaused = false;
      stopLogsTailPoll();
      const next = Math.min(LOGS_MAX_LINES, activeLogsLineLimit + LOGS_LINE_STEP);
      activeLogsLineLimit = next;
      void fetchPaneLogs(paneId, { lines: next, scrollBottom: true });
    });
  }

  wireLogsPreScroll(tr.querySelector(".processes-logs-pre"));
}

function attachLogsRow(payload, options = {}) {
  if (!options.append) removeLogsRows();
  if (!payload?.paneId || !processesExpanded) return;
  const paneRow = document.querySelector(
    `tr.processes-row[data-pane-id="${CSS.escape(payload.paneId)}"]`
  );
  if (!paneRow) return;

  let tr = document.querySelector(".processes-logs-row");
  if (!tr) {
    tr = document.createElement("tr");
    tr.className = "processes-logs-row";
    const td = document.createElement("td");
    td.colSpan = 9;
    tr.appendChild(td);
    paneRow.insertAdjacentElement("afterend", tr);
  }

  const td = tr.querySelector("td");
  if (!td) return;

  if (!payload.available) {
    td.innerHTML = `<div class="processes-logs-error">${esc(payload.error || "logs unavailable")}</div>`;
    return;
  }

  const lines = payload.lines || [];
  logsDisplayedLines = lines;
  logsTotalLines = payload.totalLines ?? lines.length;
  const canLoadMore =
    (payload.hasMore ?? (payload.requestedLines ?? activeLogsLineLimit) < LOGS_MAX_LINES) &&
    !logsTailEnabled;
  const loadMore = canLoadMore
    ? `<button type="button" class="processes-logs-more" data-pane-id="${esc(payload.paneId)}">Load more</button>`
    : "";
  const restarted = payload.paneRestarted
    ? `<span class="processes-logs-restarted">Pane restarted</span>`
    : `<span class="processes-logs-restarted" hidden>Pane restarted</span>`;

  td.innerHTML = `
    <div class="processes-logs-header">
      <span class="processes-logs-title">Logs · ${esc(payload.paneId)} · ${logsLineCountLabel(lines.length)}</span>
      <div class="processes-logs-controls">
        ${restarted}
        <button type="button" class="processes-logs-tail" aria-pressed="${logsTailEnabled ? "true" : "false"}" aria-label="Tail logs">Tail</button>
        <button type="button" class="processes-logs-resume" hidden aria-label="Resume tail">Resume tail</button>
        ${loadMore}
      </div>
    </div>
    <pre class="processes-logs-pre"></pre>`;
  renderLogsPreContent(lines);

  wireLogsControls(tr, payload.paneId);
  setLogsRestartedVisible(Boolean(payload.paneRestarted));
  if (options.scrollBottom !== false && !logsTailPaused) scrollLogsToBottom();
}

function appendLogsTail(payload) {
  const tr = document.querySelector(".processes-logs-row");
  if (!tr || !payload?.available) return;

  if (payload.paneRestarted) {
    logsDisplayedLines = payload.lines || [];
    logsTotalLines = payload.totalLines ?? logsDisplayedLines.length;
    renderLogsPreContent(logsDisplayedLines);
    updateLogsHeaderMeta(payload.paneId, logsDisplayedLines.length);
    setLogsRestartedVisible(true);
    if (!logsTailPaused) scrollLogsToBottom();
    return;
  }

  logsTotalLines = payload.totalLines ?? logsTotalLines;
  const newLines = payload.lines || [];
  if (newLines.length === 0) return;

  const pre = getLogsPre();
  const atBottom = isLogsPreAtBottom(pre);
  logsDisplayedLines = logsDisplayedLines.concat(newLines);
  renderLogsPreContent(logsDisplayedLines);
  updateLogsHeaderMeta(payload.paneId, logsDisplayedLines.length);
  setLogsRestartedVisible(false);
  if (!logsTailPaused && atBottom) scrollLogsToBottom();
}

function onProcessesPaneClick(paneId) {
  if (activeLogsPaneId === paneId) {
    resetLogsPanelState();
    removeLogsRows();
    document.querySelectorAll(".processes-row-active").forEach((row) => {
      row.classList.remove("processes-row-active");
    });
    return;
  }
  resetLogsPanelState();
  activeLogsPaneId = paneId;
  activeLogsLineLimit = LOGS_DEFAULT_LINES;
  document.querySelectorAll(".processes-row").forEach((row) => {
    row.classList.toggle("processes-row-active", row.dataset.paneId === paneId);
  });
  void fetchPaneLogs(paneId);
}

async function fetchPaneLogs(paneId, options = {}) {
  const session = processesSessionParam();
  if (!session || !paneId) return;

  const lines = options.lines ?? activeLogsLineLimit;
  activeLogsLineLimit = lines;

  let url = `/api/widgets/logs?session=${encodeURIComponent(session)}&paneId=${encodeURIComponent(paneId)}&lines=${lines}`;
  if (options.since !== undefined && Number.isFinite(options.since)) {
    url += `&since=${Math.max(0, Math.floor(options.since))}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    lastLogsPayload = data;

    if (options.append && data.available) {
      appendLogsTail(data);
    } else {
      attachLogsRow(data, { scrollBottom: options.scrollBottom !== false });
      if (logsTailEnabled) startLogsTailPoll();
    }

    auditDashboard("logs", {
      available: data.available,
      paneId: data.paneId,
      lineCount: data.lineCount,
      totalLines: data.totalLines,
      since: options.since,
      tail: logsTailEnabled,
      paneRestarted: data.paneRestarted,
      session: data.session,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = {
      available: false,
      paneId,
      error: message,
      lines: [],
    };
    lastLogsPayload = failure;
    if (!options.append) attachLogsRow(failure);
    console.error("dashboard.logs", error);
  }
}

function scheduleProcessesPoll(pollMs) {
  if (processesPollTimer) clearInterval(processesPollTimer);
  void fetchProcesses();
  void fetchGit();
  const interval = Math.max(pollMs || 5000, 3000);
  processesPollTimer = setInterval(() => {
    void fetchProcesses();
    void fetchGit();
    if (activeLogsPaneId && !logsTailEnabled) {
      void fetchPaneLogs(activeLogsPaneId, { scrollBottom: false });
    }
  }, interval);
}

function updatePanelHeadings() {
  const heading = document.getElementById("agents-heading");
  if (!heading) return;
  const primaryLabel = metaSnapshot?.discovery?.herdrSessionLabel || "primary";
  if (activeSession === SESSION_ALL) {
    heading.innerHTML = `Agents · <span class="session-scope-label">all sessions</span>`;
    return;
  }
  const label = sessionDisplayLabel(activeSession, primaryLabel);
  if (normalizeSessionValue(activeSession)) {
    heading.innerHTML = `Agents · <span class="session-scope-label">${esc(label)}</span>`;
  } else {
    heading.textContent = "Agents";
  }
}

function syncSessionSelector(agents, discovery) {
  const select = document.getElementById("session-scope");
  if (!select) return;

  const visible = shouldShowSessionSelector(discovery, agents);
  select.hidden = !visible;
  if (!visible) {
    if (activeSession !== "") {
      activeSession = "";
      saveActiveSession(activeSession);
      lastFilteredAgentsJson = "";
      lastProcessesJson = "";
      lastGitJson = "";
      updatePanelHeadings();
      void fetchProcesses();
      void fetchGit();
    }
    return;
  }

  const primaryLabel = discovery?.herdrSessionLabel || "primary";
  const sessions = sessionIdsFromDiscovery(discovery, agents);
  const catalog = sessionCatalogById(discovery);
  const options = [];

  if (discovery?.multiSessionEnabled) {
    options.push({ value: SESSION_ALL, label: "all sessions" });
  }
  for (const session of sessions) {
    const meta = catalog.get(session);
    const label = meta?.label || sessionDisplayLabel(session, primaryLabel);
    const warn = meta && meta.reachable === false ? ` (${meta.error || "unreachable"})` : "";
    options.push({
      value: session,
      label: `${label}${warn}`,
      title: meta?.error,
      unreachable: Boolean(meta && meta.reachable === false),
    });
  }

  const allowed = new Set(options.map((opt) => opt.value));
  if (!allowed.has(activeSession)) {
    activeSession = sessions.includes("") ? "" : (options[0]?.value ?? "");
    saveActiveSession(activeSession);
  }

  const previous = select.value;
  select.replaceChildren();
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.title) el.title = opt.title;
    if (opt.unreachable) el.className = "session-unreachable";
    select.appendChild(el);
  }
  select.value = allowed.has(activeSession) ? activeSession : (options[0]?.value ?? "");
  activeSession = select.value;
  saveActiveSession(activeSession);
  if (previous !== select.value) {
    lastFilteredAgentsJson = "";
    lastProcessesJson = "";
    lastGitJson = "";
    void fetchProcesses();
    void fetchGit();
  }
  updatePanelHeadings();
}

function wireSessionSelector() {
  const select = document.getElementById("session-scope");
  if (!select || select.dataset.wired === "1") return;
  select.dataset.wired = "1";
  select.addEventListener("change", () => {
    activeSession = select.value;
    saveActiveSession(activeSession);
    lastFilteredAgentsJson = "";
    lastProcessesJson = "";
    lastGitJson = "";
    resetLogsPanelState();
    removeLogsRows();
    updatePanelHeadings();
    if (lastAgentsPayload) renderAgents(lastAgentsPayload);
    void fetchProcesses();
    void fetchGit();
    auditDashboard("session.scope", { activeSession });
  });
}

function auditDashboard(event, data = {}) {
  console.log(`dashboard.${event}`, data);
}

/**
 * Send an open-canvas command through the console bridge.
 * The IDE/WebView host intercepts this console call and opens the file.
 *
 * @param {object} canvas — a row from /api/canvases with id, canvasId, path, page, etc.
 */
function openCanvas(canvas) {
  console.log({
    command: "open-canvas",
    id: canvas.id,
    canvasId: canvas.canvasId,
    path: canvas.path,
    page: canvas.page,
    version: canvas.version,
    layer: canvas.layer,
    purpose: canvas.purpose,
  });
}

function isPrimarySession(session) {
  return !String(session ?? "").trim();
}

function sessionCellHtml(session) {
  const primary = isPrimarySession(session);
  const label = primary ? "(primary)" : esc(session);
  const klass = primary ? "session-cell session-primary" : "session-cell";
  return `<td class="${klass}">${label}</td>`;
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

function timestampMs(value) {
  if (typeof value === "number")
    return value > 1_000_000_000_000 ? value : Math.floor(value / 1_000_000);
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function tagTone(value) {
  const key = String(value ?? "").toLowerCase();
  if (["ok", "pass", "passed", "done", "fixed", "active", "true"].includes(key)) return "ok";
  if (["warn", "warning", "stale", "dry-run", "unknown"].includes(key)) return "warn";
  if (["error", "fail", "failed", "failure", "blocked", "false"].includes(key)) return "error";
  if (["working", "running", "scan", "fixable"].includes(key)) return "info";
  return "neutral";
}

function tagHtml(label, tone = tagTone(label)) {
  return `<span class="tag tag-${tone}">${esc(label)}</span>`;
}

function statusRank(status) {
  const key = String(status ?? "unknown").toLowerCase();
  return (
    {
      blocked: 0,
      stale: 1,
      working: 2,
      idle: 3,
      done: 4,
      unknown: 5,
    }[key] ?? 6
  );
}

function sortAgents(rows) {
  return [...(rows || [])].sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    return (
      [
        String(a.host ?? "").localeCompare(String(b.host ?? "")),
        String(a.session ?? "").localeCompare(String(b.session ?? "")),
        String(a.workspaceId ?? "").localeCompare(String(b.workspaceId ?? "")),
        String(a.agent ?? "").localeCompare(String(b.agent ?? "")),
        String(a.paneId ?? "").localeCompare(String(b.paneId ?? "")),
      ].find((value) => value !== 0) ?? 0
    );
  });
}

function sortFindings(findings) {
  return [...(findings || [])].sort((a, b) => {
    const byFix = Number(Boolean(b.hasAutoFix)) - Number(Boolean(a.hasAutoFix));
    if (byFix !== 0) return byFix;
    return (
      String(a.file ?? "").localeCompare(String(b.file ?? "")) ||
      Number(a.line ?? 0) - Number(b.line ?? 0) ||
      String(a.ruleId ?? "").localeCompare(String(b.ruleId ?? ""))
    );
  });
}

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
    thumbLive = false;
    wrap.classList.remove("visible");
    wrap.setAttribute("aria-hidden", "true");
    return;
  }
  wrap.classList.add("visible");
  wrap.setAttribute("aria-hidden", "false");
  const thumbUrl = apiUrl(`${data.thumbnailPath}?width=160&height=90&quality=75&t=${Date.now()}`);
  if (thumbLive) {
    img.src = thumbUrl;
    return;
  }
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
    thumbLive = true;
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

function formatDiscoveryWorkspace(discovery) {
  if (!discovery?.workspaceId) return "";
  const id = esc(discovery.workspaceId);
  const resolution = discovery.workspaceIdResolution || "none";
  const resolved = resolution !== "single" && resolution !== "none";
  const suffix = resolved ? "*" : "";
  const parts = [`workspace ${id}`];
  if (resolved) parts.push(`resolved via ${resolution}`);
  if (discovery.workspaceCandidateCount > 1) {
    parts.push(`${discovery.workspaceCandidateCount} candidates`);
  }
  const title = esc(parts.join(" · "));
  return ` · <span class="discovery-ws" title="${title}">${id}${suffix}</span>`;
}

function formatDiscoveryRemoteHosts(discovery) {
  const remote = discovery.remoteHosts;
  const configured = remote?.configured ?? discovery.remoteHostsConfigured ?? 0;
  if (configured <= 0) return "";

  const reachable = remote?.reachable ?? 0;
  const ratio = `${reachable}/${configured} remote`;
  const hosts = remote?.hosts ?? [];
  const details = hosts
    .map((host) => {
      const label = esc(host.label);
      if (host.reachable) {
        const version = host.version ? ` · ${esc(host.version)}` : "";
        return `${label}: reachable${version}`;
      }
      const error = host.error ? ` — ${esc(host.error)}` : "";
      return `${label}: unreachable${error}`;
    })
    .join(" · ");
  const title = esc(details || `${reachable} of ${configured} remote host(s) reachable`);

  if (reachable >= configured) {
    return ` · <span class="herdr-ok" title="${title}">${ratio}</span>`;
  }
  if (hosts.length === 0 && configured > 0) {
    return ` · <span class="herdr-warn" title="${title}">?/${configured} remote</span>`;
  }
  return ` · <span class="herdr-bad" title="${title}">${ratio}</span>`;
}

function formatDiscoveryLine(discovery) {
  if (discovery === undefined) {
    return "discovery unavailable — restart dashboard server";
  }
  const session = esc(discovery.herdrSessionLabel || "primary");
  const mode = esc(discovery.mode || "workspace");
  const ws = formatDiscoveryWorkspace(discovery);
  const multi = discovery.multiSessionEnabled ? " · multi-session" : "";
  const remote = formatDiscoveryRemoteHosts(discovery);
  return `discovery ${session} · ${mode}${ws}${multi}${remote}`;
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

  const status = document.getElementById("control-plane-status");
  const statusLine = `${formatHerdrEventsLine(data.herdrEvents)} · ${formatCacheLine(data.cache)} · ${formatDiscoveryLine(data.discovery)} · ${formatWebViewLine(data.webview)}`;
  if (status) {
    status.innerHTML = statusLine;
  } else {
    const control = document.getElementById("control-plane");
    control.innerHTML = statusLine;
  }
  syncSessionSelector(lastAgentsPayload?.agents, data.discovery);
  wireSessionSelector();
  updatePanelHeadings();

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
    discovery: data.discovery,
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
  td.colSpan = 8;
  td.className = "empty-state";
  td.innerHTML = `<strong>No agents discovered</strong>${esc(message)}`;
  tr.appendChild(td);
  body.appendChild(tr);
}

function renderAgents(data) {
  lastAgentsPayload = data;
  syncSessionSelector(data.agents, metaSnapshot?.discovery);
  wireSessionSelector();

  const agents = sortAgents(filterAgentsBySession(data.agents || [], activeSession));
  const filteredJson = JSON.stringify(agents);
  if (filteredJson === lastFilteredAgentsJson) return;
  lastFilteredAgentsJson = filteredJson;

  const err = document.getElementById("agents-error");
  const body = document.getElementById("agents-body");
  body.replaceChildren();

  if (!data.ok) {
    err.textContent = data.error || "agents unavailable";
    showAgentsEmpty("Check that Herdr is running and [herdr] is enabled in dx.config.toml.");
    return;
  }
  err.textContent = "";

  if (agents.length === 0) {
    const total = (data.agents || []).length;
    const scoped =
      activeSession === SESSION_ALL || (normalizeSessionValue(activeSession) !== "" && total > 0);
    const hint = scoped
      ? " No agents in the selected session — pick another scope in the control-plane selector."
      : data.error
        ? ` Partial errors: ${data.error}`
        : " Start agents in Herdr or run with --sessions to scan all sessions.";
    showAgentsEmpty(hint);
    auditDashboard("agents", {
      ok: true,
      count: 0,
      total,
      activeSession,
      statuses: {},
    });
    return;
  }

  for (const row of agents) {
    const tr = document.createElement("tr");
    tr.className = `agent-row agent-row--${statusClass(row.status).replace("status-", "")}${
      row.status === "stale" ? " agent-row--stale" : ""
    }`;
    tr.innerHTML = `
      <td>${esc(row.host)}</td>
      ${sessionCellHtml(row.session)}
      <td>${esc(row.workspaceId)}</td>
      <td>${esc(row.agent)}</td>
      <td>${tagHtml(row.source || "local", row.source === "remote" ? "info" : "neutral")}</td>
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
    total: (data.agents || []).length,
    activeSession,
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
  const source = new EventSource(apiUrl("/api/agents/live"));

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
  const body = document.getElementById("handoffs-body");
  if (!body) return;
  const res = await fetch("/api/handoffs?limit=80");
  const data = await res.json();
  const entries = [...(data.entries || [])].sort(
    (a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp)
  );
  const json = JSON.stringify(entries);
  if (json === lastHandoffsJson) return;
  lastHandoffsJson = json;
  body.replaceChildren();
  if (entries.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No handoffs recorded</td></tr>';
    return;
  }
  for (const row of entries) {
    const tr = document.createElement("tr");
    tr.className = row.ok ? "handoff-row handoff-row--ok" : "handoff-row handoff-row--failed";
    tr.innerHTML = `
      <td>${esc(row.timestamp)}</td>
      <td>${esc(row.workspace)}</td>
      <td>${esc(row.agent)}</td>
      <td>${tagHtml(row.action || "handoff", "info")}</td>
      <td>${esc(row.detail)}</td>
      <td>${tagHtml(row.ok ? "ok" : "failed", row.ok ? "ok" : "error")}</td>`;
    body.appendChild(tr);
  }
  console.log("dashboard.handoffs", entries.length);
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
  const rules = [...(data.rules || [])].sort((a, b) => Number(a.index) - Number(b.index));
  if (rules.length === 0) {
    body.innerHTML =
      '<tr><td colspan="5" class="empty-state">No handoff rules configured</td></tr>';
    return;
  }
  for (const row of rules) {
    const tr = document.createElement("tr");
    tr.className = row.lastOk === false ? "rule-row rule-row--failed" : "rule-row";
    tr.innerHTML = `
      <td>${row.index}</td>
      <td>${tagHtml(row.active ? "active" : "inactive", row.active ? "ok" : "warn")} ${esc(
        row.condition
      )}</td>
      <td>${esc(row.lastFired || "—")}</td>
      <td>${esc(row.lastAction || "—")}</td>
      <td>${
        row.lastOk === undefined
          ? "—"
          : tagHtml(row.lastOk ? "ok" : "failed", row.lastOk ? "ok" : "error")
      }</td>`;
    body.appendChild(tr);
  }
  console.log("dashboard.rules", rules.length);
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

async function refreshScan() {
  const errEl = document.getElementById("scan-error");
  const summaryEl = document.getElementById("scan-summary");
  const body = document.getElementById("scan-body");
  if (!body || !summaryEl) return;

  const res = await fetch("/api/scan");
  const payload = await res.json();
  const json = JSON.stringify(payload);
  if (json === lastScanJson) return;
  lastScanJson = json;

  if (!payload.ok) {
    if (errEl) errEl.textContent = payload.error || "Scan failed";
    return;
  }
  if (errEl) errEl.textContent = "";

  const report = payload.report;
  const total = report?.summary?.total ?? 0;
  summaryEl.textContent =
    total === 0
      ? "No findings — project matches Bun-native patterns"
      : `${total} finding(s) · ${report.tool}`;

  const findings = sortFindings(report?.findings ?? []);
  if (findings.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No findings</td></tr>';
    return;
  }

  body.innerHTML = "";
  for (const row of findings) {
    const tr = document.createElement("tr");
    tr.className = row.hasAutoFix ? "finding-row finding-row--fixable" : "finding-row";
    tr.innerHTML = `
      <td class="scan-file">${esc(row.file)}</td>
      <td class="scan-line">${esc(String(row.line))}</td>
      <td class="scan-rule">${tagHtml(row.ruleId, row.hasAutoFix ? "info" : "neutral")}</td>
      <td>${esc(row.message)}</td>
      <td class="scan-suggestion">${esc(row.suggestion)}</td>
      <td class="scan-actions">${
        row.hasAutoFix
          ? '<button type="button" class="scan-fix-btn">Apply fix</button>'
          : tagHtml("manual", "warn")
      }</td>
    `;
    if (row.hasAutoFix) {
      const btn = tr.querySelector(".scan-fix-btn");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Fixing...";
        try {
          const res = await fetch("/api/scan/fix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ruleId: row.ruleId, file: row.file, line: row.line }),
          });
          const result = await res.json();
          if (result.ok) {
            tr.classList.add("finding-row--applied");
            tr.classList.remove("finding-row--fixable");
            btn.textContent = "Fixed ✓";
            // Show diff preview inline
            const diffRow = document.createElement("tr");
            diffRow.className = "scan-diff-row";
            diffRow.innerHTML = `<td colspan="6"><pre class="scan-diff-preview">${esc(result.diff)}</pre></td>`;
            tr.after(diffRow);
            setTimeout(() => diffRow.remove(), 6000);
          } else {
            btn.textContent = "Failed";
            btn.disabled = false;
          }
        } catch {
          btn.textContent = "Error";
          btn.disabled = false;
        }
      });
    }
    body.appendChild(tr);
  }
}

async function runScanFromPanel() {
  const btn = document.getElementById("scan-run");
  if (btn) btn.disabled = true;
  lastScanJson = "";
  try {
    const ipc = await ipcCommand("scan.run", {});
    if (!ipc.ok) {
      const errEl = document.getElementById("scan-error");
      if (errEl) errEl.textContent = ipc.message || "Scan failed";
      return;
    }
    await refreshScan();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Canvases tab ─────────────────────────────────────────────────────

async function refreshCanvases() {
  const body = document.getElementById("canvases-body");
  const errEl = document.getElementById("canvases-error");
  if (!body) return;

  const res = await fetch("/api/canvases");
  const payload = await res.json();
  const json = JSON.stringify(payload);
  if (json === lastCanvasesJson) return;
  lastCanvasesJson = json;

  if (!payload.ok) {
    if (errEl) errEl.textContent = payload.error || "Failed to load canvases";
    return;
  }
  if (errEl) errEl.textContent = "";

  const canvases = payload.canvases ?? [];
  if (canvases.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">No canvases</td></tr>';
    return;
  }

  body.innerHTML = "";
  let lastGroup = -1;
  const groupLabels = {
    1: "Hub",
    2: "Config & Namespace",
    4: "Cross-ref",
    5: "Scaffold",
    6: "Herdr — gates & HTTP",
    8: "Herdr — plugins",
  };
  function canvasGroup(order) {
    // Map readOrder to group key — adjacent orders in same group share a header
    if (order <= 1) return 1;
    if (order <= 3) return 2;
    if (order <= 4) return 4;
    if (order <= 5) return 5;
    if (order <= 7) return 6;
    return 8;
  }
  for (const c of canvases) {
    const group = canvasGroup(c.readOrder ?? 99);
    if (group !== lastGroup) {
      lastGroup = group;
      const label = groupLabels[group] || `Group ${group}`;
      const header = document.createElement("tr");
      header.className = "canvas-group-header";
      header.innerHTML = `<td colspan="8">${esc(label)}</td>`;
      body.appendChild(header);
    }
    const tr = document.createElement("tr");
    tr.className = "canvas-row";
    tr.setAttribute("role", "button");
    tr.setAttribute("tabindex", "0");
    tr.title = `Open ${c.canvasId || c.page}`;
    tr.addEventListener("click", () => {
      tr.classList.add("canvas-row-pulse");
      openCanvas(c);
      setTimeout(() => tr.classList.remove("canvas-row-pulse"), 180);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tr.classList.add("canvas-row-pulse");
        openCanvas(c);
        setTimeout(() => tr.classList.remove("canvas-row-pulse"), 180);
      }
    });
    const influences =
      Array.isArray(c.influences) && c.influences.length > 0
        ? c.influences.map((id) => `<code>${esc(id)}</code>`).join(" ")
        : "—";
    tr.innerHTML = `
      <td><code>${esc(c.path)}</code></td>
      <td>${esc(c.id)}</td>
      <td>${esc(c.page)}</td>
      <td>${esc(c.version || "—")}</td>
      <td>${esc(c.layer || "—")}</td>
      <td>${esc(c.openWhen || "—")}</td>
      <td class="canvas-purpose">${esc(c.purpose)}</td>
      <td class="canvas-influences">${influences}</td>
    `;
    body.appendChild(tr);
  }
}

function wireScanPanel() {
  const btn = document.getElementById("scan-run");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => void runScanFromPanel());
}

function wireCanvasesPanel() {
  if (STATIC_PREVIEW) return;
  // Pre-fetch canvases on boot so the tab is ready when activated
  void refreshCanvases();
}

// ── Gate health overlay ──────────────────────────────────────────────

async function refreshGateHealth() {
  const bar = document.getElementById("gate-health");
  const text = document.getElementById("gate-health-text");
  if (!bar || !text) return;

  try {
    const res = await fetch("/api/doctor/gates");
    const payload = await res.json();
    if (!payload.ok) return;

    if (payload.failed) {
      bar.hidden = false;
      const names = payload.failures.map((f) => f.name).join(", ");
      text.textContent = `${payload.failures.length}/${payload.total} failing: ${names}`;
      document.querySelectorAll(".agent-row").forEach((row) => {
        row.classList.add("agent-row--gate-failed");
      });
    } else {
      bar.hidden = true;
      document.querySelectorAll(".agent-row--gate-failed").forEach((row) => {
        row.classList.remove("agent-row--gate-failed");
      });
    }
  } catch {
    // gate check unavailable — hide indicator
    bar.hidden = true;
  }
}

function scheduleGateHealthPoll() {
  if (gateHealthPollTimer) clearInterval(gateHealthPollTimer);
  gateHealthPollTimer = setInterval(() => {
    void refreshGateHealth();
  }, 30_000);
  void refreshGateHealth();
}

// ── Metrics tab ─────────────────────────────────────────────────────

async function refreshMetrics() {
  const body = document.getElementById("metrics");
  if (!body || !body.classList.contains("active")) return;

  const errEl = document.getElementById("metrics-error");
  try {
    const res = await fetch("/api/metrics");
    const payload = await res.json();
    if (!payload.ok) {
      if (errEl) errEl.textContent = payload.error || "Failed to load metrics";
      return;
    }
    if (errEl) errEl.textContent = "";
    const m = payload.metrics;
    document.getElementById("metrics-rss").textContent = `${m.memoryRssMB} MB`;
    document.getElementById("metrics-heap").textContent = `${m.memoryHeapMB} MB`;
    document.getElementById("metrics-el-lag").textContent = `${m.eventLoopLagMs} ms`;
    document.getElementById("metrics-uptime").textContent = `${m.uptimeSeconds}s`;
    document.getElementById("metrics-sse").textContent = String(m.sseConnections);
    document.getElementById("metrics-agents").textContent = String(m.agentCount);
  } catch (err) {
    if (errEl) errEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

function wireMetricsPanel() {
  // metrics tab loaded on first activation via switchTab
}

// ── Lineage tab ──────────────────────────────────────────────────────

async function ensureMermaid() {
  if (mermaidReady) return true;
  const m = globalThis.mermaid;
  if (!m || typeof m.initialize !== "function") return false;
  m.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  mermaidReady = true;
  return true;
}

async function renderMermaidInto(el, source, cacheKey) {
  if (!el || !source) return;
  if (!(await ensureMermaid())) {
    el.textContent = source;
    el.classList.remove("lineage-empty");
    return;
  }
  const id = `mmd-${cacheKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  el.classList.remove("lineage-empty");
  el.replaceChildren();
  const pre = document.createElement("pre");
  pre.className = "mermaid";
  pre.id = id;
  pre.textContent = source;
  el.appendChild(pre);
  try {
    await globalThis.mermaid.run({ nodes: [pre] });
  } catch (err) {
    el.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function refreshLineageGateGraph() {
  const el = document.getElementById("lineage-gate-graph");
  const errEl = document.getElementById("lineage-error");
  if (!el) return;

  try {
    const res = await fetch("/api/gates/graph");
    const payload = await res.json();
    if (!payload.ok) {
      if (errEl) errEl.textContent = payload.error || "Failed to load gate graph";
      return;
    }
    const mermaid = String(payload.mermaid ?? "");
    if (mermaid === lastLineageGateGraph) return;
    lastLineageGateGraph = mermaid;
    if (errEl) errEl.textContent = "";
    await renderMermaidInto(el, mermaid, "gate-graph");
  } catch (err) {
    if (errEl) errEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function refreshLineageArtifactGraph(gateName) {
  const el = document.getElementById("lineage-artifact-graph");
  const metaEl = document.getElementById("lineage-artifact-meta");
  const errEl = document.getElementById("lineage-error");
  if (!el) return;

  if (!gateName) {
    el.textContent = "No artifact selected";
    el.classList.add("lineage-empty");
    if (metaEl) metaEl.textContent = "Select a gate with saved artifacts";
    return;
  }

  const cacheKey = gateName;
  if (cacheKey === lastLineageArtifactKey) return;

  try {
    const res = await fetch(`/api/artifacts/${encodeURIComponent(gateName)}/lineage`);
    const payload = await res.json();

    if (!payload.ok) {
      el.textContent = payload.error || "No lineage for this gate";
      el.classList.add("lineage-empty");
      if (metaEl) metaEl.textContent = `Gate: ${gateName}`;
      return;
    }

    if (errEl) errEl.textContent = "";
    const path = payload.path || "";
    const deps = payload.dependencyCount ?? 0;
    const source = payload.lineageSource || "none";
    const sourceLabel =
      source === "runtime"
        ? "runtime (gate run)"
        : source === "declarative"
          ? "declarative (dependsOn)"
          : source === "stored"
            ? "stored mermaid"
            : "none";
    if (metaEl) {
      metaEl.textContent = `${path} — ${deps} upstream · ${sourceLabel}`;
    }

    const mermaid = String(payload.mermaid ?? "");
    if (!mermaid || source === "none") {
      el.textContent =
        "No lineage on latest artifact — run kimi-doctor --gate <name> --save-artifact";
      el.classList.add("lineage-empty");
      return;
    }

    await renderMermaidInto(el, mermaid, `artifact-${gateName}`);
    lastLineageArtifactKey = cacheKey;
  } catch (err) {
    if (errEl) errEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function populateLineageGateSelect() {
  const select = document.getElementById("lineage-gate-select");
  if (!select) return;

  const previous = select.value;
  try {
    const res = await fetch("/api/artifacts");
    const payload = await res.json();
    const gates = [...(payload.artifacts || [])]
      .map((row) => row.gate)
      .filter(Boolean)
      .sort();

    select.innerHTML = '<option value="">— select gate —</option>';
    for (const gate of gates) {
      const opt = document.createElement("option");
      opt.value = gate;
      opt.textContent = gate;
      select.appendChild(opt);
    }

    if (previous && gates.includes(previous)) {
      select.value = previous;
    } else if (!select.value && gates.length > 0) {
      select.value = gates[0];
    }
  } catch {
    // gate select is best-effort; graph panels show their own errors
  }
}

async function refreshLineage() {
  if (activeTab !== "lineage") return;
  await populateLineageGateSelect();
  await refreshLineageGateGraph();
  const select = document.getElementById("lineage-gate-select");
  await refreshLineageArtifactGraph(select?.value || "");
}

function wireLineagePanel() {
  const select = document.getElementById("lineage-gate-select");
  if (!select) return;
  select.addEventListener("change", () => {
    lastLineageArtifactKey = "";
    void refreshLineageArtifactGraph(select.value);
  });
}

// ── Artifacts tab ────────────────────────────────────────────────────

function artifactStatusClass(status) {
  return `artifact-status--${tagTone(status)}`;
}

function formatArtifactBytes(value) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${value} B`;
}

function compactArtifactPath(path) {
  const text = String(path ?? "").trim();
  if (!text) return "—";
  const prefix = ".kimi/artifacts/";
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

async function refreshArtifacts() {
  if (activeTab !== "artifacts") return;
  const body = document.getElementById("artifacts-body");
  const errEl = document.getElementById("artifacts-error");
  const hintEl = document.getElementById("artifacts-probe-hint");
  if (!body) return;

  try {
    const res = await fetch("/api/artifacts");
    const payload = await res.json();
    const artifacts = [...(payload.artifacts || [])].sort((a, b) => {
      const byLatest = String(b.latestPath ?? "").localeCompare(String(a.latestPath ?? ""));
      if (byLatest !== 0) return byLatest;
      return String(a.gate ?? "").localeCompare(String(b.gate ?? ""));
    });
    const json = JSON.stringify(artifacts);
    if (json === lastArtifactsJson) return;
    lastArtifactsJson = json;

    if (!payload.ok) {
      if (errEl) errEl.textContent = payload.error || "Failed to load artifacts";
      return;
    }
    if (errEl) errEl.textContent = "";

    if (hintEl) {
      const url = payload.probeServerUrl || "";
      hintEl.textContent = payload.probeReachable
        ? `serve-probe reachable at ${url}`
        : `serve-probe offline at ${url} — start: kimi-doctor --serve-probe`;
      hintEl.className = payload.probeReachable
        ? "artifacts-probe-hint artifacts-probe-hint--ok"
        : "artifacts-probe-hint artifacts-probe-hint--warn";
    }

    body.innerHTML = "";
    if (artifacts.length === 0) {
      body.innerHTML =
        '<tr><td colspan="7" class="empty-state">No saved artifacts under .kimi/artifacts</td></tr>';
      return;
    }

    for (const row of artifacts) {
      const tr = document.createElement("tr");
      tr.className = `artifact-row ${artifactStatusClass(row.status)}`;
      const latestPath = row.latestPath || "";
      const latestMeta = row.updatedAt
        ? `<span class="artifact-time">${esc(row.updatedAt)}</span>`
        : "";
      tr.innerHTML = `
        <td class="artifact-gate"><code>${esc(row.gate)}</code></td>
        <td>${tagHtml(row.status || "unknown")}</td>
        <td class="artifact-count">${esc(String(row.count ?? 0))}</td>
        <td class="artifact-latest"><code title="${esc(latestPath)}">${esc(
          compactArtifactPath(latestPath)
        )}</code>${latestMeta}</td>
        <td class="artifact-size"><code>${esc(formatArtifactBytes(row.latestSize))}</code></td>
        <td class="artifact-size"><code>${esc(formatArtifactBytes(row.latestResultSize))}</code></td>
        <td class="artifact-summary">${esc(row.summary || "—")}</td>
      `;
      body.appendChild(tr);
    }
  } catch (err) {
    if (errEl) errEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

// ── Events tab ─────────────────────────────────────────────────────

function eventTone(type) {
  const key = String(type ?? "").toLowerCase();
  if (key === "gate.failed" || key.includes("error") || key.includes("failed")) return "error";
  if (key === "gate.cleared") return "ok";
  if (key.startsWith("scan.") || key.startsWith("agent.") || key.startsWith("dashboard.")) {
    return "info";
  }
  if (key.startsWith("handoff.") || key.includes("handoff")) return "warn";
  if (key.startsWith("git.")) return "neutral";
  return "neutral";
}

function eventTypeClass(type) {
  const key = String(type ?? "").toLowerCase();
  if (key === "gate.failed") return "event-type--gate-failed";
  if (key === "scan.fix") return "event-type--scan-fix";
  if (key === "gate.cleared") return "event-type--gate-cleared";
  return `event-type--${eventTone(key)}`;
}

function formatEventTime(at) {
  const ms = Math.floor(at / 1000000);
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function formatEventDetail(payload) {
  if (payload?.message) return esc(String(payload.message).slice(0, 100));
  if (payload?.failures) return esc(`${payload.failures.length} failure(s)`);
  if (payload?.ruleId) return `${esc(payload.ruleId)} · ${esc(payload.file || "")}`;
  return esc(JSON.stringify(payload).slice(0, 80));
}

function eventPayloadKeys(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Object.keys(payload).slice(0, 5);
}

async function refreshEvents() {
  const body = document.getElementById("events-body");
  if (!body) return;
  const errEl = document.getElementById("events-error");

  let url = "/api/events?limit=80";
  if (eventsTypeFilter) url += `&type=${encodeURIComponent(eventsTypeFilter)}`;

  try {
    const res = await fetch(url);
    const payload = await res.json();
    const json = JSON.stringify(payload);
    if (json === lastEventsJson) return;
    lastEventsJson = json;

    if (!payload.ok) {
      if (errEl) errEl.textContent = payload.error || "Failed to load events";
      return;
    }
    if (errEl) errEl.textContent = "";

    const events = [...(payload.events || [])].sort(
      (a, b) => timestampMs(b.at) - timestampMs(a.at)
    );
    body.innerHTML = "";
    if (events.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">No events</td></tr>';
      return;
    }

    for (const e of events) {
      const tr = document.createElement("tr");
      tr.className = `event-row ${eventTypeClass(e.type)}`;
      const payloadTags = eventPayloadKeys(e.payload)
        .map((key) => tagHtml(key, "neutral"))
        .join("");
      tr.innerHTML = `
        <td class="event-time">${formatEventTime(e.at)}</td>
        <td><span class="event-type-badge ${eventTypeClass(e.type)}">${esc(e.type)}</span></td>
        <td>${esc(e.workspace || "—")}</td>
        <td>${esc(e.agent || "—")}</td>
        <td><div class="event-payload-tags">${payloadTags || "—"}</div></td>
        <td class="event-detail">${formatEventDetail(e.payload)}</td>
      `;
      body.appendChild(tr);
    }

    // Populate type filter dropdown
    const filter = document.getElementById("events-type-filter");
    if (filter && filter.options.length <= 1) {
      const typesRes = await fetch("/api/events/types");
      const typesData = await typesRes.json();
      for (const t of [...(typesData.types || [])].sort()) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        filter.appendChild(opt);
      }
    }
  } catch (err) {
    if (errEl) errEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

function logLineSeverity(line) {
  if (/\b(error|fail(?:ed|ure)?|exception|panic|fatal|✗|✘)\b/i.test(line)) {
    return "error";
  }
  if (/\b(warn(?:ing)?)\b/i.test(line)) return "warn";
  return "info";
}

function logLineClass(line) {
  return `log-line--${logLineSeverity(line)}`;
}

function summarizeLogLines(lines) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const line of lines || []) counts[logLineSeverity(line)] += 1;
  return counts;
}

function renderDebugLogLines(lines) {
  const body = document.getElementById("logs-body");
  if (!body) return;
  body.innerHTML = "";
  body.classList.remove("empty-state");
  if (!lines.length) {
    body.textContent = "No lines in tail window";
    body.classList.add("empty-state");
    return;
  }
  for (const [index, line] of lines.entries()) {
    const row = document.createElement("div");
    const severity = logLineSeverity(line);
    row.className = `log-line ${logLineClass(line)}`;
    row.innerHTML = `<span class="log-severity tag tag-${tagTone(severity)}">${esc(
      severity
    )}</span><span class="log-number">${index + 1}</span><span class="log-message">${esc(
      line
    )}</span>`;
    row.title = "Click to copy";
    row.addEventListener("click", () => {
      void navigator.clipboard.writeText(line).then(() => {
        row.classList.add("log-line--copied");
        setTimeout(() => row.classList.remove("log-line--copied"), 700);
      });
    });
    body.appendChild(row);
  }
}

async function populateDebugLogSinks() {
  const select = document.getElementById("logs-sink-select");
  if (!select || select.dataset.populated === "1") return;
  const res = await fetch("/api/debug/logs");
  const payload = await res.json();
  if (!payload.ok || !Array.isArray(payload.sinks)) return;
  select.innerHTML = "";
  for (const sink of payload.sinks) {
    const opt = document.createElement("option");
    opt.value = sink.id;
    opt.textContent = `${sink.label}${sink.present ? "" : " (missing)"}`;
    opt.disabled = !sink.present;
    select.appendChild(opt);
  }
  const preferred =
    payload.sinks.find((s) => s.id === "tool-failures" && s.present) ||
    payload.sinks.find((s) => s.present);
  if (preferred) {
    debugLogsSink = preferred.id;
    select.value = preferred.id;
  }
  select.dataset.populated = "1";
}

async function refreshDebugLogs() {
  if (activeTab !== "logs") return;
  const body = document.getElementById("logs-body");
  const errEl = document.getElementById("logs-error");
  const metaEl = document.getElementById("logs-meta");
  if (!body) return;

  await populateDebugLogSinks();

  const url = `/api/debug/logs?sink=${encodeURIComponent(debugLogsSink)}&tail=${encodeURIComponent(String(debugLogsTail))}`;
  try {
    const res = await fetch(url);
    const payload = await res.json();
    const json = JSON.stringify(payload);
    if (json === lastDebugLogsJson) return;
    lastDebugLogsJson = json;

    if (!payload.ok) {
      if (errEl) errEl.textContent = payload.error || "Failed to load logs";
      if (metaEl) metaEl.textContent = payload.path ? payload.path : "";
      body.textContent = payload.error || "Log unavailable";
      body.classList.add("empty-state");
      return;
    }
    if (errEl) errEl.textContent = "";
    if (metaEl) {
      const counts = summarizeLogLines(payload.lines);
      metaEl.textContent = `${payload.path} · ${payload.lines.length}/${payload.totalLines} lines (tail ${payload.tail}) · ${counts.error} error · ${counts.warn} warn`;
    }
    renderDebugLogLines(payload.lines);
  } catch (err) {
    if (errEl) errEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

function scheduleDebugLogsPoll() {
  if (debugLogsTabTimer) clearInterval(debugLogsTabTimer);
  debugLogsTabTimer = null;
  if (activeTab !== "logs") return;
  debugLogsTabTimer = setInterval(() => {
    void refreshDebugLogs();
  }, DEBUG_LOGS_POLL_MS);
}

function wireLogsTabPanel() {
  const select = document.getElementById("logs-sink-select");
  if (select && select.dataset.wired !== "1") {
    select.dataset.wired = "1";
    select.addEventListener("change", () => {
      debugLogsSink = select.value;
      lastDebugLogsJson = "";
      void refreshDebugLogs();
    });
  }
  const tailInput = document.getElementById("logs-tail-input");
  if (tailInput && tailInput.dataset.wired !== "1") {
    tailInput.dataset.wired = "1";
    tailInput.addEventListener("change", () => {
      const value = Number(tailInput.value);
      debugLogsTail = Number.isFinite(value) ? Math.min(200, Math.max(1, Math.floor(value))) : 50;
      tailInput.value = String(debugLogsTail);
      lastDebugLogsJson = "";
      void refreshDebugLogs();
    });
  }
}

function wireEventsPanel() {
  const filter = document.getElementById("events-type-filter");
  if (filter && filter.dataset.wired !== "1") {
    filter.dataset.wired = "1";
    filter.value = eventsTypeFilter;
    filter.addEventListener("change", () => {
      eventsTypeFilter = filter.value;
      lastEventsJson = "";
      void refreshEvents();
    });
  }
  const exportMd = document.getElementById("events-export-md");
  if (exportMd && exportMd.dataset.wired !== "1") {
    exportMd.dataset.wired = "1";
    exportMd.addEventListener("click", () => {
      const typeParam = eventsTypeFilter ? `&type=${encodeURIComponent(eventsTypeFilter)}` : "";
      window.open(apiUrl(`/api/events/export?format=markdown${typeParam}`), "_blank");
    });
  }
  const exportJson = document.getElementById("events-export-json");
  if (exportJson && exportJson.dataset.wired !== "1") {
    exportJson.dataset.wired = "1";
    exportJson.addEventListener("click", () => {
      const typeParam = eventsTypeFilter ? `&type=${encodeURIComponent(eventsTypeFilter)}` : "";
      window.open(apiUrl(`/api/events/export?format=json${typeParam}`), "_blank");
    });
  }
}

function switchTab(tab) {
  const previous = activeTab;
  activeTab = tab;
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`nav button[data-tab="${tab}"]`)?.classList.add("active");
  document.getElementById(tab)?.classList.add("active");

  // Deactivate previous panel (clean up timers, etc.)
  const prevPanel = PANELS[previous];
  if (prevPanel?.deactivate) {
    try {
      prevPanel.deactivate();
    } catch (err) {
      console.error(`dashboard.deactivate(${previous})`, err);
    }
  }

  // Activate new panel
  const nextPanel = PANELS[tab];
  if (STATIC_PREVIEW) {
    showStaticPanelNotice(tab);
  } else if (nextPanel?.activate) {
    try {
      nextPanel.activate();
    } catch (err) {
      console.error(`dashboard.activate(${tab})`, err);
    }
  }

  if (!STATIC_PREVIEW && window.__HERDR_DASHBOARD_POLL_MS__) {
    scheduleSecondaryPoll(window.__HERDR_DASHBOARD_POLL_MS__);
  }
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ── Examples dashboard panel ─────────────────────────────────────────

function setExamplesError(message) {
  const err = document.getElementById("examples-error");
  if (!err) return;
  err.textContent = message;
  err.hidden = !message;
}

function setExamplesLoading(loading) {
  const loader = document.getElementById("examples-loader");
  const frame = document.getElementById("examples-frame");
  if (loader) loader.hidden = !loading;
  if (frame) frame.style.display = loading ? "none" : "block";
}

function updateExamplesUrlDisplay(url) {
  const el = document.getElementById("examples-url");
  const popout = document.getElementById("examples-popout");
  if (el) el.textContent = url || "—";
  if (popout) popout.href = url || "#";
}

function clearExamplesLoadTimer() {
  if (!examplesLoadTimer) return;
  clearTimeout(examplesLoadTimer);
  examplesLoadTimer = null;
}

async function examplesHealthProbe() {
  const res = await fetch("/api/examples/health");
  return res.json();
}

async function loadExamplesDashboard(url) {
  const frame = document.getElementById("examples-frame");
  if (!frame) return;
  if (!url) {
    clearExamplesLoadTimer();
    setExamplesError("Examples dashboard URL not configured.");
    setExamplesLoading(false);
    return;
  }
  setExamplesError("");
  setExamplesLoading(true);
  frame.src = "about:blank";

  let health = null;
  try {
    health = await examplesHealthProbe();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setExamplesLoading(false);
    setExamplesError(`Could not check examples dashboard health: ${message}`);
    return;
  }

  if (!health?.ok) {
    setExamplesLoading(false);
    const detail = health?.error ? ` (${health.error})` : "";
    setExamplesError(
      `Examples dashboard is not running at ${url}${detail}. Start it with: PORT=5678 bun run dashboard`
    );
    return;
  }

  clearExamplesLoadTimer();
  setExamplesLoading(true);
  examplesLoadTimer = setTimeout(() => {
    setExamplesLoading(false);
    setExamplesError(`Examples dashboard did not finish loading at ${url}. Try Reload or Open.`);
  }, 6000);
  frame.src = url;
}

function wireExamplesPanel() {
  const frame = document.getElementById("examples-frame");
  const reload = document.getElementById("examples-reload");
  if (!frame) return;

  frame.addEventListener("load", () => {
    clearExamplesLoadTimer();
    setExamplesLoading(false);
    setExamplesError("");
  });
  frame.addEventListener("error", () => {
    clearExamplesLoadTimer();
    setExamplesLoading(false);
    setExamplesError(`Failed to load examples dashboard at ${examplesDashboardUrl || "(unknown)"}`);
  });

  if (reload) {
    reload.addEventListener("click", () => {
      if (examplesDashboardUrl) void loadExamplesDashboard(examplesDashboardUrl);
    });
  }
}

function applyExamplesMeta(meta) {
  const url = meta?.examplesDashboardUrl || null;
  examplesDashboardUrl = url;
  updateExamplesUrlDisplay(url);
  if (activeTab === "examples" && url) {
    void loadExamplesDashboard(url);
  }
}

// ── Health summary (header badges + summary cards) ────────────────────

function healthStatusClass(status) {
  if (status === "ok") return "badge-ok";
  if (status === "warn") return "badge-warn";
  if (status === "error") return "badge-err";
  return "badge-info";
}

function healthLiveClass(status) {
  if (status === "ok") return "live-ok";
  if (status === "warn") return "live-warn";
  if (status === "error") return "live-error";
  return "";
}

function renderHeaderBadges(health) {
  const el = document.getElementById("header-badges");
  if (!el) return;
  const runtime = metaSnapshot?.runtime;
  const bunText = runtime?.bunVersion ? `bun ${runtime.bunVersion}` : "bun";
  const checks = health?.checks ?? {};
  const agents = checks.agents;
  const discovery = checks.discovery;
  const sse = checks.sse;
  const herdr = checks.herdr;
  const gate = checks.gate;
  el.innerHTML = [
    `<span class="badge ${healthStatusClass("info")}" title="Bun version">${esc(bunText)}</span>`,
    `<span class="badge ${healthStatusClass(agents?.status)}" title="Agents">agents ${agents?.count ?? "—"}</span>`,
    `<span class="badge ${healthStatusClass(discovery?.status)}" title="Workspace">${esc(discovery?.workspaceId ? `workspace ${discovery.workspaceId.slice(0, 8)}` : "workspace —")}</span>`,
    `<span class="badge ${healthStatusClass(sse?.status)}" title="SSE subscribers">sse ${sse?.subscribers ?? "—"}</span>`,
    `<span class="badge ${healthStatusClass(herdr?.status)}" title="Herdr socket">herdr ${herdr?.connected ? "✓" : herdr?.status === "unknown" ? "off" : "✗"}</span>`,
    `<span class="badge ${healthStatusClass(gate?.status)}" title="Gate health">gates ${gate?.failed === false ? "✓" : gate?.failed === true ? "✗" : "—"}</span>`,
    `<span class="badge ${healthStatusClass(checks.probe?.status)}" title="Serve-probe cards">probe ${checks.probe?.reachable ? (checks.probe?.fail > 0 ? "✗" : checks.probe?.unknown > 0 ? "?" : "✓") : "off"}</span>`,
  ].join("");
}

function renderSummaryCards(health) {
  const checks = health?.checks ?? {};
  for (const key of ["agents", "sse", "herdr", "gate", "probe", "discovery"]) {
    const check = checks[key];
    const el = document.getElementById(`health-${key}`);
    if (!el || !check) continue;
    const body = el.querySelector(".summary-body");
    if (body) body.textContent = check.message || check.status;
    el.classList.remove("live-ok", "live-warn", "live-error");
    const live = healthLiveClass(check.status);
    if (live) el.classList.add(live);
  }
}

async function refreshTlsCompliance() {
  try {
    const res = await fetch("/api/tls-compliance");
    const payload = await res.json();
    const el = document.getElementById("health-tls");
    if (!el) return;
    const body = el.querySelector(".summary-body");
    if (body)
      body.textContent =
        payload.status === "pass" ? `✓ ${payload.floor}` : payload.reason || payload.status;
    el.classList.remove("live-ok", "live-warn", "live-error");
    const live = healthLiveClass(
      payload.status === "pass" ? "ok" : payload.status === "fail" ? "error" : "unknown"
    );
    if (live) el.classList.add(live);
  } catch (err) {
    console.error("dashboard.tls-compliance", err);
  }
}

function renderHealth(health) {
  lastHealthPayload = health;
  renderHeaderBadges(health);
  if (activeTab === "agents") {
    renderSummaryCards(health);
  }
}

async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    const payload = await res.json();
    renderHealth(payload);
  } catch (err) {
    console.error("dashboard.health", err);
  }
}

function scheduleHealthPoll() {
  if (healthPollTimer) return;
  healthPollTimer = setInterval(() => {
    void refreshHealth();
    void refreshTlsCompliance();
  }, HEALTH_POLL_MS);
}

wireExamplesPanel();

wireSessionSelector();
wireProcessesToggle();
wireGitToggle();
wireScanPanel();
wireCanvasesPanel();
wireMetricsPanel();
wireLineagePanel();
wireEventsPanel();
wireLogsTabPanel();
if (STATIC_PREVIEW) {
  document.body.dataset.mode = "static-preview";
}
scheduleGateHealthPoll();

// Activate the initial tab so panels can run their setup logic.
PANELS[activeTab]?.activate?.();

(async () => {
  try {
    const res = await fetch("/api/meta");
    if (!res.ok) throw new Error(`dashboard API returned ${res.status}`);
    const meta = await res.json();
    renderMetaDisplay(meta);
    wireAgentThumbnail(meta);
    applyExamplesMeta(meta);
    renderHeaderBadges(null);
    void refreshHealth();
    void refreshTlsCompliance();
    scheduleHealthPoll();
    const poll = meta.pollHintMs || 5000;
    window.__HERDR_DASHBOARD_POLL_MS__ = poll;
    scheduleMetaRefresh(meta.ssePollMs);
    connectAgentsLive();
    scheduleSecondaryPoll(poll);
    scheduleProcessesPoll(poll);
    void fetchGit();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderHeaderBadges(null);
    renderSummaryCards(null);
    const meta = document.getElementById("meta");
    if (meta) {
      meta.textContent = STATIC_PREVIEW ? "Static file preview" : "Dashboard unavailable";
    }
    const control = document.getElementById("control-plane-status");
    if (control) {
      control.innerHTML = `Could not reach dashboard API at <a href="${STATIC_API_ORIGIN}/">${STATIC_API_ORIGIN}</a>: ${esc(message)}`;
    }
    const errorEl = document.getElementById("agents-error");
    if (errorEl) {
      errorEl.innerHTML = `<strong>No dashboard data.</strong> Start or reload the dashboard server at <a href="${STATIC_API_ORIGIN}/">${STATIC_API_ORIGIN}</a>.`;
    }
    showStaticPanelNotice(activeTab);
  }
})();
