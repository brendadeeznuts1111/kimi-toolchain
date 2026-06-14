/**
 * Resource governor sessions and diagnostic cache
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { governorDir } from "./paths.ts";
import { DEFAULTS } from "./governor-state.ts";

const GOVERNOR_DIR = governorDir();
const DB_PATH = join(GOVERNOR_DIR, "resource-cache.sqlite");

let _sessionId: string | null = null;

export function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = `${Bun.pid}-${Date.now()}`;
  }
  return _sessionId;
}

export function hasSessionId(): boolean {
  return _sessionId !== null;
}

export interface SessionRecord {
  id: string;
  project: string;
  startedAt: number;
  endedAt?: number;
  memoryPeakMb: number;
  cpuTimeMs: number;
  diskUsedMb: number;
}

export function startSession(project: string): SessionRecord {
  const id = getSessionId();
  const record: SessionRecord = {
    id,
    project,
    startedAt: Date.now(),
    memoryPeakMb: 0,
    cpuTimeMs: 0,
    diskUsedMb: 0,
  };
  const db = getDb();
  db.run(
    `INSERT INTO resource_sessions (id, project, started_at, memory_peak_mb, cpu_time_ms, disk_used_mb)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.project,
      record.startedAt,
      record.memoryPeakMb,
      record.cpuTimeMs,
      record.diskUsedMb,
    ]
  );
  db.close();
  return record;
}

export function endSession(id: string) {
  const db = getDb();
  db.run(`UPDATE resource_sessions SET ended_at = ? WHERE id = ?`, [Date.now(), id]);
  db.close();
}

export function updateSessionPeak(id: string, memoryMb: number, cpuMs: number) {
  const db = getDb();
  db.run(
    `UPDATE resource_sessions SET memory_peak_mb = MAX(memory_peak_mb, ?), cpu_time_ms = cpu_time_ms + ? WHERE id = ?`,
    [memoryMb, cpuMs, id]
  );
  db.close();
}

export interface CacheEntry {
  key: string;
  command: string;
  output: string;
  createdAt: number;
  expiresAt: number;
}

export function normalizeCacheEntry(row: any): CacheEntry {
  return {
    key: row.key,
    command: row.command,
    output: row.output,
    createdAt: typeof row.created_at === "string" ? parseInt(row.created_at, 10) : row.created_at,
    expiresAt: typeof row.expires_at === "string" ? parseInt(row.expires_at, 10) : row.expires_at,
  };
}

export function getDb(): Database {
  if (!existsSync(GOVERNOR_DIR)) mkdirSync(GOVERNOR_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      memory_peak_mb REAL DEFAULT 0,
      cpu_time_ms REAL DEFAULT 0,
      disk_used_mb REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS diagnostic_cache (
      key TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      output TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON diagnostic_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON resource_sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_ended ON resource_sessions(ended_at);
  `);
  return db;
}

export function hashCommand(command: string, args: string[], cwd: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify({ command, args, cwd }));
  return hasher.digest("hex").slice(0, 16);
}

export function getCached(key: string): CacheEntry | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM diagnostic_cache WHERE key = ? AND expires_at > ?")
    .get(key, Date.now()) as any;
  db.close();
  return row ? normalizeCacheEntry(row) : null;
}

export function setCached(
  key: string,
  command: string,
  output: string,
  ttlSeconds = DEFAULTS.cacheTTLSeconds
) {
  const db = getDb();
  const now = Date.now();
  const expires = now + ttlSeconds * 1000;
  db.run(
    "INSERT OR REPLACE INTO diagnostic_cache (key, command, output, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [key, command, output, now, expires]
  );
  db.close();
}

export function cleanupCache(): number {
  const db = getDb();
  const result = db.run("DELETE FROM diagnostic_cache WHERE expires_at < ?", [Date.now()]);
  const deleted = result.changes;
  db.close();
  return deleted;
}
