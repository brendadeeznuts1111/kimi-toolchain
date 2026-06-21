import {
  clampDashboardLogTail,
  dashboardLogSinkPriority,
  discoverDashboardLogSinks,
  isDashboardCuratedLogSink,
  readErrorLogTail,
  type ErrorLogSinkStatus,
} from "../../error-log-discovery.ts";
import { formatLogPreviewText } from "../../log-preview.ts";

export interface DashboardDebugLogSinkSummary {
  id: string;
  label: string;
  path: string;
  present: boolean;
  priority: "p1" | "p2";
  bytes?: number;
}

export interface DashboardDebugLogsSinksPayload {
  ok: boolean;
  sinks: DashboardDebugLogSinkSummary[];
  fetchedAt: string;
}

export interface DashboardDebugLogsTailPayload {
  ok: boolean;
  sink: string;
  path: string;
  lines: string[];
  entries: DashboardDebugLogEntry[];
  totalLines: number;
  tail: number;
  fetchedAt: string;
  error?: string;
}

export interface DashboardDebugLogEntry {
  lineNumber: number;
  severity: "error" | "warn" | "info";
  message: string;
  raw: string;
  /** Width-aware preview for log cards (stripANSI + stringWidth truncation). */
  preview: string;
  timestamp?: string;
  source?: string;
  tool?: string;
  taxonomyId?: string;
  category?: string;
  sessionId?: string;
  errorId?: string;
  tags?: string[];
  payloadKeys?: string[];
}

function toDebugLogSinkSummary(sink: ErrorLogSinkStatus): DashboardDebugLogSinkSummary {
  return {
    id: sink.id,
    label: sink.label,
    path: sink.path,
    present: sink.present,
    priority: dashboardLogSinkPriority(sink.id),
    ...(sink.bytes !== undefined ? { bytes: sink.bytes } : {}),
  };
}

function parseDashboardDebugLogJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function dashboardDebugLogSeverity(
  line: string,
  parsed: Record<string, unknown> | null = parseDashboardDebugLogJson(line)
): DashboardDebugLogEntry["severity"] {
  const parsedSeverity = typeof parsed?.severity === "string" ? parsed.severity.toLowerCase() : "";
  if (parsedSeverity === "error" || parsedSeverity === "warn" || parsedSeverity === "info") {
    return parsedSeverity;
  }
  if (/\b(error|fail(?:ed|ure)?|exception|panic|fatal|✗|✘)\b/i.test(line)) return "error";
  if (/\b(warn(?:ing)?)\b/i.test(line)) return "warn";
  return "info";
}

function firstUsefulLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? value.trim()
  );
}

function dashboardDebugLogMessage(
  line: string,
  parsed: Record<string, unknown> | null = parseDashboardDebugLogJson(line)
): string {
  const trimmed = line.trim();
  if (parsed) {
    for (const key of ["message", "msg", "error", "output", "suggestion"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return firstUsefulLine(value);
    }
  }
  return trimmed
    .replace(/^\[?\d{4}-\d{2}-\d{2}[^\]\s]*(?:\s+|]\s*)/, "")
    .replace(/^\[?(?:error|warn(?:ing)?|info|debug)\]?\s*[:|-]?\s*/i, "")
    .trim();
}

function dashboardDebugLogTags(
  sinkId: string,
  parsed: Record<string, unknown> | null,
  severity: DashboardDebugLogEntry["severity"]
): string[] {
  const tags = new Set<string>([`sink:${sinkId}`, `severity:${severity}`]);
  const add = (prefix: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) tags.add(`${prefix}:${value.trim()}`);
  };
  add("tool", parsed?.toolName);
  add("taxonomy", parsed?.taxonomyId);
  add("category", parsed?.categoryId);
  add("session", parsed?.sessionId);
  return [...tags].slice(0, 8);
}

function dashboardDebugLogEntries(
  lines: string[],
  totalLines: number,
  sinkId: string
): DashboardDebugLogEntry[] {
  const firstLine = Math.max(1, totalLines - lines.length + 1);
  return lines.map((line, index) => {
    const parsed = parseDashboardDebugLogJson(line);
    const severity = dashboardDebugLogSeverity(line, parsed);
    const message = dashboardDebugLogMessage(line, parsed);
    const tool = typeof parsed?.toolName === "string" ? parsed.toolName : undefined;
    const taxonomyId = typeof parsed?.taxonomyId === "string" ? parsed.taxonomyId : undefined;
    const category =
      typeof parsed?.categoryName === "string"
        ? parsed.categoryName
        : typeof parsed?.categoryId === "string"
          ? parsed.categoryId
          : undefined;
    return {
      lineNumber: firstLine + index,
      severity,
      message,
      raw: line,
      preview: formatLogPreviewText(message || line),
      ...(typeof parsed?.timestamp === "string" ? { timestamp: parsed.timestamp } : {}),
      source: sinkId,
      ...(tool ? { tool } : {}),
      ...(taxonomyId ? { taxonomyId } : {}),
      ...(category ? { category } : {}),
      ...(typeof parsed?.sessionId === "string" ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed?.errorId === "string" ? { errorId: parsed.errorId } : {}),
      tags: dashboardDebugLogTags(sinkId, parsed, severity),
      payloadKeys: parsed ? Object.keys(parsed).slice(0, 12) : [],
    };
  });
}

/** Curated sink registry for the Logs tab (no wire.jsonl). */
export function fetchDashboardDebugLogSinks(projectPath: string): DashboardDebugLogsSinksPayload {
  const sinks = discoverDashboardLogSinks(projectPath).map(toDebugLogSinkSummary);
  return { ok: true, sinks, fetchedAt: new Date().toISOString() };
}

/** Tail lines from a curated debug log sink. */
export async function fetchDashboardDebugLogs(
  projectPath: string,
  sinkId: string,
  tail?: number
): Promise<DashboardDebugLogsTailPayload> {
  const fetchedAt = new Date().toISOString();
  const id = sinkId.trim();
  const limit = clampDashboardLogTail(tail);
  if (!id) {
    return {
      ok: false,
      sink: "",
      path: "",
      lines: [],
      entries: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: "sink required",
    };
  }

  if (!isDashboardCuratedLogSink(id)) {
    return {
      ok: false,
      sink: id,
      path: "",
      lines: [],
      entries: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: `unknown or non-curated sink "${id}"`,
    };
  }

  const sink = discoverDashboardLogSinks(projectPath).find((row) => row.id === id);
  if (!sink) {
    return {
      ok: false,
      sink: id,
      path: "",
      lines: [],
      entries: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: `unknown sink "${id}"`,
    };
  }

  if (!sink.present) {
    return {
      ok: false,
      sink: id,
      path: sink.path,
      lines: [],
      entries: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: "log file not found",
    };
  }

  if (sink.kind === "sqlite") {
    return {
      ok: false,
      sink: id,
      path: sink.path,
      lines: [],
      entries: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: "sqlite sinks are not tailable via this API",
    };
  }

  const { lines, totalLines } = await readErrorLogTail(sink.path, limit);
  return {
    ok: true,
    sink: id,
    path: sink.path,
    lines,
    entries: dashboardDebugLogEntries(lines, totalLines, id),
    totalLines,
    tail: limit,
    fetchedAt,
  };
}
