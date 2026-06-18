/**
 * error-log-discovery.ts — Canonical error/console log sink registry.
 *
 * Powers `kimi-debug logs` — lists where dedicated error logs live and how to read them.
 */

import { join } from "path";
import { listDir, pathExists, pathStat } from "./bun-io.ts";
import { getHandoffLogPath } from "./handoff-log.ts";
import {
  clusterMetadataPath,
  dashboardEventsDbPath,
  decisionLedgerPath,
  desktopRoot,
  effectGatesPath,
  failureLedgerPath,
  healthEventsPath,
  healthSnapshotsPath,
  herdrClientLogPath,
  herdrServerLogPath,
  homeDir,
  projectKimiDir,
  traceEventsPath,
} from "./paths.ts";

export type ErrorLogSinkKind = "jsonl" | "sqlite" | "text" | "ndjson";

export type ErrorLogSinkScope = "global" | "project" | "session" | "runtime";

export interface ErrorLogSinkDescriptor {
  id: string;
  label: string;
  path: string;
  kind: ErrorLogSinkKind;
  scope: ErrorLogSinkScope;
  purpose: string;
  readCommand: string;
}

export interface ErrorLogSinkStatus extends ErrorLogSinkDescriptor {
  present: boolean;
  bytes?: number;
  mtimeMs?: number;
}

export interface ErrorLogDiscoveryReport {
  schemaVersion: 1;
  tool: "kimi-debug";
  mode: "logs";
  projectRoot: string;
  sinks: ErrorLogSinkStatus[];
  fetchedAt: string;
}

const ORCHESTRATOR_EVENTS_LOG = join("/tmp", "herdr-orchestrator-events.log");

