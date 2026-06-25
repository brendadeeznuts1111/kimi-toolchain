/** Structured JSONL append for examples/dashboard HTTP audit (no middleware wrapper). */

import { DASHBOARD_PROBE_HEADER } from "./dashboard-card-registry.ts";
import { appendNdjsonRecordSync } from "./ndjson.ts";
import { examplesDashboardEventsPath } from "./paths.ts";

export const DASHBOARD_HTTP_LOG_SCHEMA_VERSION = 1 as const;

export type DashboardLogLevel = "info" | "warn" | "error";

export interface DashboardLogEntry {
  schemaVersion: typeof DASHBOARD_HTTP_LOG_SCHEMA_VERSION;
  ts: number;
  level: DashboardLogLevel;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  error?: string;
  probe?: boolean;
}

let _logPath: string | null = null;

function resolveLogPath(): string {
  if (!_logPath) _logPath = examplesDashboardEventsPath();
  return _logPath;
}

export function setDashboardLogPath(path: string): void {
  _logPath = path;
}

export function resetDashboardLogPath(): void {
  _logPath = null;
}

export function isDashboardProbeRequest(req: Request, url: URL): boolean {
  return (
    url.searchParams.get("probe") === "true" || req.headers.get(DASHBOARD_PROBE_HEADER) === "1"
  );
}

export function levelForStatus(status: number): DashboardLogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export function buildDashboardLogEntry(
  input: Omit<DashboardLogEntry, "schemaVersion"> & { schemaVersion?: number }
): DashboardLogEntry {
  return { ...input, schemaVersion: DASHBOARD_HTTP_LOG_SCHEMA_VERSION };
}

export function appendDashboardHttpAudit(entry: DashboardLogEntry): void {
  try {
    appendNdjsonRecordSync(resolveLogPath(), entry);
  } catch {
    // audit must not break the request path
  }
}
