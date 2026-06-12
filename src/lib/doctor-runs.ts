/**
 * Doctor run persistence — single implementation for all tools.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { ensureDir } from "./utils.ts";
import { SESSIONS_SCHEMA_SQL } from "./sessions-schema.ts";
import { varDir } from "./paths.ts";

function dbPath(): string {
  return join(varDir(), "sessions.db");
}

export interface DoctorWarning {
  check: string;
  message: string;
  severity: "warn" | "error";
}

function openSessionsDb(): Database {
  ensureDir(varDir());
  const db = new Database(dbPath(), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SESSIONS_SCHEMA_SQL);
  return db;
}

export function recordDoctorRun(
  project: string,
  tool: string,
  warnings: DoctorWarning[],
  rScore?: number,
  gitHead?: string
): void {
  const db = openSessionsDb();
  const now = Date.now();

  db.run(
    `INSERT INTO doctor_runs (timestamp, tool, warnings_json, r_score, git_head, project)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [now, tool, JSON.stringify(warnings), rScore ?? null, gitHead ?? null, project]
  );

  for (const w of warnings) {
    const existing = db
      .query("SELECT occurrence_count FROM warning_trends WHERE check_name = ?")
      .get(w.check) as { occurrence_count: number } | null;

    if (existing) {
      db.run(
        `UPDATE warning_trends
         SET last_seen = ?, occurrence_count = occurrence_count + 1, resolved_at = NULL
         WHERE check_name = ?`,
        [now, w.check]
      );
    } else {
      db.run(
        `INSERT INTO warning_trends (check_name, tool, first_seen, last_seen, occurrence_count)
         VALUES (?, ?, ?, ?, 1)`,
        [w.check, tool, now, now]
      );
    }
  }

  if (warnings.length > 0) {
    const checkNames = warnings.map((w) => w.check);
    const placeholders = checkNames.map(() => "?").join(",");
    db.run(
      `UPDATE warning_trends SET resolved_at = ?
       WHERE resolved_at IS NULL AND check_name NOT IN (${placeholders})`,
      [now, ...checkNames]
    );
  } else {
    db.run("UPDATE warning_trends SET resolved_at = ? WHERE resolved_at IS NULL", [now]);
  }

  db.close();
}

export function getPersistentWarnings(tool?: string): Array<{
  check_name: string;
  tool: string;
  occurrence_count: number;
  first_seen: number;
  last_seen: number;
  age_days: number;
}> {
  if (!existsSync(dbPath())) return [];

  const db = openSessionsDb();
  let rows: Array<{
    check_name: string;
    tool: string;
    occurrence_count: number;
    first_seen: number;
    last_seen: number;
  }>;

  if (tool) {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen
         FROM warning_trends WHERE resolved_at IS NULL AND tool = ?
         ORDER BY occurrence_count DESC`
      )
      .all(tool) as typeof rows;
  } else {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen
         FROM warning_trends WHERE resolved_at IS NULL
         ORDER BY occurrence_count DESC`
      )
      .all() as typeof rows;
  }

  db.close();

  const now = Date.now();
  return rows.map((r) => ({
    check_name: r.check_name,
    tool: r.tool,
    occurrence_count: r.occurrence_count,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    age_days: Math.round((now - r.first_seen) / (24 * 60 * 60 * 1000)),
  }));
}
