/**
 * SQLite index for artifact envelopes under a project artifact root.
 *
 * Mirrors `.kimi/artifacts/<gate>/<timestamp>.json` metadata so session/run/status
 * filters are indexed queries instead of O(n) JSON parses. The filesystem remains
 * the source of truth; the index is rebuilt lazily when drift is detected.
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { listDir, makeDir, pathExists, removePath } from "./bun-io.ts";

export const ARTIFACT_SCHEMA_VERSION = 1;

export interface ArtifactDependencyQuery {
  gate: string;
  since?: string;
  limit?: number;
  paths?: string[];
}

export interface ArtifactRunLineage {
  dependencies: string[];
  upstreamArtifacts: string[];
}

export interface ArtifactSessionContext {
  sessionId?: string;
  workspaceId?: string;
  paneId?: string;
  agentId?: string;
  runId?: string;
  parentRunId?: string;
}

export type ArtifactRunStatus = "pass" | "warn" | "fail";

export interface ArtifactSaveMeta extends ArtifactSessionContext {
  level?: 1 | 2 | 3;
  dependsOn?: ArtifactDependencyQuery[];
  lineageMermaid?: string;
  lineage?: ArtifactRunLineage;
  [key: string]: unknown;
}

export interface ArtifactMetadata extends ArtifactSaveMeta {
  hostname: string;
  pid: number;
  bunVersion: string;
  resultSize: number;
}

export interface ArtifactEnvelope {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  gate: string;
  savedAt: string;
  size: number;
  metadata?: ArtifactMetadata;
  payload: unknown;
}

const SCHEMA_VERSION = 1;
const DB_FILENAME = ".index.sqlite";

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gate TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    relative_path TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    saved_at_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    result_size INTEGER,
    status TEXT,
    session_id TEXT,
    workspace_id TEXT,
    pane_id TEXT,
    agent_id TEXT,
    run_id TEXT,
    parent_run_id TEXT,
    content_hash TEXT,
    metadata_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_artifacts_gate_saved_at ON artifacts(gate, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_id ON artifacts(workspace_id, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_pane_id ON artifacts(pane_id, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_agent_id ON artifacts(agent_id, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_parent_run_id ON artifacts(parent_run_id, saved_at_ms);
  CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status, saved_at_ms);
`;

/** Indexed artifact row with parsed envelope metadata from `metadata_json`. */
export interface ArtifactMetadataCollectionEntry extends ArtifactIndexRow {
  metadata: Record<string, unknown>;
}

/** Columns exposed by the index for queries and dashboards. */
export interface ArtifactIndexRow extends ArtifactSessionContext {
  gate: string;
  path: string;
  relativePath: string;
  savedAt: string;
  savedAtMs: number;
  size: number;
  resultSize?: number;
  status?: string;
  contentHash?: string;
}

/** Composite query against the artifact index. */
export interface ArtifactIndexQuery {
  gates?: string[];
  sessionIds?: string[];
  workspaceIds?: string[];
  paneIds?: string[];
  agentIds?: string[];
  runIds?: string[];
  parentRunIds?: string[];
  statuses?: string[];
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

/** Distinct identity values discovered in the index. */
export interface ArtifactIndexDistinct {
  sessionIds: string[];
  workspaceIds: string[];
  paneIds: string[];
  agentIds: string[];
  runIds: string[];
  parentRunIds: string[];
  statuses: string[];
}

export interface ArtifactIndexStats {
  totalArtifacts: number;
  gates: number;
  indexedAt: string;
  schemaVersion: number;
}

function dbPath(artifactsRoot: string): string {
  return join(artifactsRoot, DB_FILENAME);
}

function normalizeStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const row = payload as Record<string, unknown>;
  if (typeof row.status === "string") return row.status;
  if (typeof row.ok === "boolean") return row.ok ? "pass" : "fail";
  const summary = row.summary as Record<string, unknown> | undefined;
  if (typeof summary?.ok === "boolean") return summary.ok ? "pass" : "fail";
  return undefined;
}

