/**
 * dashboard-audit-store.ts — SQLite audit trail for dashboard events.
 *
 * Persists gate:failed, gate:cleared, scan.fix, and handoff events
 * to ~/.kimi-code/var/dashboard-events.db (WAL mode).
 *
 * Auto-prunes events older than 30 days on each write.
 * Timestamps are epoch nanoseconds (`dashboardEventTimestamp()`).
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { varDir } from "./paths.ts";

// ── Types ──────────────────────────────────────────────────────────

export type DashboardEventType =
  | "gate.failed"
  | "gate.cleared"
  | "gate.health"
  | "herdr.event"
  | "scan.fix"
  | "scan.run"
  | "handoff";

export interface DashboardEventRow {
  type: DashboardEventType;
  workspace?: string;
  agent?: string;
  payload: Record<string, unknown>;
  /** Epoch nanoseconds preferred; legacy Bun.nanoseconds() values are normalized on write. */
  at: number;
}

/** Wall-clock event timestamp (epoch ns) — matches prune cutoff math. */
export function dashboardEventTimestamp(): number {
  return Number(BigInt(Date.now()) * 1_000_000n);
}

export interface DashboardEventQuery {
  type?: string;
  workspace?: string;
  agent?: string;
  severity?: string;
  q?: string;
  since?: number;
  limit?: number;
}

export type DashboardEventSeverity = "error" | "warn" | "info" | "ok" | "neutral";

export interface DashboardEventsPayload {
  ok: boolean;
  events: Array<{
    id: number;
    type: string;
    workspace: string | null;
    agent: string | null;
    payload: Record<string, unknown>;
    severity: DashboardEventSeverity;
    tags: string[];
    payloadKeys: string[];
    at: number;
  }>;
  count: number;
  types: string[];
  fetchedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────

const DB_NAME = "dashboard-events.db";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EPOCH_NANOS_FLOOR = 1_000_000_000_000_000;

function normalizeEventLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function normalizeEventTimestamp(at: number): number {
  if (!Number.isFinite(at) || at < 1) return Date.now() * 1_000_000;
  return at < EPOCH_NANOS_FLOOR ? Date.now() * 1_000_000 : at;
}

function dashboardEventSeverity(
  type: string,
  payload: Record<string, unknown>
): DashboardEventSeverity {
  const key = type.toLowerCase();
  const status = String(payload.status ?? payload.level ?? payload.severity ?? "").toLowerCase();
  if (
    key.includes("failed") ||
    key.includes("error") ||
    status === "error" ||
    status === "fail" ||
    payload.ok === false
  ) {
    return "error";
  }
  if (key.includes("warn") || status === "warn" || status === "warning") return "warn";
  if (key.includes("cleared") || status === "ok" || status === "pass" || payload.ok === true) {
    return "ok";
  }
  if (key.startsWith("scan.") || key.startsWith("dashboard.") || key.startsWith("herdr.")) {
    return "info";
  }
  return "neutral";
}

function dashboardEventPayloadKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).slice(0, 8);
}

function dashboardEventTags(
  type: string,
  workspace: string | null,
  agent: string | null,
  payload: Record<string, unknown>
): string[] {
  const tags = new Set<string>();
  tags.add(type);
  tags.add(dashboardEventSeverity(type, payload));
  if (workspace) tags.add(`workspace:${workspace}`);
  if (agent) tags.add(`agent:${agent}`);
  for (const key of ["gate", "name", "ruleId", "source"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) tags.add(`${key}:${value}`);
  }
  return [...tags];
}

