// templates/modules/db/src/processor.ts
// Bun-native SQLite effect — registered via registerEffect("db") in init.ts

import { Database, type SQLQueryBindings } from "bun:sqlite";

export interface SqliteResult<T = unknown> {
  rows: T[];
  changes: number;
  lastInsertRowid: number | bigint;
}

/** Open (or create) an on-disk SQLite database. */
export function open(path: string): Database {
  return new Database(path);
}

/** Run a prepared statement and return structured results. */
export function query<T = Record<string, unknown>>(
  db: Database,
  sql: string,
  params: SQLQueryBindings[] = []
): SqliteResult<T> {
  const isSelect = /^\s*SELECT/i.test(sql);
  if (isSelect) {
    const stmt = db.query<T, SQLQueryBindings[]>(sql);
    return {
      rows: stmt.all(...params),
      changes: 0,
      lastInsertRowid: 0,
    };
  }
  const result = db.run(sql, params);
  return {
    rows: [],
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid,
  };
}

/** Health-check a database connection. */
export function ping(db: Database): { ok: boolean; version: string } {
  const row = db.query("SELECT sqlite_version() as version").get() as { version: string };
  return { ok: true, version: row.version };
}
