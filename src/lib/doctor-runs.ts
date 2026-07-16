/**
 * Doctor run persistence — single implementation for all tools.
 */

import { Database } from "bun:sqlite";
import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { ensureDir, safeParse } from "./utils.ts";
import { SESSIONS_SCHEMA_SQL } from "./sessions-schema.ts";
import { varDir } from "./paths.ts";

function dbPath(): string {
  return join(varDir(), "sessions.db");
}

export interface DoctorWarning {
  check: string;
  message: string;
  severity: "warn" | "error";
  taxonomyId?: string;
}

function openSessionsDb(): Database {
  ensureDir(varDir());
  const db = new Database(dbPath(), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA trusted_schema = OFF;");
  db.exec("PRAGMA parser_depth = 1000;");
  db.exec(SESSIONS_SCHEMA_SQL);
  try {
    db.exec("ALTER TABLE warning_trends ADD COLUMN taxonomy_id TEXT");
  } catch {
    // Column already exists.
  }
  return db;
}

function resolveSessionId(): string | undefined {
  return Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined;
}

export interface DoctorRunRecord {
  timestamp: number;
  tool: string;
  warnings: DoctorWarning[];
  rScore: number | null;
  gitHead: string | null;
  project: string;
  sessionId: string | null;
  runId: string | null;
}

export function recordDoctorRun(
  project: string,
  tool: string,
  warnings: DoctorWarning[],
  rScore?: number,
  gitHead?: string,
  sessionId?: string,
  runId?: string
): void {
  using db = openSessionsDb();
  const now = Date.now();
  for (const column of ["session_id TEXT", "run_id TEXT"]) {
    try {
      db.exec(`ALTER TABLE doctor_runs ADD COLUMN ${column}`);
    } catch {
      // Column already exists.
    }
  }

  const sid = sessionId ?? resolveSessionId() ?? null;
  const rid = runId ?? Bun.env.KIMI_RUN_ID ?? null;
  db.run(
    `INSERT INTO doctor_runs (timestamp, tool, warnings_json, r_score, git_head, project, session_id, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [now, tool, JSON.stringify(warnings), rScore ?? null, gitHead ?? null, project, sid, rid]
  );

  for (const w of warnings) {
    const trendKey = w.taxonomyId || w.check;
    const existing = db
      .query("SELECT occurrence_count FROM warning_trends WHERE check_name = ?")
      .get(trendKey) as { occurrence_count: number } | null;

    if (existing) {
      db.run(
        `UPDATE warning_trends
         SET last_seen = ?, occurrence_count = occurrence_count + 1, resolved_at = NULL,
             taxonomy_id = COALESCE(?, taxonomy_id)
         WHERE check_name = ?`,
        [now, w.taxonomyId ?? null, trendKey]
      );
    } else {
      db.run(
        `INSERT INTO warning_trends (check_name, tool, first_seen, last_seen, occurrence_count, taxonomy_id)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [trendKey, tool, now, now, w.taxonomyId ?? null]
      );
    }
  }

  if (warnings.length > 0) {
    const checkNames = warnings.map((w) => w.taxonomyId || w.check);
    const placeholders = checkNames.map(() => "?").join(",");
    db.run(
      `UPDATE warning_trends SET resolved_at = ?
       WHERE resolved_at IS NULL AND check_name NOT IN (${placeholders})`,
      [now, ...checkNames]
    );
  } else {
    db.run("UPDATE warning_trends SET resolved_at = ? WHERE resolved_at IS NULL", [now]);
  }
}

export function getPersistentWarnings(tool?: string): Array<{
  check_name: string;
  tool: string;
  occurrence_count: number;
  first_seen: number;
  last_seen: number;
  age_days: number;
  taxonomy_id: string | null;
}> {
  if (!pathExists(dbPath())) return [];

  using db = openSessionsDb();
  let rows: Array<{
    check_name: string;
    tool: string;
    occurrence_count: number;
    first_seen: number;
    last_seen: number;
    taxonomy_id: string | null;
  }>;

  if (tool) {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen, taxonomy_id
         FROM warning_trends WHERE resolved_at IS NULL AND tool = ?
         ORDER BY occurrence_count DESC`
      )
      .all(tool) as typeof rows;
  } else {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen, taxonomy_id
         FROM warning_trends WHERE resolved_at IS NULL
         ORDER BY occurrence_count DESC`
      )
      .all() as typeof rows;
  }

  const now = Date.now();
  return rows.map((r) => ({
    check_name: r.check_name,
    tool: r.tool,
    occurrence_count: r.occurrence_count,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    taxonomy_id: r.taxonomy_id,
    age_days: Math.round((now - r.first_seen) / (24 * 60 * 60 * 1000)),
  }));
}

function rowToDoctorRunRecord(row: {
  timestamp: number;
  tool: string;
  warnings_json: string;
  r_score: number | null;
  git_head: string | null;
  project: string;
  session_id: string | null;
  run_id: string | null;
}): DoctorRunRecord {
  return {
    timestamp: row.timestamp,
    tool: row.tool,
    warnings: safeParse(row.warnings_json, []) as DoctorWarning[],
    rScore: row.r_score ?? null,
    gitHead: row.git_head ?? null,
    project: row.project,
    sessionId: row.session_id ?? null,
    runId: row.run_id ?? null,
  };
}

/** Query doctor runs by exact run id (newest first). */
export function getDoctorRunsByRunId(runId: string): DoctorRunRecord[] {
  if (!runId) return [];
  if (!pathExists(dbPath())) return [];
  using db = openSessionsDb();
  const rows = db
    .query(
      `SELECT timestamp, tool, warnings_json, r_score, git_head, project, session_id, run_id
       FROM doctor_runs WHERE run_id = ? ORDER BY timestamp DESC`
    )
    .all(runId) as Array<{
    timestamp: number;
    tool: string;
    warnings_json: string;
    r_score: number | null;
    git_head: string | null;
    project: string;
    session_id: string | null;
    run_id: string | null;
  }>;
  return rows.map(rowToDoctorRunRecord);
}

/** Query doctor runs by session id (newest first). */
export function getDoctorRunsBySession(sessionId: string): DoctorRunRecord[] {
  if (!sessionId) return [];
  if (!pathExists(dbPath())) return [];
  using db = openSessionsDb();
  const rows = db
    .query(
      `SELECT timestamp, tool, warnings_json, r_score, git_head, project, session_id, run_id
       FROM doctor_runs WHERE session_id = ? ORDER BY timestamp DESC`
    )
    .all(sessionId) as Array<{
    timestamp: number;
    tool: string;
    warnings_json: string;
    r_score: number | null;
    git_head: string | null;
    project: string;
    session_id: string | null;
    run_id: string | null;
  }>;
  return rows.map(rowToDoctorRunRecord);
}

/** Query doctor runs by project name (newest first). */
export function getDoctorRunsByProject(project: string): DoctorRunRecord[] {
  if (!project) return [];
  if (!pathExists(dbPath())) return [];
  using db = openSessionsDb();
  const rows = db
    .query(
      `SELECT timestamp, tool, warnings_json, r_score, git_head, project, session_id, run_id
       FROM doctor_runs WHERE project = ? ORDER BY timestamp DESC`
    )
    .all(project) as Array<{
    timestamp: number;
    tool: string;
    warnings_json: string;
    r_score: number | null;
    git_head: string | null;
    project: string;
    session_id: string | null;
    run_id: string | null;
  }>;
  return rows.map(rowToDoctorRunRecord);
}
