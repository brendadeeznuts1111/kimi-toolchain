#!/usr/bin/env bun
/**
 * kimi-memory — SQLite WAL session store + knowledge graph + cross-project impact
 * v2.0: Session auto-save/resume, cross-project linking, impact analysis
 *
 * Usage:
 *   kimi-memory [store|recall|resume|link|graph|impact|search|prune|stats|autosave|doctor|fix]
 *
 * Import:
 *   import { saveSession, resumeSession, addKnowledgeEdge, getImpactGraph } from "../lib/memory-sessions.ts";
 */

import { randomUUIDv7 } from "bun";
import { createLogger } from "../lib/logger.ts";
import {
  getProjectName,
  resolveProjectRoot,
  buildDoctorReport,
  printDoctorReport,
} from "../lib/utils.ts";
import { recordDoctorRun, getPersistentWarnings } from "../lib/doctor-runs.ts";
import type { DoctorWarning } from "../lib/doctor-runs.ts";

const trendsLogger = createLogger(Bun.argv, "kimi-memory");

export { recordDoctorRun, getPersistentWarnings };

import {
  saveSession,
  recallSessions,
  resumeSession,
  addNode,
  addEdge,
  getGraph,
  getImpactGraph,
  searchNodes,
  pruneOldSessions,
  getStats,
  startAutoSave,
  stopAutoSave,
  getActiveSession,
  getWarningHistory,
  type SessionRecord,
  type KnowledgeNode,
  type KnowledgeEdge,
  type ImpactResult,
} from "../lib/memory-sessions.ts";

export {
  saveSession,
  recallSessions,
  resumeSession,
  addNode,
  addEdge,
  getGraph,
  getImpactGraph,
  searchNodes,
  pruneOldSessions,
  getStats,
  startAutoSave,
  stopAutoSave,
  getActiveSession,
  getWarningHistory,
  type SessionRecord,
  type KnowledgeNode,
  type KnowledgeEdge,
  type ImpactResult,
};

// ── Doctor ───────────────────────────────────────────────────────────

import { getDb } from "../lib/memory-sessions.ts";
import { varDir } from "../lib/paths.ts";
import { join } from "path";
import { existsSync } from "fs";

const DB_PATH = join(varDir(), "sessions.db");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
  let db: import("bun:sqlite").Database;
  try {
    db = getDb();
    checks.push({
      name: "db-access",
      status: "ok",
      message: "Database accessible",
      fixable: false,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "db-access",
      status: "error",
      message: `Cannot open DB: ${msg}`,
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
      .all() as Array<{ from_id: string; to_id: string }>;
    checks.push({
      name: "orphaned-edges",
      status: orphanRows.length === 0 ? "ok" : "warn",
      message: `${orphanRows.length} orphaned edge(s)`,
      fixable: orphanRows.length > 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "orphaned-edges",
      status: "warn",
      message: `Check failed: ${msg}`,
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
      .get(new Date(Date.now() - SESSION_TTL_MS).toISOString()) as { c: number };
    checks.push({
      name: "stuck-sessions",
      status: stuck.c > 0 ? "warn" : "ok",
      message: `${stuck.c} stuck session(s)`,
      fixable: stuck.c > 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "stuck-sessions",
      status: "warn",
      message: `Check failed: ${msg}`,
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
  const project = await getProjectName(projectPath);

  trendsLogger.banner("Kimi Memory — Session Store & Knowledge Graph");

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
      const id = await startAutoSave(projectPath);
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
    trendsLogger.section(`Warning Trends ${toolFilter ? `(${toolFilter})` : "(all tools)"}`);
    if (persistent.length === 0) {
      trendsLogger.info("No persistent warnings — all checks clean");
    } else {
      for (const p of persistent) {
        const age = p.age_days === 0 ? "today" : `${p.age_days}d ago`;
        const freq = p.occurrence_count === 1 ? "1×" : `${p.occurrence_count}×`;
        const label = p.taxonomy_id ? `${p.taxonomy_id} (${p.check_name})` : p.check_name;
        trendsLogger.warn(`${label} [${p.tool}]: ${freq} since ${age}`);
      }
    }
  } else if (command === "doctor") {
    const checks = doctor();
    const report = buildDoctorReport("kimi-memory", checks);
    printDoctorReport(report);

    const warnings: DoctorWarning[] = [];
    for (const c of checks) {
      if (c.status === "warn" || c.status === "error") {
        warnings.push({ check: c.name, message: c.message, severity: c.status });
      }
    }

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

    if (report.fixableCount > 0) {
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
  console.error("kimi-memory failed:", err.message);
  process.exit(1);
});
