/**
 * Canonical SQLite schema + TypeScript types for ~/.kimi-code/var/sessions.db
 */

// ── TypeScript types ──────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  project: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  lastCmd: string;
  cmdHistory: string[];
  envSnapshot: Record<string, string>;
  gitHead: string;
  lockfileHash: string;
  contextSize: number;
  keyDecisions: string[];
  status: "active" | "closed" | "stale";
}

export interface KnowledgeNode {
  id: string;
  label: string;
  type: "concept" | "file" | "dependency" | "decision" | "project";
  project: string;
  createdAt: string;
  metadata?: string;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

export interface ImpactResult {
  project: string;
  affectedNodes: KnowledgeNode[];
  affectedProjects: string[];
  riskScore: number;
}

// ── SQL schema ────────────────────────────────────────────────────────

export const SESSIONS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    cwd TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    last_cmd TEXT DEFAULT '',
    cmd_history TEXT DEFAULT '[]',
    env_snapshot TEXT DEFAULT '{}',
    git_head TEXT DEFAULT '',
    lockfile_hash TEXT DEFAULT '',
    context_size INTEGER DEFAULT 0,
    key_decisions TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

  CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    project TEXT NOT NULL,
    created_at TEXT NOT NULL,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_nodes_project ON knowledge_nodes(project);
  CREATE INDEX IF NOT EXISTS idx_nodes_type ON knowledge_nodes(type);
  CREATE INDEX IF NOT EXISTS idx_nodes_label ON knowledge_nodes(label);

  CREATE TABLE IF NOT EXISTS knowledge_edges (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    PRIMARY KEY (from_id, to_id, relation)
  );
  CREATE INDEX IF NOT EXISTS idx_edges_from ON knowledge_edges(from_id);
  CREATE INDEX IF NOT EXISTS idx_edges_to ON knowledge_edges(to_id);

  CREATE TABLE IF NOT EXISTS doctor_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    tool TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    r_score REAL,
    git_head TEXT,
    project TEXT NOT NULL,
    session_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_doctor_runs_project ON doctor_runs(project);
  CREATE INDEX IF NOT EXISTS idx_doctor_runs_tool ON doctor_runs(tool);
  CREATE INDEX IF NOT EXISTS idx_doctor_runs_timestamp ON doctor_runs(timestamp);

  CREATE TABLE IF NOT EXISTS warning_trends (
    check_name TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    resolved_at INTEGER,
    taxonomy_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_warning_trends_tool ON warning_trends(tool);
  CREATE INDEX IF NOT EXISTS idx_warning_trends_resolved ON warning_trends(resolved_at);
`;
