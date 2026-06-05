#!/usr/bin/env bun
/**
 * kimi-memory — SQLite WAL session store + knowledge graph + cross-project impact
 * v2.0: Session auto-save/resume, cross-project linking, impact analysis
 *
 * Usage:
 *   kimi-memory [store|recall|resume|link|graph|impact|search|prune|stats|autosave|doctor|fix]
 *
 * Import:
 *   import { saveSession, resumeSession, addKnowledgeEdge, getImpactGraph } from "./kimi-memory.ts";
 */

import { Database } from "bun:sqlite";
import { randomUUIDv7 } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getProjectName, safeParse, resolveProjectRoot } from "../lib/utils.ts";

// ── Config ───────────────────────────────────────────────────────────

const MEMORY_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "memory");
const VAR_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "var");
const DB_PATH = join(VAR_DIR, "sessions.db");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface SessionRecord {
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

interface KnowledgeNode {
  id: string;
  label: string;
  type: "concept" | "file" | "dependency" | "decision" | "project";
  project: string;
  createdAt: string;
  metadata?: string;
}

interface KnowledgeEdge {
  from: string;
  to: string;
  relation: string;
  weight: number;
}

interface ImpactResult {
  project: string;
  affectedNodes: KnowledgeNode[];
  affectedProjects: string[];
  riskScore: number;
}

// ── Database ─────────────────────────────────────────────────────────

function getDb(): Database {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
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
      project TEXT NOT NULL
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
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_warning_trends_tool ON warning_trends(tool);
    CREATE INDEX IF NOT EXISTS idx_warning_trends_resolved ON warning_trends(resolved_at);
  `);
  return db;
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
  let rows;
  if (project) {
    rows = db
      .query("SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?")
      .all(project, limit) as any[];
  } else {
    rows = db.query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?").all(limit) as any[];
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
    .get(project) as any;
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
  const project = getProjectName(projectPath);
  const db = getDb();

  const row = db
    .query("SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT 1")
    .get(project) as any;
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
  const nodes = db.query("SELECT * FROM knowledge_nodes WHERE project = ?").all(project) as any[];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges = db
    .query(
      "SELECT * FROM knowledge_edges WHERE from_id IN (" +
        Array.from(nodeIds)
          .map(() => "?")
          .join(",") +
        ")"
    )
    .all(...Array.from(nodeIds)) as any[];

  db.close();
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      project: n.project,
      createdAt: n.created_at,
      metadata: n.metadata,
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

    const node = db.query("SELECT * FROM knowledge_nodes WHERE id = ?").get(current.id) as any;
    if (node) {
      affectedNodes.push({
        id: node.id,
        label: node.label,
        type: node.type,
        project: node.project,
        createdAt: node.created_at,
        metadata: node.metadata,
      });
      affectedProjects.add(node.project);
    }

    const edges = db
      .query("SELECT * FROM knowledge_edges WHERE from_id = ?")
      .all(current.id) as any[];
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
      .all(project, `%${query}%`) as any[];
  } else {
    rows = db.query("SELECT * FROM knowledge_nodes WHERE label LIKE ?").all(`%${query}%`) as any[];
  }
  db.close();
  return rows.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    project: n.project,
    createdAt: n.created_at,
    metadata: n.metadata,
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

interface DoctorWarning {
  check: string;
  message: string;
  severity: "warn" | "error";
}

export function recordDoctorRun(
  project: string,
  tool: string,
  warnings: DoctorWarning[],
  rScore?: number,
  gitHead?: string
) {
  const db = getDb();
  const now = Date.now();

  // Insert the run
  db.run(
    `INSERT INTO doctor_runs (timestamp, tool, warnings_json, r_score, git_head, project)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [now, tool, JSON.stringify(warnings), rScore ?? null, gitHead ?? null, project]
  );

  // Update warning_trends: increment existing or insert new
  for (const w of warnings) {
    const existing = db
      .query("SELECT occurrence_count FROM warning_trends WHERE check_name = ?")
      .get(w.check) as any;

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

  // Mark resolved: warnings not seen in this run that were previously unresolved
  if (warnings.length > 0) {
    const checkNames = warnings.map((w) => w.check);
    const placeholders = checkNames.map(() => "?").join(",");
    db.run(
      `UPDATE warning_trends SET resolved_at = ?
       WHERE resolved_at IS NULL AND check_name NOT IN (${placeholders})`,
      [now, ...checkNames]
    );
  } else {
    // No warnings at all — mark all unresolved as resolved
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
  const db = getDb();
  let rows;
  if (tool) {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen
       FROM warning_trends
       WHERE resolved_at IS NULL AND tool = ?
       ORDER BY occurrence_count DESC`
      )
      .all(tool) as any[];
  } else {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen
       FROM warning_trends
       WHERE resolved_at IS NULL
       ORDER BY occurrence_count DESC`
      )
      .all() as any[];
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
    .all(`%"check":"${checkName}"%`) as any[];
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
  const sessions = (db.query("SELECT COUNT(*) as c FROM sessions").get() as any).c;
  const active = (
    db.query("SELECT COUNT(*) as c FROM sessions WHERE status = 'active'").get() as any
  ).c;
  const nodes = (db.query("SELECT COUNT(*) as c FROM knowledge_nodes").get() as any).c;
  const edges = (db.query("SELECT COUNT(*) as c FROM knowledge_edges").get() as any).c;
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

let _autoSaveInterval: Timer | null = null;

export function startAutoSave(projectPath: string, intervalMs = 30000) {
  if (_autoSaveInterval) clearInterval(_autoSaveInterval);

  const project = getProjectName(projectPath);
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

// ── Doctor ───────────────────────────────────────────────────────────

function doctor(): Array<{
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  // DB accessibility
  let db: Database | null = null;
  try {
    db = getDb();
    checks.push({
      name: "db-access",
      status: "ok",
      message: "Database accessible",
      fixable: false,
    });
  } catch (e: any) {
    checks.push({
      name: "db-access",
      status: "error",
      message: `Cannot open DB: ${e.message}`,
      fixable: false,
    });
    return checks;
  }

  // Orphaned edges
  try {
    const orphanRows = db
      .query(`
      SELECT e.from_id, e.to_id FROM knowledge_edges e
      LEFT JOIN knowledge_nodes n1 ON e.from_id = n1.id
      LEFT JOIN knowledge_nodes n2 ON e.to_id = n2.id
      WHERE n1.id IS NULL OR n2.id IS NULL
    `)
      .all() as any[];
    checks.push({
      name: "orphaned-edges",
      status: orphanRows.length === 0 ? "ok" : "warn",
      message: `${orphanRows.length} orphaned edge(s)`,
      fixable: orphanRows.length > 0,
    });
  } catch (e: any) {
    checks.push({
      name: "orphaned-edges",
      status: "warn",
      message: `Check failed: ${e.message}`,
      fixable: false,
    });
  }

  // WAL size
  const walPath = DB_PATH + "-wal";
  if (existsSync(walPath)) {
    const walSize = Bun.file(walPath).size;
    const walMB = walSize / 1024 / 1024;
    checks.push({
      name: "wal-size",
      status: walMB > 10 ? "warn" : "ok",
      message: `${walMB.toFixed(1)}MB WAL`,
      fixable: walMB > 10,
    });
  } else {
    checks.push({ name: "wal-size", status: "ok", message: "No WAL file", fixable: false });
  }

  // Stuck active sessions
  try {
    const stuck = db
      .query("SELECT COUNT(*) as c FROM sessions WHERE status = 'active' AND started_at < ?")
      .get(new Date(Date.now() - SESSION_TTL_MS).toISOString()) as any;
    checks.push({
      name: "stuck-sessions",
      status: stuck.c > 0 ? "warn" : "ok",
      message: `${stuck.c} stuck session(s)`,
      fixable: stuck.c > 0,
    });
  } catch (e: any) {
    checks.push({
      name: "stuck-sessions",
      status: "warn",
      message: `Check failed: ${e.message}`,
      fixable: false,
    });
  }

  db.close();
  return checks;
}

// ── Fix ──────────────────────────────────────────────────────────────

function fixDb() {
  const db = getDb();

  // Prune orphaned edges
  const orphanResult = db.run(`
    DELETE FROM knowledge_edges WHERE rowid IN (
      SELECT e.rowid FROM knowledge_edges e
      LEFT JOIN knowledge_nodes n1 ON e.from_id = n1.id
      LEFT JOIN knowledge_nodes n2 ON e.to_id = n2.id
      WHERE n1.id IS NULL OR n2.id IS NULL
    )
  `);
  const orphansDeleted = orphanResult.changes;

  // Reset stuck sessions
  const stuckResult = db.run(
    "UPDATE sessions SET status = 'stale' WHERE status = 'active' AND started_at < ?",
    [new Date(Date.now() - SESSION_TTL_MS).toISOString()]
  );
  const stuckReset = stuckResult.changes;

  // Vacuum to reclaim space
  db.exec("VACUUM;");
  db.close();

  return { orphansDeleted, stuckReset };
}

// ── Main CLI ─────────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "stats";
  const projectPath = await resolveProjectRoot(Bun.cwd);
  const project = getProjectName(projectPath);

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           Kimi Memory — Session Store & Knowledge Graph      ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  if (command === "store") {
    const sessionId = args[1] || randomUUIDv7();
    const decisions = args.slice(2);
    saveSession({
      id: sessionId,
      project,
      cwd: projectPath,
      startedAt: new Date().toISOString(),
      lastCmd: args.join(" "),
      cmdHistory: [args.join(" ")],
      envSnapshot: {},
      gitHead: "",
      lockfileHash: "",
      contextSize: 0,
      keyDecisions: decisions,
    });
    console.log(`  ✓ Stored session: ${sessionId}`);
  } else if (command === "recall") {
    const limit = parseInt(args[1], 10) || 5;
    const sessions = recallSessions(project, limit);
    console.log(`── Recent sessions for ${project} ────────────────────────────`);
    for (const s of sessions) {
      const statusIcon = s.status === "active" ? "●" : s.status === "stale" ? "◌" : "○";
      console.log(
        `  ${statusIcon} ${s.startedAt.slice(0, 19)}  ${s.id.slice(0, 20)}...  decisions: ${s.keyDecisions.length}`
      );
    }
  } else if (command === "resume") {
    console.log(`── Resume Session: ${project} ────────────────────────────────`);
    const { session, stale, changes } = await resumeSession(projectPath);

    if (!session) {
      console.log("  No previous session found");
      return;
    }

    console.log(`  Last session: ${session.startedAt.slice(0, 19)}`);
    console.log(`  Status: ${stale ? "STALE" : "FRESH"}`);

    if (changes.length > 0) {
      for (const c of changes) {
        console.log(`  ⚠ ${c}`);
      }
    } else {
      console.log("  ✓ Context unchanged — safe to resume");
    }

    if (session.keyDecisions.length > 0) {
      console.log("  Key decisions from last session:");
      for (const d of session.keyDecisions) {
        console.log(`    • ${d}`);
      }
    }
  } else if (command === "autosave") {
    const action = args[1] || "start";
    if (action === "start") {
      const id = startAutoSave(projectPath);
      console.log(`  ✓ Auto-save started: ${id} (every 30s)`);
    } else {
      stopAutoSave();
      console.log(`  ✓ Auto-save stopped`);
    }
  } else if (command === "link") {
    const fromNode = args[1];
    const toNode = args[2];
    const relation = args[3] || "depends_on";
    if (!fromNode || !toNode) {
      console.log("Usage: link <from> <to> [relation]");
      process.exit(1);
    }
    addNode({
      id: fromNode,
      label: fromNode,
      type: "dependency",
      project,
      createdAt: new Date().toISOString(),
    });
    addNode({
      id: toNode,
      label: toNode,
      type: "dependency",
      project,
      createdAt: new Date().toISOString(),
    });
    addEdge({ from: fromNode, to: toNode, relation, weight: 1.0 });
    console.log(`  ✓ Linked: ${fromNode} →[${relation}]→ ${toNode}`);
  } else if (command === "graph") {
    const { nodes, edges } = getGraph(project);
    console.log(`── Knowledge Graph: ${project} ───────────────────────────────`);
    console.log(`  Nodes: ${nodes.length}`);
    for (const n of nodes.slice(0, 10)) {
      console.log(`    [${n.type}] ${n.label}`);
    }
    console.log(`  Edges: ${edges.length}`);
    for (const e of edges.slice(0, 10)) {
      console.log(`    ${e.from} →[${e.relation}]→ ${e.to}`);
    }
  } else if (command === "impact") {
    const nodeId = args[1];
    if (!nodeId) {
      console.log("Usage: impact <node-id>");
      console.log("  Shows cross-project impact of changing a node");
      process.exit(1);
    }
    const impact = getImpactGraph(nodeId);
    console.log(`── Impact Analysis: ${nodeId} ────────────────────────────────`);
    console.log(`  Risk score: ${(impact.riskScore * 100).toFixed(0)}%`);
    console.log(`  Affected nodes: ${impact.affectedNodes.length}`);
    console.log(`  Affected projects: ${impact.affectedProjects.join(", ") || "none"}`);
    for (const n of impact.affectedNodes.slice(0, 10)) {
      console.log(`    [${n.project}] ${n.label} (${n.type})`);
    }
  } else if (command === "search") {
    const query = args[1];
    if (!query) {
      console.log("Usage: search <query>");
      process.exit(1);
    }
    const results = searchNodes(query, project);
    console.log(`── Search: '${query}' ────────────────────────────────────────`);
    for (const r of results) {
      console.log(`  [${r.type}] ${r.label} (${r.project})`);
    }
  } else if (command === "prune") {
    const days = parseInt(args[1], 10) || 30;
    const deleted = pruneOldSessions(days);
    console.log(`  ✓ Pruned ${deleted} sessions older than ${days} days`);
  } else if (command === "stats") {
    const stats = getStats();
    console.log("── Memory Stats ──────────────────────────────────────────────");
    console.log(`  Sessions: ${stats.sessions} (${stats.active} active)`);
    console.log(`  Nodes:    ${stats.nodes}`);
    console.log(`  Edges:    ${stats.edges}`);
    console.log(`  DB size:  ${stats.dbSize}`);
  } else if (command === "trends") {
    const toolFilter = args[1];
    const persistent = getPersistentWarnings(toolFilter);
    console.log(
      `── Warning Trends ${toolFilter ? `(${toolFilter})` : "(all tools)"} ─────────────────────────────────────`
    );
    if (persistent.length === 0) {
      console.log("  ✓ No persistent warnings — all checks clean");
    } else {
      for (const p of persistent) {
        const age = p.age_days === 0 ? "today" : `${p.age_days}d ago`;
        const freq = p.occurrence_count === 1 ? "1×" : `${p.occurrence_count}×`;
        console.log(`  ⚠ ${p.check_name} [${p.tool}]: ${freq} since ${age}`);
      }
    }
  } else if (command === "doctor") {
    const checks = doctor();
    console.log("── Memory Doctor ─────────────────────────────────────────────");
    let errors = 0,
      warns = 0,
      fixable = 0;
    const warnings: DoctorWarning[] = [];
    for (const c of checks) {
      const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
      if (c.status === "error") errors++;
      if (c.status === "warn") warns++;
      if (c.fixable) fixable++;
      if (c.status === "warn" || c.status === "error") {
        warnings.push({ check: c.name, message: c.message, severity: c.status });
      }
    }
    console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);

    // Persist to trending
    recordDoctorRun(project, "kimi-memory", warnings);

    // Show persistent warnings
    const persistent = getPersistentWarnings("kimi-memory");
    if (persistent.length > 0) {
      console.log("");
      console.log("  Persistent warnings (kimi-memory):");
      for (const p of persistent) {
        const age = p.age_days === 0 ? "today" : `${p.age_days}d ago`;
        console.log(`    ⚠ ${p.check_name}: ${p.occurrence_count}× since ${age}`);
      }
    }

    if (fixable > 0) {
      console.log("");
      console.log("  Run 'kimi-memory fix' to repair");
    }
  } else if (command === "fix") {
    console.log("── Fixing Memory DB ──────────────────────────────────────────");
    const result = fixDb();
    console.log(`  ✓ Pruned ${result.orphansDeleted} orphaned edges`);
    console.log(`  ✓ Reset ${result.stuckReset} stuck sessions`);
    console.log(`  ✓ Database vacuumed`);
  } else {
    console.log("Commands:");
    console.log("  store <id> [decisions]   Save a session snapshot");
    console.log("  recall [limit]           Show recent sessions");
    console.log("  resume                   Check if last session is stale");
    console.log("  autosave [start|stop]    Auto-save every 30s");
    console.log("  link <from> <to> [rel]   Link knowledge nodes");
    console.log("  graph                    Show project knowledge graph");
    console.log("  impact <node-id>         Cross-project impact analysis");
    console.log("  search <query>           Search knowledge nodes");
    console.log("  prune [days]             Remove old sessions");
    console.log("  doctor                   Check DB health + record warning trends");
    console.log("  fix                      Prune orphans, reset stuck sessions, vacuum");
    console.log("  stats                    Show database stats");
    console.log("  trends [tool]            Show persistent warnings across sessions");
  }
}

main().catch((err) => {
  console.error("Memory failed:", err.message);
  process.exit(1);
});
