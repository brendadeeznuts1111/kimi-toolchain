#!/usr/bin/env bun
/**
 * kimi-debug — "What broke?" wizard
 * Analyzes recent session activity + git history to suggest root cause
 *
 * Usage:
 *   kimi-debug [last|diff|trace|analyze|doctor|fix]
 */

import { $ } from "bun";
import { listDir, makeDir, pathExists, pathStat } from "../lib/bun-io.ts";
import { join } from "path";
import { homeDir, toolsDir } from "../lib/paths.ts";
import { resolveProjectRoot, safeParse } from "../lib/utils.ts";

import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { gitStatus, gitDiff, gitLastCommitMessage } from "../lib/git-helpers.ts";
import { createLogger } from "../lib/logger.ts";

import {
  buildClassifiedFailure,
  classifyFailure,
  getSuggestions,
  loadTaxonomy,
  taxonomyPath,
  type ClassifiedFailure,
} from "../lib/error-taxonomy.ts";

const logger = createLogger(Bun.argv, "kimi-debug");

const decoder = new TextDecoder();

interface GitChange {
  file: string;
  status: string;
  insertions: number;
  deletions: number;
}

interface SessionEvent {
  time: string;
  type: "command" | "error" | "file_change";
  detail: string;
}

// ── Config ───────────────────────────────────────────────────────────

import { varDir, wizardDir } from "../lib/paths.ts";

const MEMORY_DB = join(varDir(), "sessions.db");
const WIZARD_DIR = wizardDir();

// ── Git Analysis ─────────────────────────────────────────────────────

async function getRecentChanges(projectDir: string, commits = 5): Promise<GitChange[]> {
  const raw = await gitDiff(projectDir, [`HEAD~${commits}..HEAD`, "--stat"]);
  if (!raw) return [];

  const lines = raw.split("\n");
  const changes: GitChange[] = [];

  for (const line of lines) {
    const match = line.match(/^(.+?)\s+\|\s+(\d+)\s+([+-]+)$/);
    if (match) {
      const [, file, _count, signs] = match;
      if (!file || !signs) continue;
      const insertions = (signs.match(/\+/g) || []).length;
      const deletions = (signs.match(/-/g) || []).length;
      changes.push({ file: file.trim(), status: "M", insertions, deletions });
    }
  }

  return changes;
}

async function getWorkingTreeChanges(projectDir: string): Promise<GitChange[]> {
  const raw = await gitStatus(projectDir);
  if (!raw) return [];

  const lines = raw.split("\n");
  const changes: GitChange[] = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    const status = line.slice(0, 2).trim();
    const file = line.slice(3).trim();
    changes.push({ file, status, insertions: 0, deletions: 0 });
  }

  return changes;
}

async function getLastCommitMessage(projectDir: string): Promise<string> {
  return gitLastCommitMessage(projectDir);
}

// ── Wire Log Discovery ───────────────────────────────────────────────