function rowToIndexRow(row: Record<string, unknown>): ArtifactIndexRow {
  return {
    gate: String(row.gate),
    path: String(row.path),
    relativePath: String(row.relative_path),
    savedAt: String(row.saved_at),
    savedAtMs: Number(row.saved_at_ms),
    size: Number(row.size),
    ...(row.result_size != null ? { resultSize: Number(row.result_size) } : {}),
    ...(row.status != null ? { status: String(row.status) } : {}),
    ...(row.session_id != null ? { sessionId: String(row.session_id) } : {}),
    ...(row.workspace_id != null ? { workspaceId: String(row.workspace_id) } : {}),
    ...(row.pane_id != null ? { paneId: String(row.pane_id) } : {}),
    ...(row.agent_id != null ? { agentId: String(row.agent_id) } : {}),
    ...(row.run_id != null ? { runId: String(row.run_id) } : {}),
    ...(row.parent_run_id != null ? { parentRunId: String(row.parent_run_id) } : {}),
    ...(row.content_hash != null ? { contentHash: String(row.content_hash) } : {}),
  };
}

/** Compute a stable SHA-256 hex hash of a JSON-serializable payload. */
export function computeArtifactContentHash(payload: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(payload));
  return hasher.digest("hex");
}

/** Convert an ISO-8601 string to epoch milliseconds, or null if invalid. */
function isoToMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Apply WAL + SQLite 3.53 hardening pragmas (best-effort on older SQLite). */
export function applyArtifactIndexPragmas(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 3000");
  for (const pragma of [
    "PRAGMA foreign_keys = ON",
    "PRAGMA trusted_schema = OFF",
    "PRAGMA parser_depth = 1000",
  ]) {
    try {
      db.exec(pragma);
    } catch {
      // parser_depth / trusted_schema require SQLite ≥ 3.53 on some builds
    }
  }
}

/**
 * SQLite-backed index for artifact envelopes.
 *
 * The index is lazy: it opens on first use, creates its schema, and can rebuild
 * itself by scanning the artifact filesystem. Callers should treat the index as
 * a cache; the envelope files remain authoritative.
 */
export class ArtifactIndex {
  private db: Database | null = null;

  constructor(private readonly artifactsRoot: string) {}

  private open(): Database {
    if (this.db) return this.db;
    makeDir(this.artifactsRoot, { recursive: true });
    this.db = new Database(dbPath(this.artifactsRoot), { create: true });
    applyArtifactIndexPragmas(this.db);
    this.db.exec(CREATE_TABLES_SQL);
    this.ensureSchemaVersion();
    return this.db;
  }

