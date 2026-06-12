#!/usr/bin/env bun
/**
 * kimi-debug — "What broke?" wizard
 * Analyzes recent session activity + git history to suggest root cause
 *
 * Usage:
 *   kimi-debug [last|diff|trace|analyze|doctor|fix]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { resolveProjectRoot } from "../lib/utils.ts";
import {
  buildClassifiedFailure,
  classifyFailure,
  loadTaxonomy,
  taxonomyPath,
  type ClassifiedFailure,
} from "../lib/error-taxonomy.ts";

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

const MEMORY_DB = join(Bun.env.HOME || "/tmp", ".kimi-code", "var", "sessions.db");
const WIZARD_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "wizard");

// ── Git Analysis ─────────────────────────────────────────────────────

async function getRecentChanges(projectDir: string, commits = 5): Promise<GitChange[]> {
  const result = await $`git diff HEAD~${commits}..HEAD --stat`.cwd(projectDir).nothrow().quiet();
  if (result.exitCode !== 0) return [];

  const lines = result.stdout.toString().split("\n");
  const changes: GitChange[] = [];

  for (const line of lines) {
    const match = line.match(/^(.+?)\s+\|\s+(\d+)\s+([+-]+)$/);
    if (match) {
      const [, file, _count, signs] = match;
      const insertions = (signs.match(/\+/g) || []).length;
      const deletions = (signs.match(/-/g) || []).length;
      changes.push({ file: file.trim(), status: "M", insertions, deletions });
    }
  }

  return changes;
}

async function getWorkingTreeChanges(projectDir: string): Promise<GitChange[]> {
  const result = await $`git status --porcelain`.cwd(projectDir).nothrow().quiet();
  if (result.exitCode !== 0) return [];

  const lines = result.stdout.toString().split("\n");
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
  const result = await $`git log -1 --format=%s`.cwd(projectDir).nothrow().quiet();
  return result.stdout.toString().trim();
}

// ── Error Pattern Detection ──────────────────────────────────────────

const ERROR_PATTERNS = [
  {
    pattern: /Cannot find module|Module not found|ENOENT/,
    suggestion: "Missing dependency — run 'bun install'",
    autoFix: "bun install",
  },
  {
    pattern: /SyntaxError|Unexpected token/,
    suggestion: "Syntax error in recently changed file — check the diff",
  },
  {
    pattern: /TypeError.*undefined|Cannot read prop/,
    suggestion: "Null/undefined access — add runtime checks or fix types",
  },
  {
    pattern: /ECONNREFUSED|ENOTFOUND/,
    suggestion: "Network/service unavailable — check if required service is running",
  },
  {
    pattern: /port.*already in use|EADDRINUSE/,
    suggestion: "Port conflict — use PORT=0 for auto-assignment or kill existing process",
  },
  {
    pattern: /test.*fail|AssertionError|expect.*received/,
    suggestion: "Test failure — run 'bun test' to see details",
  },
  {
    pattern: /permission denied|EACCES/,
    suggestion: "Permission issue — check file ownership or use sudo if appropriate",
  },
  {
    pattern: /out of memory|ENOMEM/,
    suggestion: "Memory limit hit — check for leaks or increase limit",
  },
  {
    pattern: /timeout|ETIMEDOUT/,
    suggestion: "Operation timed out — check network or increase timeout",
  },
  {
    pattern: /lockfile|bun\.lock/,
    suggestion: "Lockfile issue — run 'bun install' or 'kimi-guardian fix'",
    autoFix: "bun install",
  },
];

function analyzeError(errorText: string): Array<{ suggestion: string; autoFix?: string }> {
  const results: Array<{ suggestion: string; autoFix?: string }> = [];
  for (const { pattern, suggestion, autoFix } of ERROR_PATTERNS) {
    if (pattern.test(errorText)) {
      results.push({ suggestion, autoFix });
    }
  }
  return results.length > 0
    ? results
    : [{ suggestion: "No known pattern matched — check logs manually" }];
}

// ── Session History (from memory DB if available) ────────────────────

async function getRecentSessions(project: string, limit = 5): Promise<SessionEvent[]> {
  if (!existsSync(MEMORY_DB)) return [];

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
    if (!existsSync(WIZARD_DIR)) {
      const { mkdirSync } = await import("fs");
      mkdirSync(WIZARD_DIR, { recursive: true });
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

  console.log(`── Trace: ${filePath} ─────────────────────────────────────────`);
  if (lines.length === 0) {
    console.log("  No git history for this file (untracked or new)");
    return;
  }

  console.log(`  ${lines.length} commits touching this file:`);
  for (const line of lines.slice(0, 10)) {
    console.log(`    ${line}`);
  }
  if (lines.length > 10) {
    console.log(`    ... and ${lines.length - 10} more`);
  }

  const diffResult = await $`git diff HEAD~1 -- ${filePath}`.cwd(projectDir).nothrow().quiet();
  const diff = diffResult.stdout.toString();
  if (diff) {
    console.log("");
    console.log("  Last change:");
    const diffLines = diff.split("\n").slice(0, 20);
    for (const line of diffLines) {
      const prefix = line.startsWith("+") ? "  + " : line.startsWith("-") ? "  - " : "    ";
      console.log(prefix + line.slice(1).slice(0, 100));
    }
    if (diff.split("\n").length > 20) {
      console.log("    ... (truncated)");
    }
  }
}

// ── Error Taxonomy ───────────────────────────────────────────────────

async function printTaxonomy() {
  const taxonomy = await loadTaxonomy();
  console.log(`── Error Taxonomy (v${taxonomy.version}) ─────────────────────`);
  console.log(`  Loaded from: ${taxonomyPath()}`);
  console.log("");
  for (const category of taxonomy.categories) {
    const expectedTag = category.expected ? " [expected]" : "";
    console.log(`  ${category.severity.toUpperCase()} ${category.id}${expectedTag}`);
    console.log(`    ${category.name}`);
    console.log(`    ${category.description}`);
    if (category.patterns.length > 0) {
      console.log(`    patterns: ${category.patterns.length}`);
    }
  }
}

async function analyzeWithTaxonomy(errorText: string) {
  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(errorText, taxonomy);
  console.log(`── Taxonomy Analysis ─────────────────────────────────────────`);
  console.log(`  Category: ${match.category.name} (${match.category.id})`);
  console.log(`  Severity: ${match.category.severity}`);
  console.log(`  Expected: ${match.category.expected ? "yes" : "no"}`);
  if (match.matchedPattern) {
    console.log(`  Pattern:  ${match.matchedPattern}`);
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

async function parseWireLog(wirePath: string) {
  if (!existsSync(wirePath)) {
    console.log(`Wire log not found: ${wirePath}`);
    process.exit(1);
  }

  const taxonomy = await loadTaxonomy();
  const text = await Bun.file(wirePath).text();
  const lines = text.split("\n").filter((l) => l.trim());

  const failures: ClassifiedFailure[] = [];
  let totalErrors = 0;

  for (const line of lines) {
    let event: WireEvent | null = null;
    try {
      event = JSON.parse(line) as WireEvent;
    } catch {
      continue;
    }
    if (event?.type !== "context.append_loop_event") continue;
    if (event.event?.type !== "tool.result") continue;
    if (!event.event.result?.isError) continue;

    totalErrors++;
    const output = event.event.result.output || "";
    const toolName = "unknown";
    const match = classifyFailure(output, taxonomy);
    failures.push(buildClassifiedFailure(toolName, output, match));
  }

  console.log(`── Wire Log Analysis ─────────────────────────────────────────`);
  console.log(`  File:         ${wirePath}`);
  console.log(`  Error events: ${totalErrors}`);
  console.log(`  Classified:   ${failures.length}`);
  console.log("");

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
    console.log("  No isError=true tool results found.");
    return;
  }

  console.log("  By category:");
  for (const [id, { count, severity, expected }] of byCategory.entries()) {
    const tag = expected ? " [expected]" : "";
    console.log(`    ${severity.toUpperCase()} ${id}: ${count}${tag}`);
  }

  console.log("");
  console.log("  Recent unclassified failures (if any):");
  let unclassified = 0;
  for (const f of failures.slice(-5)) {
    if (f.categoryId === "unknown") {
      unclassified++;
      const preview = f.output.replace(/\n/g, " ").slice(0, 100);
      console.log(`    ${preview}${f.output.length > 100 ? "..." : ""}`);
    }
  }
  if (unclassified === 0) {
    console.log("    (none)");
  }
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
  const hasGit = existsSync(join(projectDir, ".git"));
  checks.push({
    name: "git-repo",
    status: hasGit ? "ok" : "warn",
    message: hasGit ? "Git repository found" : "Not a git repository",
    fixable: false,
  });

  // Memory DB check
  checks.push({
    name: "memory-db",
    status: existsSync(MEMORY_DB) ? "ok" : "warn",
    message: existsSync(MEMORY_DB) ? "Accessible" : "Not found — sessions won't be recorded",
    fixable: false,
  });

  // Error pattern coverage
  checks.push({
    name: "patterns",
    status: "ok",
    message: `${ERROR_PATTERNS.length} error patterns loaded`,
    fixable: false,
  });

  // Guardian integration
  const guardianPath = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools", "kimi-guardian.ts");
  checks.push({
    name: "guardian",
    status: existsSync(guardianPath) ? "ok" : "warn",
    message: existsSync(guardianPath)
      ? "Available"
      : "Not found — lockfile issues won't be detected",
    fixable: false,
  });

  let errors = 0,
    warns = 0,
    fixable = 0;
  for (const c of checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
    if (c.status === "error") errors++;
    if (c.status === "warn") warns++;
    if (c.fixable) fixable++;
  }
  console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
}

// ── Fix ──────────────────────────────────────────────────────────────

async function fixError(projectDir: string, errorText: string) {
  const results = analyzeError(errorText);
  console.log(`── Auto-Fix Analysis ─────────────────────────────────────────`);

  let fixable = 0;
  for (const r of results) {
    if (r.autoFix) {
      console.log(`  → ${r.suggestion}`);
      console.log(`    Auto-fix: ${r.autoFix}`);
      fixable++;
    } else {
      console.log(`  → ${r.suggestion} (no auto-fix)`);
    }
  }

  if (fixable > 0) {
    console.log("");
    console.log("  Run the suggested commands manually. For lockfile issues, use:");
    console.log("    kimi-guardian fix");
  }

  // Record for pattern matching
  await recordFailure(
    getProjectName(projectDir),
    errorText,
    results.map((r) => r.suggestion)
  );
}

function getProjectName(projectDir: string): string {
  return projectDir.split("/").pop() || "unknown";
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "last";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = getProjectName(projectDir);

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           Kimi Debug — "What Broke?" Wizard                  ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log(`  Project: ${project}`);
  console.log("");

  if (command === "last") {
    console.log(`── Recent Activity ───────────────────────────────────────────`);

    const lastCommit = await getLastCommitMessage(projectDir);
    console.log(`  Last commit: ${lastCommit}`);

    const recent = await getRecentChanges(projectDir, 3);
    if (recent.length > 0) {
      console.log("");
      console.log(`  Files changed in last 3 commits (${recent.length} files):`);
      for (const c of recent.slice(0, 10)) {
        console.log(`    ${c.file} (+${c.insertions}/-${c.deletions})`);
      }
    }

    const working = await getWorkingTreeChanges(projectDir);
    if (working.length > 0) {
      console.log("");
      console.log(`  Uncommitted changes (${working.length} files):`);
      for (const c of working.slice(0, 10)) {
        console.log(`    [${c.status}] ${c.file}`);
      }
    }

    const sessions = await getRecentSessions(project, 3);
    if (sessions.length > 0) {
      console.log("");
      console.log(`  Recent sessions:`);
      for (const s of sessions) {
        console.log(`    ${s.time.slice(0, 19)} — ${s.detail.slice(0, 60)}`);
      }
    }

    if (recent.length > 0) {
      const mostChanged = recent.reduce((a, b) =>
        a.insertions + a.deletions > b.insertions + b.deletions ? a : b
      );
      console.log("");
      console.log(`── Suggestion ────────────────────────────────────────────────`);
      console.log(`  Most changed file: ${mostChanged.file}`);
      console.log(`  If something broke recently, check this file first.`);
      console.log(`  Run: kimi-debug trace ${mostChanged.file}`);
    }
  } else if (command === "diff") {
    const commits = parseInt(args[1], 10) || 3;
    console.log(`── Diff Summary (last ${commits} commits) ─────────────────────`);

    const changes = await getRecentChanges(projectDir, commits);
    if (changes.length === 0) {
      console.log("  No changes found");
      return;
    }

    const byExt = new Map<string, GitChange[]>();
    for (const c of changes) {
      const ext = c.file.split(".").pop() || "no-ext";
      byExt.set(ext, [...(byExt.get(ext) || []), c]);
    }

    console.log(`  Total files: ${changes.length}`);
    console.log("  By type:");
    for (const [ext, files] of byExt.entries()) {
      const totalLines = files.reduce((s, f) => s + f.insertions + f.deletions, 0);
      console.log(`    .${ext}: ${files.length} files, ${totalLines} lines changed`);
    }

    const highRisk = changes.filter((c) => c.insertions + c.deletions > 50);
    if (highRisk.length > 0) {
      console.log("");
      console.log("  High-risk changes (>50 lines):");
      for (const c of highRisk) {
        console.log(`    ⚠ ${c.file} (+${c.insertions}/-${c.deletions})`);
      }
    }
  } else if (command === "trace") {
    const filePath = args[1];
    if (!filePath) {
      console.log("Usage: kimi-debug trace <file-path>");
      process.exit(1);
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
      errorText = new TextDecoder().decode(combined);
    }

    if (!errorText.trim()) {
      console.log("Usage: kimi-debug analyze <error-message-or-log-snippet>");
      console.log("  Or pipe: cat error.log | kimi-debug analyze");
      process.exit(1);
    }

    console.log(`── Error Analysis ────────────────────────────────────────────`);
    const results = analyzeError(errorText);
    for (const r of results) {
      console.log(`  → ${r.suggestion}`);
      if (r.autoFix) {
        console.log(`    Auto-fix available: ${r.autoFix}`);
      }
    }

    // Check if any recent file matches error context
    const recent = await getRecentChanges(projectDir, 5);
    const errorFiles = errorText.match(/[\w-/.]+\.(ts|js|tsx|jsx|json|toml)/g) || [];
    if (errorFiles.length > 0) {
      console.log("");
      console.log("  Files mentioned in error:");
      for (const f of new Set(errorFiles)) {
        const changed = recent.some((r) => r.file.includes(f));
        console.log(`    ${changed ? "⚠" : "  "} ${f}${changed ? " (recently changed)" : ""}`);
      }
    }

    // Record failure for future pattern matching
    await recordFailure(
      project,
      errorText,
      results.map((r) => r.suggestion)
    );
    console.log("");
    console.log("  Recorded failure for similarity matching");

    // Cross-tool: suggest guardian for lockfile issues
    if (errorText.includes("lockfile") || errorText.includes("bun.lock")) {
      console.log("");
      console.log("  → Lockfile-related error detected. Run: kimi-guardian check");
    }
  } else if (command === "doctor") {
    await doctor(projectDir);
  } else if (command === "fix") {
    const errorText = args.slice(1).join(" ") || "";
    if (!errorText) {
      console.log("Usage: kimi-debug fix <error-text>");
      console.log("  Analyzes error and suggests auto-fixes");
      process.exit(1);
    }
    await fixError(projectDir, errorText);
  } else if (command === "taxonomy") {
    await printTaxonomy();
  } else if (command === "classify") {
    const errorText = args.slice(1).join(" ") || "";
    if (!errorText) {
      console.log("Usage: kimi-debug classify <error-text>");
      console.log("  Classify error text against taxonomy");
      process.exit(1);
    }
    await analyzeWithTaxonomy(errorText);
  } else if (command === "wire") {
    const wirePath =
      args[1] ||
      join(
        Bun.env.HOME || "/tmp",
        ".kimi-code",
        "sessions",
        "wd_nolarose_b0130204790b",
        "session_17df1550-19a2-4594-9c37-020ffc7b3f63",
        "agents",
        "main",
        "wire.jsonl"
      );
    await parseWireLog(wirePath);
  } else {
    console.log("Commands:");
    console.log("  last                    Show recent activity + heuristic suggestion");
    console.log("  diff [N]                Summarize last N commits of changes");
    console.log("  trace <file>            Show git history + last diff for a file");
    console.log("  analyze <error-text>    Analyze error message for known patterns");
    console.log("  classify <error-text>   Classify error text against taxonomy");
    console.log("  taxonomy                List error taxonomy categories");
    console.log("  wire [path]             Analyze a Kimi Code wire.jsonl for failures");
    console.log("  doctor                  Check debug wizard health");
    console.log("  fix <error-text>        Suggest auto-fixes for error");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Debug wizard failed:", err.message);
  process.exit(1);
});
