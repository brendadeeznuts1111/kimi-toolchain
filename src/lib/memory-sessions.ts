import { Database } from "bun:sqlite";
import { randomUUIDv7 } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getProjectName, safeParse } from "./utils.ts";
import {
  SESSIONS_SCHEMA_SQL,
  type SessionRecord,
  type KnowledgeNode,
  type KnowledgeEdge,
  type ImpactResult,
} from "./sessions-schema.ts";
import { memoryDir, varDir } from "./paths.ts";

const MEMORY_DIR = memoryDir();
const VAR_DIR = varDir();
const DB_PATH = join(VAR_DIR, "sessions.db");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Re-export types for backward compatibility
export type { SessionRecord, KnowledgeNode, KnowledgeEdge, ImpactResult };

// ── Database ─────────────────────────────────────────────────────────

export function getDb(): Database {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(SESSIONS_SCHEMA_SQL);
  return db;
}

interface DbSessionRow {
  id: string;
  project: string;
  cwd: string;
  started_at: string;
  ended_at: string | null;
  last_cmd: string;
  cmd_history: string;
  env_snapshot: string;
  git_head: string;
  lockfile_hash: string;
  context_size: number;
  key_decisions: string;
  status: string;
}

interface DbCountRow {
  c: number;
}

interface DbKnowledgeNodeRow {
  id: string;
  label: string;
  type: string;
  project: string;
  created_at: string;
  metadata: string | null;
}

interface DbKnowledgeEdgeRow {
  from_id: string;
  to_id: string;
  relation: string;
  weight: number;
}

interface DbDoctorRunRow {
  timestamp: number;
  r_score: number | null;
  git_head: string | null;
}

// ── Session Store ────────────────────────────────────────────────────