  private ensureSchemaVersion(): void {
    const db = this.db!;
    const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
      value: string;
    } | null;
    if (!row) {
      db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
        "schema_version",
        String(SCHEMA_VERSION)
      );
      return;
    }
    const stored = Number(row.value);
    if (stored !== SCHEMA_VERSION) {
      // Future migrations go here. For now, rebuild if schema differs.
      db.exec("DELETE FROM artifacts");
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(
        String(SCHEMA_VERSION)
      );
    }
  }

  /** Index or re-index a single envelope. */
  indexEnvelope(
    envelope: ArtifactEnvelope,
    relativePath: string,
    absolutePath: string,
    contentHash?: string
  ): void {
    const db = this.open();
    const metadata = envelope.metadata;
    const savedAtMs = isoToMs(envelope.savedAt) ?? Date.now();
    const status = normalizeStatus(envelope.payload);
    const hash = contentHash ?? computeArtifactContentHash(envelope.payload);

    const stmt = db.prepare(
      `INSERT INTO artifacts (
        gate, path, relative_path, saved_at, saved_at_ms, size, result_size,
        status, session_id, workspace_id, pane_id, agent_id, run_id, parent_run_id,
        content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        saved_at=excluded.saved_at,
        saved_at_ms=excluded.saved_at_ms,
        size=excluded.size,
        result_size=excluded.result_size,
        status=excluded.status,
        session_id=excluded.session_id,
        workspace_id=excluded.workspace_id,
        pane_id=excluded.pane_id,
        agent_id=excluded.agent_id,
        run_id=excluded.run_id,
        parent_run_id=excluded.parent_run_id,
        content_hash=excluded.content_hash,
        metadata_json=excluded.metadata_json`
    );

    stmt.run(
      envelope.gate,
      absolutePath,
      relativePath,
      envelope.savedAt,
      savedAtMs,
      envelope.size,
      metadata?.resultSize ?? null,
      status ?? null,
      metadata?.sessionId ?? null,
      metadata?.workspaceId ?? null,
      metadata?.paneId ?? null,
      metadata?.agentId ?? null,
      metadata?.runId ?? null,
      metadata?.parentRunId ?? null,
      hash,
      JSON.stringify(metadata ?? {})
    );
  }

  /** Remove an index row when its file is deleted. */
  removeByPath(absolutePath: string): void {
    const db = this.open();
    db.prepare("DELETE FROM artifacts WHERE path = ?").run(absolutePath);
  }

  /** Lookup a single artifact by project-relative path. */
  findByRelativePath(relativePath: string): ArtifactIndexRow | null {
    const db = this.open();
    const row = db
      .query("SELECT * FROM artifacts WHERE relative_path = ?")
      .get(relativePath) as Record<string, unknown> | null;
    return row ? rowToIndexRow(row) : null;
  }

  /** All artifacts for a run id (indexed query path). */
  findByRunId(runId: string, opts: { order?: "asc" | "desc" } = {}): ArtifactIndexRow[] {
    return this.find({ runIds: [runId], order: opts.order ?? "asc" });
  }

  /** Session-scoped artifacts, newest first by default. */
  findBySession(
    sessionId: string,
    opts: { since?: string; limit?: number; order?: "asc" | "desc" } = {}
  ): ArtifactIndexRow[] {
    return this.find({
      sessionIds: [sessionId],
      ...(opts.since ? { since: opts.since } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      order: opts.order ?? "desc",
    });
  }

  /** Query artifacts with composite filters and parsed `metadata_json` blobs. */
  findMetadataCollection(query: ArtifactIndexQuery = {}): ArtifactMetadataCollectionEntry[] {
    const rows = this.queryArtifactRows(query);
    return rows.map((row) => {
      let metadata: Record<string, unknown> = {};
      if (row.metadata_json != null) {
        try {
          const parsed = JSON.parse(String(row.metadata_json)) as unknown;
          if (parsed && typeof parsed === "object") metadata = parsed as Record<string, unknown>;
        } catch {
          metadata = {};
        }
      }
      return { ...rowToIndexRow(row), metadata };
    });
  }

  /** Query artifacts with composite filters. */
  find(query: ArtifactIndexQuery = {}): ArtifactIndexRow[] {
    return this.queryArtifactRows(query).map(rowToIndexRow);
  }

  private queryArtifactRows(query: ArtifactIndexQuery = {}): Array<Record<string, unknown>> {
    const db = this.open();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    const inClause = (column: string, values: string[] | undefined): void => {
      if (!values || values.length === 0) return;
      const placeholders = values.map(() => "?").join(",");
      conditions.push(`${column} IN (${placeholders})`);
      params.push(...values);
    };

    if (query.gates && query.gates.length > 0) {
      inClause("gate", query.gates);
    }
    inClause("session_id", query.sessionIds);
    inClause("workspace_id", query.workspaceIds);
    inClause("pane_id", query.paneIds);
    inClause("agent_id", query.agentIds);
    inClause("run_id", query.runIds);
    inClause("parent_run_id", query.parentRunIds);
    inClause("status", query.statuses);

    if (query.since) {
      const ms = isoToMs(query.since);
      if (ms !== null) {
        conditions.push("saved_at_ms >= ?");
        params.push(ms);
      }
    }
    if (query.until) {
      const ms = isoToMs(query.until);
      if (ms !== null) {
        conditions.push("saved_at_ms <= ?");
        params.push(ms);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = query.order === "asc" ? "ASC" : "DESC";
    const limit =
      query.limit !== undefined && Number.isFinite(query.limit) && query.limit > 0
        ? Math.floor(query.limit)
        : undefined;
    const offset =
      query.offset !== undefined && Number.isFinite(query.offset) && query.offset > 0
        ? Math.floor(query.offset)
        : undefined;

    let sql = `SELECT * FROM artifacts ${where} ORDER BY saved_at_ms ${order}`;
    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    if (offset !== undefined) {
      sql += " OFFSET ?";
      params.push(offset);
    }

    return db.query(sql).all(...(params as never)) as Array<Record<string, unknown>>;
  }

  /** Distinct identity values across indexed artifacts. */
  distinct(): ArtifactIndexDistinct {
    const db = this.open();
    const column = (_name: keyof ArtifactIndexDistinct, dbColumn: string): string[] => {
      const rows = db
        .query(
          `SELECT DISTINCT ${dbColumn} AS value FROM artifacts WHERE ${dbColumn} IS NOT NULL ORDER BY ${dbColumn}`
        )
        .all() as Array<{ value: string }>;
      return rows.map((r) => r.value);
    };
    return {
      sessionIds: column("sessionIds", "session_id"),
      workspaceIds: column("workspaceIds", "workspace_id"),
      paneIds: column("paneIds", "pane_id"),
      agentIds: column("agentIds", "agent_id"),
      runIds: column("runIds", "run_id"),
      parentRunIds: column("parentRunIds", "parent_run_id"),
      statuses: column("statuses", "status"),
    };
  }

  /** Distinct gate names. */
  listGates(): string[] {
    const db = this.open();
    const rows = db.query("SELECT DISTINCT gate FROM artifacts ORDER BY gate").all() as Array<{
      gate: string;
    }>;
    return rows.map((r) => r.gate);
  }

  /** Count artifacts per gate matching optional filters. */
  countByGate(query: Omit<ArtifactIndexQuery, "gates" | "order" | "offset"> = {}): Array<{
    gate: string;
    count: number;
    latestMs: number;
  }> {
    const db = this.open();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    const inClause = (column: string, values: string[] | undefined): void => {
      if (!values || values.length === 0) return;
      const placeholders = values.map(() => "?").join(",");
      conditions.push(`${column} IN (${placeholders})`);
      params.push(...values);
    };

    inClause("session_id", query.sessionIds);
    inClause("workspace_id", query.workspaceIds);
    inClause("pane_id", query.paneIds);
    inClause("agent_id", query.agentIds);
    inClause("run_id", query.runIds);
    inClause("parent_run_id", query.parentRunIds);
    inClause("status", query.statuses);

    if (query.since) {
      const ms = isoToMs(query.since);
      if (ms !== null) {
        conditions.push("saved_at_ms >= ?");
        params.push(ms);
      }
    }
    if (query.until) {
      const ms = isoToMs(query.until);
      if (ms !== null) {
        conditions.push("saved_at_ms <= ?");
        params.push(ms);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .query(
        `SELECT gate, COUNT(*) AS count, MAX(saved_at_ms) AS latest_ms FROM artifacts ${where} GROUP BY gate ORDER BY gate`
      )
      .all(...(params as never)) as Array<{ gate: string; count: number; latest_ms: number }>;
    return rows.map((r) => ({ gate: r.gate, count: r.count, latestMs: r.latest_ms }));
  }

  /** Rebuild the index by scanning the filesystem. Returns number of indexed artifacts. */
  async rebuild(
    readEntry: (
      gateRelativePath: string,
      absolutePath: string
    ) => Promise<{ envelope: ArtifactEnvelope; relativePath: string } | null>
  ): Promise<number> {
    const db = this.open();
    db.exec("DELETE FROM artifacts");

    let indexed = 0;
    const root = this.artifactsRoot;
    if (!pathExists(root)) return 0;

    const gateEntries = listDir(root, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name !== "runs"
    );

    for (const gateEntry of gateEntries) {
      const gate = gateEntry.name;
      const gateDir = join(root, gate);
      for (const name of listDir(gateDir).filter((n) => n.endsWith(".json"))) {
        const absolutePath = join(gateDir, name);
        const gateRelativePath = join(gate, name);
        const entry = await readEntry(gateRelativePath, absolutePath);
        if (!entry) continue;
        this.indexEnvelope(entry.envelope, entry.relativePath, absolutePath);
        indexed++;
      }
    }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      "indexed_at",
      new Date().toISOString()
    );
    return indexed;
  }

  /** True when the index file exists and appears initialized. */
  exists(): boolean {
    return pathExists(dbPath(this.artifactsRoot));
  }

  /** Close the SQLite connection (mainly for tests). */
  close(): void {
    this.db?.close();
    this.db = null;
  }

  /** Remove the index database file (mainly for tests). */
  reset(): void {
    this.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = `${dbPath(this.artifactsRoot)}${suffix}`;
      if (pathExists(path)) {
        removePath(path, { force: true });
      }
    }
  }

  /** Summary statistics. */
  stats(): ArtifactIndexStats {
    const db = this.open();
    const total = db.query("SELECT COUNT(*) AS c FROM artifacts").get() as { c: number };
    const gates = db.query("SELECT COUNT(DISTINCT gate) AS c FROM artifacts").get() as {
      c: number;
    };
    const metaRow = db.query("SELECT value FROM meta WHERE key = 'indexed_at'").get() as {
      value: string;
    } | null;
    return {
      totalArtifacts: total.c,
      gates: gates.c,
      indexedAt: metaRow?.value ?? new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };
  }
}