/** Find the most recent Kimi Code wire.jsonl across all sessions. */
export function findLatestWireLogPath(home: string = homeDir()): string | null {
  const sessionsDir = join(home, ".kimi-code", "sessions");
  if (!pathExists(sessionsDir)) return null;

  let latestWire: string | null = null;
  let latestMtime = 0;

  for (const workspace of listDir(sessionsDir, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const workspacePath = join(sessionsDir, workspace.name);
    for (const session of listDir(workspacePath, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const wirePath = join(workspacePath, session.name, "agents", "main", "wire.jsonl");
      if (!pathExists(wirePath)) continue;
      const mtime = pathStat(wirePath).mtimeMs;
      if (mtime > latestMtime) {
        latestMtime = mtime;
        latestWire = wirePath;
      }
    }
  }
  return latestWire;
}

/** Glob `.kimi/finish-work-gate-*.log` under a project root. */
export function findFinishWorkGateLogPaths(projectRoot: string): string[] {
  const kimiDir = projectKimiDir(projectRoot);
  if (!pathExists(kimiDir)) return [];
  const glob = new Bun.Glob("finish-work-gate-*.log");
  return [...glob.scanSync({ cwd: kimiDir, absolute: true })].sort();
}

function statSink(descriptor: ErrorLogSinkDescriptor): ErrorLogSinkStatus {
  if (!pathExists(descriptor.path)) {
    return { ...descriptor, present: false };
  }
  const stat = pathStat(descriptor.path);
  return {
    ...descriptor,
    present: true,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function baseGlobalSinks(projectRoot: string): ErrorLogSinkDescriptor[] {
  const ledger = failureLedgerPath();
  const sinks: ErrorLogSinkDescriptor[] = [
    {
      id: "tool-failures",
      label: "Tool failure ledger",
      path: ledger,
      kind: "jsonl",
      scope: "global",
      purpose: "Classified PostToolUseFailure and managed tool errors",
      readCommand: `kimi-debug ledger ${ledger}`,
    },
    {
      id: "trace-events",
      label: "Trace events",
      path: traceEventsPath(),
      kind: "jsonl",
      scope: "global",
      purpose: "Failure trace correlation events",
      readCommand: `tail -n 40 ${traceEventsPath()}`,
    },
    {
      id: "health-events",
      label: "Health channel",
      path: healthEventsPath(),
      kind: "jsonl",
      scope: "global",
      purpose: "Cross-tool lifecycle telemetry (kimi-doctor publish, governor subscribe)",
      readCommand: `tail -n 40 ${healthEventsPath()}`,
    },
    {
      id: "error-clusters",
      label: "Error clusters",
      path: clusterMetadataPath(),
      kind: "text",
      scope: "global",
      purpose: "kimi-heal cluster metadata snapshot",
      readCommand: `kimi-heal clusters --json`,
    },
    {
      id: "handoff-log",
      label: "Handoff audit",
      path: getHandoffLogPath(),
      kind: "jsonl",
      scope: "global",
      purpose: "Herdr orchestrator handoff rule evaluations",
      readCommand: `herdr-orchestrator history --limit 20`,
    },
    {
      id: "dashboard-events",
      label: "Dashboard audit",
      path: dashboardEventsDbPath(),
      kind: "sqlite",
      scope: "global",
      purpose: "gate.failed, gate.cleared, scan, handoff events from live dashboard",
      readCommand: `curl -s http://127.0.0.1:18412/api/events/export?format=markdown`,
    },
    {
      id: "orchestrator-events",
      label: "Orchestrator watch-events",
      path: ORCHESTRATOR_EVENTS_LOG,
      kind: "text",
      scope: "runtime",
      purpose: "Background watch-events stdout from Herdr bootstrap",
      readCommand: `tail -n 40 ${ORCHESTRATOR_EVENTS_LOG}`,
    },
    {
      id: "herdr-server",
      label: "Herdr server log",
      path: herdrServerLogPath(),
      kind: "text",
      scope: "global",
      purpose:
        "Herdr API socket listener — events.subscribe stream_closed churn, saturation signals",
      readCommand: `kimi-debug logs --id herdr-server --tail 40`,
    },
    {
      id: "herdr-client",
      label: "Herdr client log",
      path: herdrClientLogPath(),
      kind: "text",
      scope: "global",
      purpose: "Herdr TUI client attach/handshake failures (EAGAIN on herdr-client.sock)",
      readCommand: `kimi-debug logs --id herdr-client --tail 40`,
    },
    {
      id: "decision-ledger",
      label: "Decision ledger (legacy)",
      path: decisionLedgerPath(),
      kind: "jsonl",
      scope: "global",
      purpose: "Legacy v1 decision log — prefer project .kimi/decisions.ndjson",
      readCommand: `tail -n 20 ${decisionLedgerPath()}`,
    },
  ];

  const wirePath = findLatestWireLogPath();
  if (wirePath) {
    sinks.push({
      id: "wire-session",
      label: "Kimi Code wire log",
      path: wirePath,
      kind: "jsonl",
      scope: "session",
      purpose: "Latest session tool results (isError=true) — console-equivalent",
      readCommand: `kimi-debug wire ${wirePath}`,
    });
  }

  sinks.push(
    {
      id: "effect-gates",
      label: "Effect gates history",
      path: effectGatesPath(projectRoot),
      kind: "ndjson",
      scope: "project",
      purpose: "Project effect-gates run history",
      readCommand: `tail -n 20 ${effectGatesPath(projectRoot)}`,
    },
    {
      id: "health-snapshots",
      label: "Health snapshots",
      path: healthSnapshotsPath(projectRoot),
      kind: "ndjson",
      scope: "project",
      purpose: "kimi-doctor health check snapshots for this project",
      readCommand: `tail -n 10 ${healthSnapshotsPath(projectRoot)}`,
    }
  );

  for (const gateLog of findFinishWorkGateLogPaths(projectRoot)) {
    const base = gateLog.split("/").pop() ?? gateLog;
    const id = base.replace(/\.log$/, "");
    sinks.push({
      id,
      label: `Finish-work gate (${id})`,
      path: gateLog,
      kind: "text",
      scope: "project",
      purpose: "Captured stdout from a finish-work gate subprocess",
      readCommand: `tail -n 40 ${gateLog}`,
    });
  }

  return sinks;
}

/** Default tail for dashboard Logs tab and `GET /api/debug/logs`. */
export const DASHBOARD_LOG_TAIL_DEFAULT = 50;

/** Max tail lines for dashboard/API. */
export const DASHBOARD_LOG_TAIL_MAX = 200;

/** Curated dashboard sinks — P1 + P2 only; excludes wire.jsonl and other noisy paths. */
export function isDashboardCuratedLogSink(id: string): boolean {
  if (id === "tool-failures" || id === "orchestrator-events") return true;
  return id.startsWith("finish-work-gate-");
}

/** P1 = error traces; P2 = orchestrator stream (noisier). */
export function dashboardLogSinkPriority(id: string): "p1" | "p2" {
  return id === "orchestrator-events" ? "p2" : "p1";
}

/** Subset of {@link discoverErrorLogSinks} for the dashboard Logs tab. */
export function discoverDashboardLogSinks(projectRoot: string): ErrorLogSinkStatus[] {
  return discoverErrorLogSinks(projectRoot).sinks.filter((sink) =>
    isDashboardCuratedLogSink(sink.id)
  );
}

/** Resolve all known error/console log sinks with presence stats. */
export function discoverErrorLogSinks(projectRoot: string): ErrorLogDiscoveryReport {
  const sinks = baseGlobalSinks(projectRoot).map(statSink);
  return {
    schemaVersion: 1,
    tool: "kimi-debug",
    mode: "logs",
    projectRoot,
    sinks,
    fetchedAt: new Date().toISOString(),
  };
}

const ERROR_LINE_RE =
  /\b(error|fail(?:ed|ure)?|exception|panic|fatal|warn(?:ing)?|✗|✘|ECONNREFUSED|ENOENT)\b/i;

/** Return true when a log line looks error-related. */
export function isErrorLogLine(line: string): boolean {
  return ERROR_LINE_RE.test(line);
}

function splitLogLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

export function clampDashboardLogTail(tail: number | undefined): number {
  const raw =
    typeof tail === "number" && Number.isFinite(tail)
      ? Math.floor(tail)
      : DASHBOARD_LOG_TAIL_DEFAULT;
  return Math.min(DASHBOARD_LOG_TAIL_MAX, Math.max(1, raw));
}

/** Tail a text/jsonl log file with total line count. */
export async function readErrorLogTail(
  path: string,
  tail = DASHBOARD_LOG_TAIL_DEFAULT
): Promise<{ lines: string[]; totalLines: number }> {
  if (!pathExists(path)) return { lines: [], totalLines: 0 };
  const rows = splitLogLines(await Bun.file(path).text());
  const limit = clampDashboardLogTail(tail);
  return { lines: rows.slice(-limit), totalLines: rows.length };
}

/** Tail a text/jsonl log file; optionally keep only error-like lines. */
export async function tailErrorLogFile(
  path: string,
  lines = 20,
  errorsOnly = false
): Promise<string[]> {
  const { lines: slice } = await readErrorLogTail(path, lines);
  return errorsOnly ? slice.filter(isErrorLogLine) : slice;
}

/** Format byte size for human output. */
export function formatLogBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** Resolve a sink by id from the latest discovery report. */
export function resolveErrorLogSink(
  report: ErrorLogDiscoveryReport,
  id: string
): ErrorLogSinkStatus | undefined {
  return report.sinks.find((sink) => sink.id === id);
}

/** Sessions root for inventory docs. */
export function kimiCodeSessionsDir(home: string = homeDir()): string {
  return join(desktopRoot(home), "sessions");
}
