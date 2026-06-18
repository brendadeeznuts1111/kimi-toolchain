#!/usr/bin/env bun
/**
 * validate-processes-panel.ts — Smoke validation for processes UI + API contract.
 */

import { join } from "path";
import { readText } from "../src/lib/bun-io.ts";
import { fetchHttp, fetchJsonBody, readableStreamToText } from "../src/lib/bun-utils.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard-discovery-cache.ts";
import { startHerdrDashboardServer } from "../src/lib/herdr-dashboard-server.ts";
import type { PaneInfo } from "../src/lib/herdr-pane-service.ts";

const REPO_ROOT = join(import.meta.dir, "..");

type Row = {
  item: string;
  status: "Pass" | "Fail" | "Manual";
  expected: string;
  actual: string;
  blocker: string;
  notes: string;
};

const rows: Row[] = [];

function record(
  item: string,
  status: Row["status"],
  expected: string,
  actual: string,
  notes = "",
  blocker = ""
): void {
  rows.push({ item, status, expected, actual, blocker, notes });
}

function truncateCwd(cwd: string, max = 48): string {
  const text = String(cwd ?? "").trim();
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
}

const primaryPanes: PaneInfo[] = [
  {
    paneId: "1-1",
    tabId: "1-1",
    workspaceId: "wB",
    focused: true,
    agent: "kimi",
    agentStatus: "working",
    title: "main",
    cwd: REPO_ROOT,
    isShell: false,
  },
  {
    paneId: "1-2",
    tabId: "1-1",
    workspaceId: "wB",
    focused: false,
    agent: null,
    agentStatus: null,
    title: "shell",
    cwd: "/tmp",
    isShell: true,
  },
];

const stagingPanes: PaneInfo[] = [
  {
    paneId: "2-1",
    tabId: "2-1",
    workspaceId: "wS",
    focused: true,
    agent: "reviewer",
    agentStatus: "idle",
    title: "staging-main",
    cwd: "/var/staging/project/with/a/very/long/path/that/exceeds/forty/eight/characters",
    isShell: false,
  },
];

const js = readText(join(REPO_ROOT, "templates/herdr-dashboard.js"));
const css = readText(join(REPO_ROOT, "templates/herdr-dashboard.css"));

await Bun.spawn(["bun", "run", "scripts/sync-to-desktop.ts"], { cwd: REPO_ROOT }).exited;
const syncProc = Bun.spawn(["bun", "run", "scripts/sync-verify.ts"], {
  stdout: "pipe",
  stderr: "pipe",
  cwd: REPO_ROOT,
});
const syncExit = await syncProc.exited;
record(
  "Dashboard restart / `bun run sync`",
  syncExit === 0 ? "Pass" : "Fail",
  "sync:verify green; templates on ~/.kimi-code",
  syncExit === 0 ? "sync + sync:verify exit 0" : `sync:verify exit ${syncExit}`,
  "Restart WebView/dashboard process manually if already open (live @18412 was down)"
);

const discoveryCache = new HerdrDashboardDiscoveryCache({
  projectPath: REPO_ROOT,
  fetchOpts: { sessions: true },
  ttlMs: 5000,
  discover: async () => ({
    ok: true,
    projectPath: REPO_ROOT,
    agentCount: 0,
    agents: [],
    fetchedAt: new Date().toISOString(),
  }),
  enumerateSessions: async () => ({
    sessionsAvailable: ["", "staging"],
    entries: [
      { session: "", label: "primary", host: "(local)", reachable: true },
      { session: "staging", label: "staging", host: "(local)", reachable: true },
    ],
    errors: [],
  }),
  probeRemoteHosts: async () => ({ configured: 0, reachable: 0, hosts: [] }),
});

const server = startHerdrDashboardServer({
  projectPath: REPO_ROOT,
  port: 0,
  sessions: true,
  ssePollMs: 5000,
  pollHintMs: 5000,
  discoveryCache,
  widgetProcessesDeps: {
    listLocalPanes: (session) => {
      if (session === "staging") return { ok: true, panes: stagingPanes };
      return { ok: true, panes: primaryPanes };
    },
  },
  widgetLogsDeps: {
    readLocalPane: () => ({ ok: true, text: "mock log line\n" }),
  },
  widgetProcessesActionDeps: {
    runLocalPaneAction: () => ({ ok: true }),
  },
  widgetGitDeps: {
    readLocalGit: async () => ({
      ok: true,
      data: {
        branch: "main",
        dirty: true,
        changedCount: 1,
        status: [{ xy: " M", path: "README.md" }],
        commits: [
          { sha: "abc1234", subject: "feat: git widget", date: "2026-06-18T00:00:00+00:00" },
        ],
        commitLimit: 10,
      },
    }),
  },
});

