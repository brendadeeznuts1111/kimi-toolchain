const SESSION_STORAGE_KEY = "herdr-dashboard.activeSession";
const SESSION_ALL = "__all__";
let lastFilteredAgentsJson = "";
let lastHandoffsJson = "";
let lastScanJson = "";
let lastCanvasesJson = "";
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
let activeSession = loadActiveSession();
let thumbLive = false;

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

function updateProcessesSummary(count, label) {
  const summary = document.getElementById("processes-summary");
  if (!summary) return;
  const suffix = label ? ` · ${label}` : "";
  summary.textContent = `· ${count} pane${count === 1 ? "" : "s"}${suffix}`;
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
      renderGitEmpty("git-status-body", message, 2);
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
      renderGitEmpty("git-status-body", "Working tree clean", 2);
    } else {
      for (const row of statusRows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="git-xy ${gitStatusClass(row.xy)}">${esc(row.xy)}</span></td>
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
      renderGitEmpty("git-status-body", "Select a single session to view git status", 2);
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
      renderGitEmpty("git-status-body", message, 2);
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
  td.colSpan = 6;
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
  updateProcessesSummary(count, sessionLabel);

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
    const agentStatus = row.agentStatus
      ? `<span class="status ${statusClass(row.agentStatus)}">${esc(row.agentStatus)}</span>`
      : "—";
    tr.innerHTML = `
      <td>${esc(row.paneId)}</td>
      <td>${esc(row.title || "—")}</td>
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
  const text = lines.length ? lines.join("\n") : "(empty)";
  pre.textContent = text;
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
    td.colSpan = 6;
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
    <pre class="processes-logs-pre">${esc(lines.length ? lines.join("\n") : "(empty)")}</pre>`;

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
  const thumbUrl = `${data.thumbnailPath}?width=160&height=90&quality=75&t=${Date.now()}`;
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
  td.colSpan = 7;
  td.className = "empty-state";
  td.innerHTML = `<strong>No agents discovered</strong>${esc(message)}`;
  tr.appendChild(td);
  body.appendChild(tr);
}

function renderAgents(data) {
  lastAgentsPayload = data;
  syncSessionSelector(data.agents, metaSnapshot?.discovery);
  wireSessionSelector();

  const agents = filterAgentsBySession(data.agents || [], activeSession);
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
    tr.innerHTML = `
      <td>${esc(row.host)}</td>
      ${sessionCellHtml(row.session)}
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

  const findings = report?.findings ?? [];
  if (findings.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">No findings</td></tr>';
    return;
  }

  body.innerHTML = "";
  for (const row of findings) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="scan-file">${esc(row.file)}</td>
      <td class="scan-line">${esc(String(row.line))}</td>
      <td class="scan-rule">${esc(row.ruleId)}</td>
      <td>${esc(row.message)}</td>
      <td class="scan-suggestion">${esc(row.suggestion)}</td>
    `;
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
    body.innerHTML = '<tr><td colspan="4" class="empty-state">No canvases</td></tr>';
    return;
  }

  body.innerHTML = "";
  for (const c of canvases) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${esc(c.path)}</code></td>
      <td>${esc(c.page)}</td>
      <td>${esc(c.version || "—")}</td>
      <td class="canvas-purpose">${esc(c.purpose)}</td>
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
  // canvases tab loaded on first activation via switchTab
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
  } else if (tab === "scan") {
    lastScanJson = "";
    void refreshScan();
  } else if (tab === "canvases") {
    lastCanvasesJson = "";
    void refreshCanvases();
  }
  if (window.__HERDR_DASHBOARD_POLL_MS__) {
    scheduleSecondaryPoll(window.__HERDR_DASHBOARD_POLL_MS__);
  }
}

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

wireSessionSelector();
wireProcessesToggle();
wireGitToggle();
wireScanPanel();
wireCanvasesPanel();

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
  scheduleProcessesPoll(poll);
  void fetchGit();
})();