/** Find the most recent wire.jsonl across all sessions. */
function findLatestWireLog(home: string = homeDir()): string | null {
  const sessionsDir = join(home, ".kimi-code", "sessions");
  if (!pathExists(sessionsDir)) return null;

  let latestWire: string | null = null;
  let latestMtime = 0;

  for (const workspace of listDir(sessionsDir, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const workspacePath = join(sessionsDir, workspace.name);
    for (const session of listDir(workspacePath, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      const wirePath = join(workspacePath, session.name, "agents", "main", "wire.jsonl");
      if (!pathExists(wirePath)) continue;
      const mtime = pathStat(wirePath).mtimeMs;
      if (mtime > latestMtime) {
        latestMtime = mtime;
        latestWire = wirePath;
      }
    }
  }
  return latestWire;
}

async function analyzeError(
  errorText: string
): Promise<Array<{ suggestion: string; autoFix?: string; categoryId?: string }>> {
  const taxonomy = await loadTaxonomy();
  const suggestions = getSuggestions(errorText, taxonomy);
  if (suggestions.length === 0) {
    return [{ suggestion: "No known pattern matched — check logs manually" }];
  }
  return suggestions.map((s) => ({
    suggestion: s.suggestion,
    autoFix: s.autoFix,
    categoryId: s.categoryId,
  }));
}

// ── Session History (from memory DB if available) ────────────────────

async function getRecentSessions(project: string, limit = 5): Promise<SessionEvent[]> {
  if (!pathExists(MEMORY_DB)) return [];

  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(MEMORY_DB);
    const rows = db
      .query(
        "SELECT started_at, key_decisions FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?"
      )
      .all(project, limit) as any[];
    db.close();

    return rows.map((r) => ({
      time: r.started_at,
      type: "command" as const,
      detail: r.key_decisions || "session",
    }));
  } catch {
    return [];
  }
}

// ── Failure Recording ────────────────────────────────────────────────

async function recordFailure(project: string, errorText: string, suggestions: string[]) {
  try {
    const { Database } = await import("bun:sqlite");
    if (!pathExists(WIZARD_DIR)) {
      makeDir(WIZARD_DIR, { recursive: true });
    }
    const db = new Database(join(WIZARD_DIR, "failures.sqlite"), { create: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS failures (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        error_pattern TEXT,
        suggestions TEXT,
        resolved INTEGER DEFAULT 0
      );
    `);
    db.run(
      "INSERT INTO failures (id, project, timestamp, error_pattern, suggestions) VALUES (?, ?, ?, ?, ?)",
      [
        crypto.randomUUID(),
        project,
        new Date().toISOString(),
        errorText.slice(0, 200),
        JSON.stringify(suggestions),
      ]
    );
    db.close();
  } catch {
    // Silent fail — recording is best-effort
  }
}

// ── Trace File History ───────────────────────────────────────────────

async function traceFile(projectDir: string, filePath: string) {
  const result = await $`git log --oneline -- ${filePath}`.cwd(projectDir).nothrow().quiet();
  const lines = result.stdout.toString().split("\n").filter(Boolean);

  logger.section(`Trace: ${filePath}`);
  if (lines.length === 0) {
    logger.info("No git history for this file (untracked or new)");
    return;
  }

  logger.info(`${lines.length} commits touching this file:`);
  for (const line of lines.slice(0, 10)) {
    logger.line(`    ${line}`);
  }
  if (lines.length > 10) {
    logger.line(`    ... and ${lines.length - 10} more`);
  }

  const diffResult = await $`git diff HEAD~1 -- ${filePath}`.cwd(projectDir).nothrow().quiet();
  const diff = diffResult.stdout.toString();
  if (diff) {
    logger.info("Last change:");
    const diffLines = diff.split("\n").slice(0, 20);
    for (const line of diffLines) {
      const prefix = line.startsWith("+") ? "  + " : line.startsWith("-") ? "  - " : "    ";
      logger.line(prefix + line.slice(1).slice(0, 100));
    }
    if (diff.split("\n").length > 20) {
      logger.line("    ... (truncated)");
    }
  }
}

// ── Error Taxonomy ───────────────────────────────────────────────────

async function printTaxonomy() {
  const taxonomy = await loadTaxonomy();
  logger.section(`Error Taxonomy (v${taxonomy.version})`);
  logger.info(`Loaded from: ${taxonomyPath()}`);
  for (const category of taxonomy.categories) {
    const expectedTag = category.expected ? " [expected]" : "";
    logger.info(`${category.severity.toUpperCase()} ${category.id}${expectedTag}`);
    logger.info(`  ${category.name}`);
    logger.info(`  ${category.description}`);
    if (category.patterns.length > 0) {
      logger.info(`  patterns: ${category.patterns.length}`);
    }
  }
}

async function analyzeWithTaxonomy(errorText: string) {
  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(errorText, taxonomy);
  logger.section("Taxonomy Analysis");
  logger.info(`Category: ${match.category.name} (${match.category.id})`);
  logger.info(`Severity: ${match.category.severity}`);
  logger.info(`Expected: ${match.category.expected ? "yes" : "no"}`);
  if (match.matchedPattern) {
    logger.info(`Pattern:  ${match.matchedPattern}`);
  }
}

interface WireEvent {
  type?: string;
  event?: {
    type?: string;
    toolCallId?: string;
    result?: {
      output?: string;
      isError?: boolean;
    };
  };
}

async function parseWireLog(wirePath: string): Promise<number> {
  if (!pathExists(wirePath)) {
    logger.error(`Wire log not found: ${wirePath}`);
    return 1;
  }

  const taxonomy = await loadTaxonomy();
  const text = await Bun.file(wirePath).text();
  const lines = text.split("\n").filter((l) => l.trim());

  const failures: ClassifiedFailure[] = [];
  let totalErrors = 0;

  for (const line of lines) {
    let event: WireEvent | null = null;
    event = safeParse(line, null as WireEvent | null);
    if (!event) continue;
    if (event?.type !== "context.append_loop_event") continue;
    if (event.event?.type !== "tool.result") continue;
    if (!event.event.result?.isError) continue;

    totalErrors++;
    const output = event.event.result.output || "";
    const toolName = "unknown";
    const match = classifyFailure(output, taxonomy);
    failures.push(buildClassifiedFailure(toolName, output, match));
  }

  logger.section("Wire Log Analysis");
  logger.info(`File:         ${wirePath}`);
  logger.info(`Error events: ${totalErrors}`);
  logger.info(`Classified:   ${failures.length}`);

  const byCategory = new Map<string, { count: number; severity: string; expected: boolean }>();
  for (const f of failures) {
    const existing = byCategory.get(f.categoryId);
    if (existing) {
      existing.count++;
    } else {
      byCategory.set(f.categoryId, {
        count: 1,
        severity: f.severity,
        expected: f.expected,
      });
    }
  }

  if (byCategory.size === 0) {
    logger.info("No isError=true tool results found.");
    return 0;
  }

  logger.info("By category:");
  for (const [id, { count, severity, expected }] of byCategory.entries()) {
    const tag = expected ? " [expected]" : "";
    logger.line(`    ${severity.toUpperCase()} ${id}: ${count}${tag}`);
  }

  logger.info("Recent unclassified failures (if any):");
  let unclassified = 0;
  for (const f of failures.slice(-5)) {
    if (f.categoryId === "unknown") {
      unclassified++;
      const preview = f.output.replace(/\n/g, " ").slice(0, 100);
      logger.line(`    ${preview}${f.output.length > 100 ? "..." : ""}`);
    }
  }
  if (unclassified === 0) {
    logger.info("(none)");
  }
  return 0;
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(projectDir: string) {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  // Git repo check
  const hasGit = pathExists(join(projectDir, ".git"));
  checks.push({
    name: "git-repo",
    status: hasGit ? "ok" : "warn",
    message: hasGit ? "Git repository found" : "Not a git repository",
    fixable: false,
  });

  // Memory DB check
  checks.push({
    name: "memory-db",
    status: pathExists(MEMORY_DB) ? "ok" : "warn",
    message: pathExists(MEMORY_DB) ? "Accessible" : "Not found — sessions won't be recorded",
    fixable: false,
  });

  // Error taxonomy coverage
  const taxonomy = await loadTaxonomy();
  checks.push({
    name: "taxonomy",
    status: "ok",
    message: `${taxonomy.categories.length} taxonomy categories loaded (v${taxonomy.version})`,
    fixable: false,
  });

  // Guardian integration
  const guardianPath = join(toolsDir(), "kimi-guardian.ts");
  checks.push({
    name: "guardian",
    status: pathExists(guardianPath) ? "ok" : "warn",
    message: pathExists(guardianPath)
      ? "Available"
      : "Not found — lockfile issues won't be detected",
    fixable: false,
  });

  logger.runDoctor("kimi-debug", checks);
}

// ── Fix ──────────────────────────────────────────────────────────────

async function fixError(projectDir: string, errorText: string) {
  const results = await analyzeError(errorText);
  logger.section("Auto-Fix Analysis");

  let fixable = 0;
  for (const r of results) {
    if (r.categoryId) {
      logger.suggest(r.categoryId, r.suggestion, r.autoFix);
    } else {
      logger.info(r.suggestion);
    }
    if (r.autoFix) fixable++;
  }

  if (fixable > 0) {
    logger.info("Run the suggested commands manually. For lockfile issues, use: kimi-guardian fix");
  }

  // Record for pattern matching
  await recordFailure(
    getDirName(projectDir),
    errorText,
    results.map((r) => r.suggestion)
  );
}

function getDirName(projectDir: string): string {
  return projectDir.split("/").pop() || "unknown";
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "last";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = getDirName(projectDir);

  logger.banner('Kimi Debug — "What Broke?" Wizard', projectDir);

  if (command === "last") {
    logger.section("Recent Activity");

    const lastCommit = await getLastCommitMessage(projectDir);
    logger.info(`Last commit: ${lastCommit}`);

    const recent = await getRecentChanges(projectDir, 3);
    if (recent.length > 0) {
      logger.info(`Files changed in last 3 commits (${recent.length} files):`);
      for (const c of recent.slice(0, 10)) {
        logger.line(`    ${c.file} (+${c.insertions}/-${c.deletions})`);
      }
    }

    const working = await getWorkingTreeChanges(projectDir);
    if (working.length > 0) {
      logger.info(`Uncommitted changes (${working.length} files):`);
      for (const c of working.slice(0, 10)) {
        logger.line(`    [${c.status}] ${c.file}`);
      }
    }

    const sessions = await getRecentSessions(project, 3);
    if (sessions.length > 0) {
      logger.info("Recent sessions:");
      for (const s of sessions) {
        logger.line(`    ${s.time.slice(0, 19)} — ${s.detail.slice(0, 60)}`);
      }
    }

    if (recent.length > 0) {
      const mostChanged = recent.reduce((a, b) =>
        a.insertions + a.deletions > b.insertions + b.deletions ? a : b
      );
      logger.section("Suggestion");
      logger.info(`Most changed file: ${mostChanged.file}`);
      logger.info("If something broke recently, check this file first.");
      logger.info(`Run: kimi-debug trace ${mostChanged.file}`);
    }
  } else if (command === "diff") {
    const commits = parseInt(args[1] ?? "", 10) || 3;
    logger.section(`Diff Summary (last ${commits} commits)`);

    const changes = await getRecentChanges(projectDir, commits);
    if (changes.length === 0) {
      logger.info("No changes found");
      return 0;
    }

    const byExt = new Map<string, GitChange[]>();
    for (const c of changes) {
      const ext = c.file.split(".").pop() || "no-ext";
      byExt.set(ext, [...(byExt.get(ext) || []), c]);
    }

    logger.info(`Total files: ${changes.length}`);
    logger.info("By type:");
    for (const [ext, files] of byExt.entries()) {
      const totalLines = files.reduce((s, f) => s + f.insertions + f.deletions, 0);
      logger.line(`    .${ext}: ${files.length} files, ${totalLines} lines changed`);
    }

    const highRisk = changes.filter((c) => c.insertions + c.deletions > 50);
    if (highRisk.length > 0) {
      logger.warn("High-risk changes (>50 lines):");
      for (const c of highRisk) {
        logger.line(`    ⚠ ${c.file} (+${c.insertions}/-${c.deletions})`);
      }
    }
  } else if (command === "trace") {
    const filePath = args[1];
    if (!filePath) {
      logger.error("Usage: kimi-debug trace <file-path>");
      return 1;
    }
    await traceFile(projectDir, filePath);
  } else if (command === "analyze") {
    let errorText = args.slice(1).join(" ") || "";

    // Check stdin for piped input
    if (!errorText && !process.stdin.isTTY) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of Bun.stdin.stream()) {
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      errorText = decoder.decode(combined);
    }

    if (!errorText.trim()) {
      logger.error("Usage: kimi-debug analyze <error-message-or-log-snippet>");
      logger.info("Or pipe: cat error.log | kimi-debug analyze");
      return 1;
    }

    logger.section("Error Analysis");
    const results = await analyzeError(errorText);
    for (const r of results) {
      if (r.categoryId) {
        logger.suggest(r.categoryId, r.suggestion, r.autoFix);
      } else {
        logger.info(r.suggestion);
      }
    }

    // Check if any recent file matches error context
    const recent = await getRecentChanges(projectDir, 5);
    const errorFiles = errorText.match(/[\w-/.]+\.(ts|js|tsx|jsx|json|toml)/g) || [];
    if (errorFiles.length > 0) {
      logger.info("Files mentioned in error:");
      for (const f of new Set(errorFiles)) {
        const changed = recent.some((r) => r.file.includes(f));
        logger.line(`    ${changed ? "⚠" : "  "} ${f}${changed ? " (recently changed)" : ""}`);
      }
    }

    // Record failure for future pattern matching
    await recordFailure(
      project,
      errorText,
      results.map((r) => r.suggestion)
    );
    logger.info("Recorded failure for similarity matching");

    if (errorText.includes("lockfile") || errorText.includes("bun.lock")) {
      logger.info("Lockfile-related error detected. Run: kimi-guardian check");
    }
  } else if (command === "doctor") {
    await doctor(projectDir);
  } else if (command === "fix") {
    const errorText = args.slice(1).join(" ") || "";
    if (!errorText) {
      logger.error("Usage: kimi-debug fix <error-text>");
      logger.info("Analyzes error and suggests auto-fixes");
      return 1;
    }
    await fixError(projectDir, errorText);
  } else if (command === "taxonomy") {
    await printTaxonomy();
  } else if (command === "classify") {
    const errorText = args.slice(1).join(" ") || "";
    if (!errorText) {
      logger.error("Usage: kimi-debug classify <error-text>");
      logger.info("Classify error text against taxonomy");
      return 1;
    }
    await analyzeWithTaxonomy(errorText);
  } else if (command === "wire") {
    const wirePath = args[1] || findLatestWireLog();
    if (!wirePath) {
      logger.error("No wire.jsonl found — specify a path or ensure a Kimi Code session exists.");
      return 1;
    }
    return await parseWireLog(wirePath);
  } else {
    logger.section("Commands");
    logger.line("  last                    Show recent activity + heuristic suggestion");
    logger.line("  diff [N]                Summarize last N commits of changes");
    logger.line("  trace <file>            Show git history + last diff for a file");
    logger.line("  analyze <error-text>    Analyze error message for known patterns");
    logger.line("  classify <error-text>   Classify error text against taxonomy");
    logger.line("  taxonomy                List error taxonomy categories");
    logger.line("  wire [path]             Analyze a Kimi Code wire.jsonl for failures");
    logger.line("  doctor                  Check debug wizard health");
    logger.line("  fix <error-text>        Suggest auto-fixes for error");
  }

  return 0;
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-debug", logger }
  );
  process.exit(exitCode);
}