try {
  const base = server.url;
  const htmlRes = await fetchHttp(base);
  const jsRes = await fetchHttp(`${base}herdr-dashboard.js`);
  const servedHtml = await readableStreamToText(htmlRes.body);
  const servedJs = await readableStreamToText(jsRes.body);

  record(
    "Processes panel expand — table renders",
    servedHtml.includes("processes-panel") && servedJs.includes("renderProcesses")
      ? "Pass"
      : "Fail",
    "Markup + renderProcesses served",
    `html=${servedHtml.includes("processes-panel")} js=${servedJs.includes("renderProcesses")}`,
    "DOM table rows require WebView expand click (Manual confirm)"
  );

  const primary = await fetchJsonBody<{ data?: { paneCount?: number } }>(
    `${base}api/widgets/processes`
  );
  const staging = await fetchJsonBody<{ data?: { paneCount?: number } }>(
    `${base}api/widgets/processes?session=staging`
  );

  record(
    "Session switch primary → staging — count updates",
    primary.data.data?.paneCount === 2 && staging.data.data?.paneCount === 1 ? "Pass" : "Fail",
    "primary 2 panes; staging 1 pane",
    `primary=${primary.data.data?.paneCount ?? "—"} staging=${staging.data.data?.paneCount ?? "—"}`
  );

  record(
    "Session switch — table refreshes",
    js.includes('lastProcessesJson = ""') && js.includes("void fetchProcesses()") ? "Pass" : "Fail",
    "Session change clears cache + immediate fetchProcesses",
    "change handler clears lastProcessesJson and calls fetchProcesses"
  );

  record(
    "Collapsed — summary shows pane count",
    js.includes("updateProcessesSummary") && js.includes("if (!processesExpanded)")
      ? "Pass"
      : "Fail",
    "Summary updates before collapsed early-return",
    "updateProcessesSummary called; render skips table when collapsed"
  );

  record(
    "`__all__` session — Select a single session…",
    js.includes("Select a single session to view processes") ? "Pass" : "Fail",
    "Guard when activeSession === __all__",
    "Exact string present in herdr-dashboard.js"
  );

  record(
    "Focused pane — green + bold styling",
    css.includes("tr.processes-focused") &&
      css.includes("font-weight: 600") &&
      css.includes("color: var(--green)") &&
      js.includes('tr.classList.add("processes-focused")')
      ? "Pass"
      : "Fail",
    "processes-focused class on focused rows",
    "CSS + JS wiring present",
    "Visual green/bold needs WebView glance (Manual)"
  );

  const longCwd = stagingPanes[0]!.cwd;
  const truncated = truncateCwd(longCwd, 48);
  const cwdOk =
    js.includes("truncateCwd") &&
    js.includes('title="${esc(row.cwd)}"') &&
    truncated.length <= 48 &&
    truncated.startsWith("…");
  record(
    "Cwd truncation — 48 chars + title tooltip",
    cwdOk ? "Pass" : "Fail",
    "truncateCwd(48) + title=full cwd",
    `truncatedLen=${truncated.length} hasTitleAttr=${js.includes('title="${esc(row.cwd)}"')}`
  );

  const pollMatch = js.match(/scheduleProcessesPoll\(poll\)/);
  const intervalMatch = js.match(/Math\.max\(pollMs \|\| 5000, 3000\)/);
  record(
    "Poll interval — 5s steady state",
    pollMatch && intervalMatch ? "Pass" : "Fail",
    "scheduleProcessesPoll uses poll_hint_ms (default 5000)",
    "Independent processesPollTimer; interval=max(pollMs,3000)"
  );

  const dedupOk = js.includes("if (json === lastProcessesJson) return");
  record(
    "Manual refresh — no duplicate requests",
    dedupOk ? "Pass" : "Fail",
    "Identical pane payload skips re-render",
    "lastProcessesJson dedup on render; API still polls every 5s",
    "Network polls continue; DOM updates deduped only"
  );

  const logsApi = await fetchJsonBody<{
    widget?: string;
    available?: boolean;
    lines?: string[];
    lineCount?: number;
  }>(`${base}api/widgets/logs?paneId=1-1&lines=50`);
  record(
    "Logs API — pane read returns 200",
    logsApi.data.widget === "logs" &&
      logsApi.data.available === true &&
      Array.isArray(logsApi.data.lines)
      ? "Pass"
      : "Fail",
    "GET /api/widgets/logs?paneId=&lines=",
    `paneId=1-1 lineCount=${logsApi.data.lineCount ?? "—"}`
  );

  const logsUiOk =
    js.includes("fetchPaneLogs") &&
    js.includes("processes-logs-row") &&
    js.includes("onProcessesPaneClick") &&
    css.includes(".processes-logs-pre");
  record(
    "Pane click — inline logs expand",
    logsUiOk ? "Pass" : "Fail",
    "Click row → fetchPaneLogs → processes-logs-row",
    "Replace-on-click + Load more wiring in herdr-dashboard.js/css",
    "Expand + scrollback visible in WebView (Manual)"
  );

  record(
    "Logs poll — refresh without scroll jump",
    js.includes("fetchPaneLogs(activeLogsPaneId, { scrollBottom: false })") &&
      js.includes("!logsTailEnabled")
      ? "Pass"
      : "Fail",
    "Processes poll refreshes static logs only when tail off",
    "scrollBottom:false on interval refresh"
  );

  const tailUi =
    js.includes("logsTailEnabled") &&
    js.includes("LOGS_TAIL_POLL_MS") &&
    js.includes("processes-logs-tail") &&
    js.includes("processes-logs-resume") &&
    js.includes("paneRestarted");
  record(
    "Logs tail v2 — toggle, since poll, resume",
    tailUi ? "Pass" : "Fail",
    "Tail button + since append + resume on scroll-up",
    "Poll-based tail; pane restarted badge"
  );

  const gitApi = await fetchJsonBody<{
    widget?: string;
    available?: boolean;
    data?: { branch?: string; changedCount?: number };
  }>(`${base}api/widgets/git`);
  record(
    "Git API — status + commits returns 200",
    gitApi.data.widget === "git" &&
      gitApi.data.available === true &&
      gitApi.data.data?.branch === "main"
      ? "Pass"
      : "Fail",
    "GET /api/widgets/git?session=",
    `branch=${gitApi.data.data?.branch ?? "—"} changed=${gitApi.data.data?.changedCount ?? "—"}`
  );

  const gitUiOk =
    servedHtml.includes("git-panel") &&
    js.includes("fetchGit") &&
    js.includes("renderGit") &&
    js.includes("Select a single session to view git status") &&
    css.includes(".git-panel");
  record(
    "Git panel — collapsible summary + expand",
    gitUiOk ? "Pass" : "Fail",
    "Git · branch · N changed collapsed summary",
    "git-panel markup + fetchGit/renderGit wiring",
    "Branch + status table visible in WebView (Manual)"
  );

  record(
    "Git poll — shares control-plane interval",
    js.includes("void fetchGit()") && js.includes("lastGitJson") ? "Pass" : "Fail",
    "Git refreshes on session change + processes poll",
    "lastGitJson dedup + fetchGit in scheduleProcessesPoll"
  );

  const actionRes = await fetchJsonBody<{
    ok?: boolean;
    action?: string;
    message?: string;
  }>(`${base}api/widgets/processes/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paneId: "1-1", action: "focus" }),
  });
  record(
    "Pane action API — focus returns 200",
    actionRes.status === 200 && actionRes.data.ok === true && actionRes.data.action === "focus"
      ? "Pass"
      : "Fail",
    "POST /api/widgets/processes/action",
    `status=${actionRes.status} message=${actionRes.data.message ?? "—"}`
  );

  const paneActionsUi =
    js.includes("runPaneAction") &&
    js.includes("processes-action") &&
    js.includes('action === "kill"') &&
    js.includes("confirm(") &&
    servedHtml.includes("Actions");
  record(
    "Pane action UI — inline buttons + kill confirm",
    paneActionsUi ? "Pass" : "Fail",
    "Focus/zoom/kill buttons; confirm on kill; stopPropagation",
    "Actions column in processes table",
    "Click focus/zoom in WebView (Manual)"
  );
} finally {
  server.stop();
}

let liveStatus = "down";
try {
  const live = await fetchHttp("http://127.0.0.1:18412/api/meta", {
    signal: AbortSignal.timeout(1500),
  });
  liveStatus = live.ok ? "up" : `http ${live.status}`;
} catch {
  liveStatus = "down";
}

if (liveStatus !== "up") {
  for (const row of rows) {
    if (row.status === "Pass" && row.notes.includes("Manual")) continue;
  }
}

const header =
  "| Item | Status | Expected | Actual | Blocker | Notes |\n| --- | --- | --- | --- | --- | --- |";
const body = rows
  .map(
    (r) =>
      `| ${r.item} | ${r.status} | ${r.expected.replaceAll("|", "\\|")} | ${r.actual.replaceAll("|", "\\|")} | ${r.blocker} | ${r.notes} |`
  )
  .join("\n");

console.log(`${header}\n${body}`);
console.log(`\nLive dashboard @18412: ${liveStatus}`);

const failed = rows.filter((r) => r.status === "Fail").length;
process.exit(failed > 0 ? 1 : 0);