export function saveSession(
  session: Omit<SessionRecord, "status"> & { status?: SessionRecord["status"] }
) {
  const db = getDb();
  db.run(
    `INSERT OR REPLACE INTO sessions
     (id, project, cwd, started_at, ended_at, last_cmd, cmd_history, env_snapshot, git_head, lockfile_hash, context_size, key_decisions, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.project,
      session.cwd,
      session.startedAt,
      session.endedAt || null,
      session.lastCmd,
      JSON.stringify(session.cmdHistory),
      JSON.stringify(session.envSnapshot),
      session.gitHead,
      session.lockfileHash,
      session.contextSize,
      JSON.stringify(session.keyDecisions),
      session.status || "active",
    ]
  );
  db.close();
}

export function recallSessions(project?: string, limit = 10): SessionRecord[] {
  const db = getDb();
  let rows: DbSessionRow[];
  if (project) {
    rows = db
      .query("SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?")
      .all(project, limit) as DbSessionRow[];
  } else {
    rows = db
      .query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?")
      .all(limit) as DbSessionRow[];
  }
  db.close();
  return rows.map(parseSessionRow);
}

export function getActiveSession(project: string): SessionRecord | null {
  const db = getDb();
  const row = db
    .query(
      "SELECT * FROM sessions WHERE project = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1"
    )
    .get(project) as DbSessionRow | null;
  db.close();
  return row ? parseSessionRow(row) : null;
}

function parseSessionRow(r: any): SessionRecord {
  return {
    id: r.id,
    project: r.project,
    cwd: r.cwd,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    lastCmd: r.last_cmd,
    cmdHistory: safeParse(r.cmd_history || "[]", []),
    envSnapshot: safeParse(r.env_snapshot || "{}", {}),
    gitHead: r.git_head,
    lockfileHash: r.lockfile_hash,
    contextSize: r.context_size,
    keyDecisions: safeParse(r.key_decisions || "[]", []),
    status: r.status,
  };
}

// ── Session Resume ───────────────────────────────────────────────────

export async function resumeSession(
  projectPath: string
): Promise<{ session: SessionRecord | null; stale: boolean; changes: string[] }> {
  const project = await getProjectName(projectPath);
  const db = getDb();

  const row = db
    .query("SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT 1")
    .get(project) as DbSessionRow | null;
  db.close();

  if (!row) {
    return { session: null, stale: false, changes: [] };
  }

  const session = parseSessionRow(row);
  const changes: string[] = [];
  let stale = false;

  const started = new Date(session.startedAt).getTime();
  if (Date.now() - started > SESSION_TTL_MS) {
    stale = true;
    changes.push("Session expired (>24h)");
  }

  try {
    const { $ } = await import("bun");
    const result = await $`git rev-parse HEAD`.cwd(projectPath).nothrow().quiet();
    const currentHead = result.stdout.toString().trim();
    if (currentHead && currentHead !== session.gitHead) {
      stale = true;
      changes.push(
        `Git HEAD changed: ${session.gitHead.slice(0, 8)}... → ${currentHead.slice(0, 8)}...`
      );
    }
  } catch {
    /* ignore */
  }

  try {
    const lockPath = join(projectPath, "bun.lock");
    if (existsSync(lockPath)) {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(await Bun.file(lockPath).text());
      const currentHash = hasher.digest("hex");
      if (currentHash !== session.lockfileHash) {
        stale = true;
        changes.push("Lockfile changed since last session");
      }
    }
  } catch {
    /* ignore */
  }

  return { session, stale, changes };
}

// ── Knowledge Graph ──────────────────────────────────────────────────

export function addNode(node: KnowledgeNode) {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO knowledge_nodes (id, label, type, project, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
    [node.id, node.label, node.type, node.project, node.createdAt, node.metadata || null]
  );
  db.close();
}

export function addEdge(edge: KnowledgeEdge) {
  const db = getDb();
  db.run(
    "INSERT OR REPLACE INTO knowledge_edges (from_id, to_id, relation, weight) VALUES (?, ?, ?, ?)",
    [edge.from, edge.to, edge.relation, edge.weight]
  );
  db.close();
}

export function getGraph(
  project: string,
  _depth = 1
): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const db = getDb();
  const nodes = db
    .query("SELECT * FROM knowledge_nodes WHERE project = ?")
    .all(project) as DbKnowledgeNodeRow[];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges = db
    .query(
      "SELECT * FROM knowledge_edges WHERE from_id IN (" +
        Array.from(nodeIds)
          .map(() => "?")
          .join(",") +
        ")"
    )
    .all(...Array.from(nodeIds)) as DbKnowledgeEdgeRow[];

  db.close();
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type as KnowledgeNode["type"],
      project: n.project,
      createdAt: n.created_at,
      metadata: n.metadata ?? undefined,
    })),
    edges: edges.map((e) => ({
      from: e.from_id,
      to: e.to_id,
      relation: e.relation,
      weight: e.weight,
    })),
  };
}

// ── Cross-Project Impact Analysis ────────────────────────────────────

export function getImpactGraph(nodeId: string, depth = 2): ImpactResult {
  const db = getDb();

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
  const affectedNodes: KnowledgeNode[] = [];
  const affectedProjects = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id) || current.depth > depth) continue;
    visited.add(current.id);

    const node = db
      .query("SELECT * FROM knowledge_nodes WHERE id = ?")
      .get(current.id) as DbKnowledgeNodeRow | null;
    if (node) {
      affectedNodes.push({
        id: node.id,
        label: node.label,
        type: node.type as KnowledgeNode["type"],
        project: node.project,
        createdAt: node.created_at,
        metadata: node.metadata ?? undefined,
      });
      affectedProjects.add(node.project);
    }

    const edges = db
      .query("SELECT * FROM knowledge_edges WHERE from_id = ?")
      .all(current.id) as DbKnowledgeEdgeRow[];
    for (const e of edges) {
      if (!visited.has(e.to_id)) {
        queue.push({ id: e.to_id, depth: current.depth + 1 });
      }
    }
  }

  db.close();

  const riskScore = Math.min(1, affectedNodes.length / 10);

  return {
    project: nodeId,
    affectedNodes,
    affectedProjects: Array.from(affectedProjects),
    riskScore,
  };
}

export function searchNodes(query: string, project?: string): KnowledgeNode[] {
  const db = getDb();
  let rows;
  if (project) {
    rows = db
      .query("SELECT * FROM knowledge_nodes WHERE project = ? AND label LIKE ?")
      .all(project, `%${query}%`) as DbKnowledgeNodeRow[];
  } else {
    rows = db
      .query("SELECT * FROM knowledge_nodes WHERE label LIKE ?")
      .all(`%${query}%`) as DbKnowledgeNodeRow[];
  }
  db.close();
  return rows.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type as KnowledgeNode["type"],
    project: n.project,
    createdAt: n.created_at,
    metadata: n.metadata ?? undefined,
  }));
}

// ── Maintenance ──────────────────────────────────────────────────────

export function pruneOldSessions(days: number): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.run("DELETE FROM sessions WHERE started_at < ?", [cutoff]);
  const deleted = result.changes;
  db.close();
  return deleted;
}

// ── Warning Trending ─────────────────────────────────────────────────

export function getWarningHistory(checkName: string): Array<{
  timestamp: number;
  r_score: number | null;
  git_head: string | null;
}> {
  const db = getDb();
  const rows = db
    .query(
      `SELECT timestamp, r_score, git_head FROM doctor_runs
     WHERE warnings_json LIKE ?
     ORDER BY timestamp DESC`
    )
    .all(`%"check":"${checkName}"%`) as DbDoctorRunRow[];
  db.close();
  return rows.map((r) => ({
    timestamp: r.timestamp,
    r_score: r.r_score,
    git_head: r.git_head,
  }));
}

export function getStats(): {
  sessions: number;
  active: number;
  nodes: number;
  edges: number;
  dbSize: string;
} {
  const db = getDb();
  const sessions = (db.query("SELECT COUNT(*) as c FROM sessions").get() as DbCountRow).c;
  const active = (
    db.query("SELECT COUNT(*) as c FROM sessions WHERE status = 'active'").get() as DbCountRow
  ).c;
  const nodes = (db.query("SELECT COUNT(*) as c FROM knowledge_nodes").get() as DbCountRow).c;
  const edges = (db.query("SELECT COUNT(*) as c FROM knowledge_edges").get() as DbCountRow).c;
  db.close();

  const file = Bun.file(DB_PATH);
  const size = file.size;
  const sizeStr =
    size > 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1)}MB`
      : size > 1024
        ? `${(size / 1024).toFixed(1)}KB`
        : `${size}B`;

  return { sessions, active, nodes, edges, dbSize: sizeStr };
}

// ── Auto-Save Integration ────────────────────────────────────────────

let _autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export async function startAutoSave(projectPath: string, intervalMs = 120000) {
  if (_autoSaveInterval) clearInterval(_autoSaveInterval);

  const project = await getProjectName(projectPath);
  const id = randomUUIDv7();

  _autoSaveInterval = setInterval(async () => {
    const { $ } = await import("bun");
    let gitHead = "";
    let lockfileHash = "";

    try {
      const result = await $`git rev-parse HEAD`.cwd(projectPath).nothrow().quiet();
      gitHead = result.stdout.toString().trim();
    } catch {
      /* ignore */
    }

    try {
      const lockPath = join(projectPath, "bun.lock");
      if (existsSync(lockPath)) {
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(await Bun.file(lockPath).text());
        lockfileHash = hasher.digest("hex");
      }
    } catch {
      /* ignore */
    }

    saveSession({
      id,
      project,
      cwd: projectPath,
      startedAt: new Date().toISOString(),
      lastCmd: Bun.argv.slice(2).join(" ") || "auto-save",
      cmdHistory: [],
      envSnapshot: {},
      gitHead,
      lockfileHash,
      contextSize: 0,
      keyDecisions: [],
      status: "active",
    });
  }, intervalMs);

  return id;
}

export function stopAutoSave() {
  if (_autoSaveInterval) {
    clearInterval(_autoSaveInterval);
    _autoSaveInterval = null;
  }
}