function deriveDashboardEventAgent(
  explicit: string | null,
  payload: Record<string, unknown>
): string | null {
  if (explicit) return explicit;
  for (const key of ["agent", "agentName", "sourceAgent", "targetAgent"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function eventMatchesQuery(
  row: {
    type: string;
    workspace: string | null;
    agent: string | null;
    payload: Record<string, unknown>;
    severity: DashboardEventSeverity;
    tags: string[];
  },
  query: DashboardEventQuery
): boolean {
  const agent = query.agent?.trim().toLowerCase();
  if (agent && row.agent?.toLowerCase() !== agent) return false;
  const severity = query.severity?.trim().toLowerCase();
  if (severity && row.severity !== severity) return false;
  const text = query.q?.trim().toLowerCase();
  if (!text) return true;
  const haystack = [
    row.type,
    row.workspace ?? "",
    row.agent ?? "",
    row.severity,
    row.tags.join(" "),
    JSON.stringify(row.payload),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(text);
}

// ── DB lifecycle ───────────────────────────────────────────────────

let _db: Database | null = null;

function dbPath(): string {
  return join(varDir(), DB_NAME);
}

function openDb(): Database {
  if (_db) return _db;
  const path = dbPath();
  _db = new Database(path, { create: true });
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA busy_timeout = 3000");
  _db.exec("PRAGMA trusted_schema = OFF");
  _db.exec("PRAGMA parser_depth = 1000");
  initSchema();
  return _db;
}

function initSchema(): void {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      workspace TEXT,
      agent TEXT,
      payload TEXT NOT NULL,
      at INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_events_type_at ON events(type, at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace, at)");
}

/** Close the database (for tests / server shutdown). */
export function closeAuditStore(): void {
  _db?.close();
  _db = null;
}

// ── Write ──────────────────────────────────────────────────────────

/** Persist a dashboard event to the audit trail. */
export function writeDashboardEvent(row: DashboardEventRow): void {
  try {
    const db = openDb();
    const stmt = db.prepare(
      "INSERT INTO events (type, workspace, agent, payload, at) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(
      row.type,
      row.workspace ?? null,
      row.agent ?? null,
      JSON.stringify(row.payload),
      normalizeEventTimestamp(row.at)
    );
    pruneEvents();
  } catch {
    // Audit store is best-effort — never crash the dashboard on DB errors
  }
}

// ── Query ──────────────────────────────────────────────────────────

/** Query events with optional filters. */
export function queryDashboardEvents(query: DashboardEventQuery = {}): DashboardEventsPayload {
  try {
    const db = openDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.type) {
      conditions.push("type = ?");
      params.push(query.type);
    }
    if (query.workspace) {
      conditions.push("workspace = ?");
      params.push(query.workspace);
    }
    if (query.since) {
      conditions.push("at > ?");
      params.push(query.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = normalizeEventLimit(query.limit);

    const rows = db
      .query(`SELECT * FROM events ${where} ORDER BY at DESC LIMIT ?`)
      .all(...(params as never), MAX_LIMIT) as Array<{
      id: number;
      type: string;
      workspace: string | null;
      agent: string | null;
      payload: string;
      at: number;
    }>;

    const typesRow = db.query("SELECT DISTINCT type FROM events ORDER BY type").all() as Array<{
      type: string;
    }>;
    const types = typesRow.map((r) => r.type);

    const enriched = rows
      .map((r) => {
        const payload = JSON.parse(r.payload) as Record<string, unknown>;
        const agent = deriveDashboardEventAgent(r.agent, payload);
        const severity = dashboardEventSeverity(r.type, payload);
        const tags = dashboardEventTags(r.type, r.workspace, agent, payload);
        return {
          id: r.id,
          type: r.type,
          workspace: r.workspace,
          agent,
          payload,
          severity,
          tags,
          payloadKeys: dashboardEventPayloadKeys(payload),
          at: r.at,
        };
      })
      .filter((row) => eventMatchesQuery(row, query));

    return {
      ok: true,
      events: enriched.slice(0, limit),
      count: enriched.length,
      types,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return { ok: false, events: [], count: 0, types: [], fetchedAt: new Date().toISOString() };
  }
}

// ── Prune ──────────────────────────────────────────────────────────

/** Remove events older than PRUNE_AFTER_MS. Called automatically on each write. */
function pruneEvents(): void {
  try {
    const db = openDb();
    const cutoff =
      BigInt(Date.now()) * BigInt(1_000_000) - BigInt(PRUNE_AFTER_MS) * BigInt(1_000_000);
    db.run("DELETE FROM events WHERE at < ?", [Number(cutoff)]);
  } catch {
    // Best-effort
  }
}

/** Force prune with a custom retention window (for tests). */
export function forcePruneEvents(retainMs: number): number {
  const db = openDb();
  const cutoff = BigInt(Date.now()) * BigInt(1_000_000) - BigInt(retainMs) * BigInt(1_000_000);
  const result = db.run("DELETE FROM events WHERE at < ?", [Number(cutoff)]);
  return result.changes;
}

// ── Export ─────────────────────────────────────────────────────────

/** Export events as a Markdown table string. */
export function exportEventsToMarkdown(events: DashboardEventsPayload["events"]): string {
  if (events.length === 0) return "No events.\n";
  const lines = [
    "| Time | Type | Workspace | Agent | Detail |",
    "|------|------|-----------|-------|--------|",
  ];
  for (const e of events) {
    const time = new Date(Number(BigInt(e.at) / BigInt(1_000_000))).toISOString();
    const detail =
      typeof e.payload?.message === "string"
        ? e.payload.message.slice(0, 80)
        : JSON.stringify(e.payload).slice(0, 80);
    lines.push(`| ${time} | ${e.type} | ${e.workspace ?? "—"} | ${e.agent ?? "—"} | ${detail} |`);
  }
  return lines.join("\n") + "\n";
}
