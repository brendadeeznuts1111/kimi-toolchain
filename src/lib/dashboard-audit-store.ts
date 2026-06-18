/**
 * dashboard-audit-store.ts — SQLite audit trail for dashboard events.
 *
 * Persists gate:failed, gate:cleared, scan.fix, and handoff events
 * to ~/.kimi-code/var/dashboard-events.db (WAL mode).
 *
 * Auto-prunes events older than 30 days on each write.
 * Bun.nanoseconds() precision for event timestamps.
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { varDir } from "./paths.ts";

// ── Types ──────────────────────────────────────────────────────────

export type DashboardEventType =
  | "gate.failed"
  | "gate.cleared"
  | "gate.health"
  | "scan.fix"
  | "scan.run"
  | "handoff";

export interface DashboardEventRow {
  type: DashboardEventType;
  workspace?: string;
  agent?: string;
  payload: Record<string, unknown>;
  at: number; // Bun.nanoseconds()
}

export interface DashboardEventQuery {
  type?: string;
  workspace?: string;
  since?: number;
  limit?: number;
}

export interface DashboardEventsPayload {
  ok: boolean;
  events: Array<{
    id: number;
    type: string;
    workspace: string | null;
    agent: string | null;
    payload: Record<string, unknown>;
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
      row.at
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
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const countRow = db
      .query(`SELECT COUNT(*) as cnt FROM events ${where}`)
      .get(...(params as never)) as {
      cnt: number;
    };
    const count = countRow?.cnt ?? 0;

    const rows = db
      .query(`SELECT * FROM events ${where} ORDER BY at DESC LIMIT ?`)
      .all(...(params as never), limit) as Array<{
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

    return {
      ok: true,
      events: rows.map((r) => ({
        id: r.id,
        type: r.type,
        workspace: r.workspace,
        agent: r.agent,
        payload: JSON.parse(r.payload) as Record<string, unknown>,
        at: r.at,
      })),
      count,
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
