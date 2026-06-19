#!/usr/bin/env bun
import { makeDir, pathExists } from "../lib/bun-io.ts";
/**
 * kimi-debug — "What broke?" wizard
 * Analyzes recent session activity + git history to suggest root cause
 *
 * Usage:
 *   kimi-debug [last|diff|trace|analyze|doctor|fix|webview <url|file>|webview frontmatter <file>]
 */

import { $, randomUUIDv7 } from "bun";
import { join } from "path";
import { toolsDir } from "../lib/paths.ts";
import { resolveProjectRoot, safeParse } from "../lib/utils.ts";

import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { gitStatus, gitDiff, gitLastCommitMessage } from "../lib/git-helpers.ts";
import { createCli } from "../lib/cli-contract.ts";

import {
  buildClassifiedFailure,
  classifyFailure,
  getSuggestions,
  loadTaxonomy,
  taxonomyPath,
  type ClassifiedFailure,
} from "../lib/error-taxonomy.ts";
import {
  buildTaxonomyConstantLinks,
  formatTaxonomyConstantHint,
  loadFailureCountsByTaxonomy,
} from "../lib/taxonomy-constants.ts";
import { readFailureLedgerSummary } from "../lib/success-metrics.ts";
import { formatFrontmatterTable } from "../lib/frontmatter.ts";
import { truncateTerminal } from "../lib/inspect.ts";
import {
  defaultWebViewBackend,
  formatWebViewConsoleEvents,
  parseWebViewCliArgs,
  probeWebViewConsole,
  probeWebViewFrontmatter,
  webViewConsoleAgentPayload,
  webViewSupported,
} from "../lib/webview-console.ts";

const writer = createCli(Bun.argv, "kimi-debug");
const logger = writer.logger;

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

import {
  discoverErrorLogSinks,
  findLatestWireLogPath,
  formatLogBytes,
  resolveErrorLogSink,
  tailErrorLogFile,
  type ErrorLogSinkStatus,
} from "../lib/error-log-discovery.ts";
import { classifyLogBlob } from "../lib/herdr-log-classify.ts";
import { failureLedgerPath, varDir, wizardDir } from "../lib/paths.ts";

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

// ── Error log discovery ──────────────────────────────────────────────

interface LogsCommandOptions {
  id?: string;
  path?: string;
  tail?: number;
  errorsOnly: boolean;
  classify: boolean;
}

function parseLogsCommandOptions(argv: string[]): LogsCommandOptions {
  let id: string | undefined;
  let path: string | undefined;
  let tail: number | undefined;
  let errorsOnly = argv.includes("--errors");
  const classify = argv.includes("--classify");
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--id" && argv[i + 1]) {
      id = argv[++i];
      continue;
    }
    if (arg === "--path" && argv[i + 1]) {
      path = argv[++i];
      continue;
    }
    if (arg === "--tail" && argv[i + 1]) {
      const value = Number(argv[++i]);
      if (Number.isFinite(value) && value > 0) tail = Math.floor(value);
    }
  }
  return { id, path, tail, errorsOnly, classify };
}

function formatSinkLine(sink: ErrorLogSinkStatus): string {
  const status = sink.present ? "present" : "missing";
  const size = sink.present ? formatLogBytes(sink.bytes) : "—";
  return `${sink.id.padEnd(22)} ${status.padEnd(8)} ${size.padEnd(8)} ${sink.path}`;
}

async function printErrorLogs(projectDir: string, options: LogsCommandOptions): Promise<number> {
  const report = discoverErrorLogSinks(projectDir);

  if (options.path) {
    if (!pathExists(options.path)) {
      logger.error(`Log not found: ${options.path}`);
      return 1;
    }
    const lines = await tailErrorLogFile(options.path, options.tail ?? 30, options.errorsOnly);
    if (options.classify) {
      const taxonomy = await loadTaxonomy();
      const hits = classifyLogBlob(lines, taxonomy, { source: "blob" });
      if (writer.flags.json) {
        writer.writeJson({
          schemaVersion: 1,
          tool: "kimi-debug",
          mode: "logs",
          path: options.path,
          lines,
          errorsOnly: options.errorsOnly,
          hits,
        });
        return 0;
      }
      logger.section(`Classified hits: ${options.path}`);
      for (const hit of hits) {
        logger.line(`${hit.taxonomyId} pid=${hit.pid ?? "none"} severity=${hit.severity}`);
      }
      return 0;
    }
    if (writer.flags.json) {
      writer.writeJson({
        schemaVersion: 1,
        tool: "kimi-debug",
        mode: "logs",
        path: options.path,
        lines,
        errorsOnly: options.errorsOnly,
      });
      return 0;
    }
    logger.section(`Log tail: ${options.path}`);
    for (const line of lines) logger.line(line);
    return 0;
  }

  if (options.id) {
    const sink = resolveErrorLogSink(report, options.id);
    if (!sink) {
      logger.error(`Unknown log id "${options.id}" — run kimi-debug logs for the registry`);
      return 1;
    }
    if (!sink.present) {
      logger.warn(`${sink.label} not found at ${sink.path}`);
      logger.info(`When present, read with: ${sink.readCommand}`);
      return 0;
    }
    if (sink.kind === "sqlite") {
      logger.info(`${sink.label}: ${sink.path}`);
      logger.info(`Read with: ${sink.readCommand}`);
      return 0;
    }
    const lines = await tailErrorLogFile(sink.path, options.tail ?? 30, options.errorsOnly);
    const source =
      sink.id === "herdr-server"
        ? "herdr-server"
        : sink.id === "herdr-client"
          ? "herdr-client"
          : "blob";
    if (options.classify) {
      const taxonomy = await loadTaxonomy();
      const hits = classifyLogBlob(lines, taxonomy, { source });
      if (writer.flags.json) {
        writer.writeJson({
          schemaVersion: 1,
          tool: "kimi-debug",
          mode: "logs",
          sink,
          lines,
          errorsOnly: options.errorsOnly,
          hits,
        });
        return 0;
      }
      logger.section(`${sink.label} — classified hits`);
      for (const hit of hits) {
        logger.line(`${hit.taxonomyId} pid=${hit.pid ?? "none"} severity=${hit.severity}`);
      }
      return 0;
    }
    if (writer.flags.json) {
      writer.writeJson({
        schemaVersion: 1,
        tool: "kimi-debug",
        mode: "logs",
        sink,
        lines,
        errorsOnly: options.errorsOnly,
      });
      return 0;
    }
    logger.section(`${sink.label} (${sink.id})`);
    logger.info(sink.path);
    logger.info(`Read: ${sink.readCommand}`);
    for (const line of lines) logger.line(line);
    return 0;
  }

  if (options.tail !== undefined) {
    const present = report.sinks.filter((sink) => sink.present && sink.kind !== "sqlite");
    if (writer.flags.json) {
      const tailed: Array<{ id: string; path: string; lines: string[] }> = [];
      for (const sink of present) {
        const lines = await tailErrorLogFile(sink.path, options.tail, options.errorsOnly);
        if (lines.length > 0) tailed.push({ id: sink.id, path: sink.path, lines });
      }
      writer.writeJson({
        schemaVersion: 1,
        tool: "kimi-debug",
        mode: "logs",
        tailed,
        errorsOnly: options.errorsOnly,
      });
      return 0;
    }
    for (const sink of present) {
      const lines = await tailErrorLogFile(sink.path, options.tail, options.errorsOnly);
      if (lines.length === 0) continue;
      logger.section(`${sink.label} (${sink.id})`);
      for (const line of lines) logger.line(line);
    }
    return 0;
  }

  if (writer.flags.json) {
    writer.writeJson(report);
    return 0;
  }

  logger.section("Error log sinks");
  logger.info(`Project: ${report.projectRoot}`);
  logger.info("id                     status   size     path");
  for (const sink of report.sinks) {
    logger.line(formatSinkLine(sink));
    logger.line(`  ${sink.purpose}`);
    logger.line(`  read: ${sink.readCommand}`);
  }
  logger.info("Tail one: kimi-debug logs --id tool-failures --tail 20 [--errors]");
  logger.info("Wire failures: kimi-debug wire");
  return 0;
}

async function analyzeError(
  errorText: string
): Promise<Array<{ suggestion: string; autoFix?: string; categoryId?: string; docLink?: string }>> {
  const taxonomy = await loadTaxonomy();
  const suggestions = getSuggestions(errorText, taxonomy);
  if (suggestions.length === 0) {
    return [{ suggestion: "No known pattern matched — check logs manually" }];
  }
  return suggestions.map((s) => ({
    suggestion: s.suggestion,
    autoFix: s.autoFix,
    categoryId: s.categoryId,
    docLink: s.docLink,
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
        randomUUIDv7(),
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
      const body = line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line;
      logger.line(prefix + truncateTerminal(body, 100));
    }
    if (diff.split("\n").length > 20) {
      logger.line(`    … (${diff.split("\n").length - 20} more lines)`);
    }
  }
}

// ── Error Taxonomy ───────────────────────────────────────────────────

async function printTaxonomy() {
  const taxonomy = await loadTaxonomy();
  const projectDir = await resolveProjectRoot();
  const links = await buildTaxonomyConstantLinks(projectDir);
  const linkById = new Map(links.map((link) => [link.taxonomyId, link]));

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
    const link = linkById.get(category.id);
    if (link && link.resolved.length > 0) {
      logger.info(`  boundConstants: ${formatTaxonomyConstantHint(link)}`);
    }
  }
}

async function printErrorCluster(projectDir: string) {
  const taxonomy = await loadTaxonomy(join(projectDir, "error-taxonomy.yml"));
  const links = await buildTaxonomyConstantLinks(projectDir);
  const ledgerPath = failureLedgerPath();
  const ledgerCounts = await loadFailureCountsByTaxonomy(ledgerPath);

  logger.section("Error Cluster — Taxonomy × Constants");
  logger.info(`Ledger: ${ledgerPath}`);

  const linked = links.filter((link) => link.boundConstants.length > 0);
  if (linked.length === 0) {
    logger.warn("No taxonomy categories declare boundConstants");
    return 0;
  }

  for (const link of linked.sort((a, b) => {
    const aCount = ledgerCounts.get(a.taxonomyId) ?? 0;
    const bCount = ledgerCounts.get(b.taxonomyId) ?? 0;
    return bCount - aCount;
  })) {
    const hits = ledgerCounts.get(link.taxonomyId) ?? 0;
    logger.info(
      `${link.taxonomyId} (${hits} ledger hit${hits === 1 ? "" : "s"}) — ${link.categoryName}`
    );
    logger.info(`  ${formatTaxonomyConstantHint(link)}`);
    const category = taxonomy.categories.find((entry) => entry.id === link.taxonomyId);
    if (category?.autoFix) {
      logger.info(`  autoFix: ${category.autoFix}`);
    }
  }

  return 0;
}

async function printFailureLedger(path?: string) {
  const summary = await readFailureLedgerSummary(path || failureLedgerPath());

  if (writer.flags.json) {
    writer.writeJson({ schemaVersion: 1, tool: "kimi-debug", summary });
    return 0;
  }

  logger.section("Failure Ledger");
  logger.info(`File: ${summary.path}`);
  if (!summary.present) {
    logger.warn("No failure ledger found");
    return 0;
  }

  logger.info(`Total failures: ${summary.total}`);
  logger.info(`Unclassified:   ${summary.unclassified}`);
  logger.info(`Review:         ${summary.reviewCommand}`);

  const counts = Object.entries(summary.taxonomyCounts).sort((a, b) => b[1] - a[1]);
  if (counts.length > 0) {
    logger.info("By taxonomy:");
    for (const [taxonomyId, count] of counts.slice(0, 12)) {
      logger.line(`    ${taxonomyId}: ${count}`);
    }
  }

  if (summary.unknownBuckets.length === 0) {
    logger.info("Unknown buckets: none");
    return 0;
  }

  logger.info("Unknown buckets:");
  for (const bucket of summary.unknownBuckets.slice(0, 10)) {
    const seen =
      bucket.firstSeen && bucket.lastSeen
        ? ` first=${bucket.firstSeen} last=${bucket.lastSeen}`
        : "";
    logger.line(
      `    ${bucket.fingerprint}: count=${bucket.count} tools=${bucket.toolNames.join(",")}${seen}`
    );
  }
  if (summary.unknownAction) {
    logger.info(summary.unknownAction);
  }
  return 0;
}

async function analyzeWithTaxonomy(errorText: string) {
  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(errorText, taxonomy);
  const projectDir = await resolveProjectRoot();
  const links = await buildTaxonomyConstantLinks(projectDir);
  const link = links.find((entry) => entry.taxonomyId === match.category.id);

  logger.section("Taxonomy Analysis");
  logger.info(`Category: ${match.category.name} (${match.category.id})`);
  logger.info(`Severity: ${match.category.severity}`);
  logger.info(`Expected: ${match.category.expected ? "yes" : "no"}`);
  if (match.matchedPattern) {
    logger.info(`Pattern:  ${match.matchedPattern}`);
  }
  if (link && link.resolved.length > 0) {
    logger.info(`Tuning:   ${formatTaxonomyConstantHint(link)}`);
  }
  if (match.category.autoFix) {
    logger.info(`AutoFix:  ${match.category.autoFix}`);
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
      const preview = truncateTerminal(f.output.replace(/\n/g, " "), 100);
      logger.line(`    ${preview}`);
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

  checks.push({
    name: "webview",
    status: webViewSupported() ? "ok" : "warn",
    message: webViewSupported()
      ? `Bun.WebView available (${defaultWebViewBackend()} default backend)`
      : "Unavailable — `kimi-debug webview` probes disabled in this runtime",
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
      if (r.docLink) logger.info(`See: ${r.docLink}`);
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

// ── WebView console probe ────────────────────────────────────────────

async function runWebViewCommand(argv: string[]): Promise<number> {
  const cli = parseWebViewCliArgs(argv);
  if ("error" in cli) {
    logger.error(cli.error);
    logger.error(
      "Usage: kimi-debug webview <url|file> [--mirror] [--json] [--depth N] [--wait MS] [--script JS]"
    );
    logger.error(
      "       kimi-debug webview frontmatter <file> [--mirror] [--json] [--depth N] [--backend webkit|chrome]"
    );
    return 1;
  }

  if (!webViewSupported()) {
    logger.error("Bun.WebView is not available in this runtime");
    return 1;
  }

  const captureOpts = {
    mirror: cli.mirror,
    depth: cli.depth,
    script: cli.script,
    waitMs: cli.waitMs,
    backend: cli.backend,
  };

  try {
    if (cli.mode === "frontmatter") {
      const { parsed, capture } = await probeWebViewFrontmatter(cli.target, captureOpts);
      if (cli.json) {
        Bun.stdout.write(
          `${webViewConsoleAgentPayload(capture, {
            mode: "frontmatter",
            file: parsed.meta.file,
            format: parsed.meta.format,
            bodyLength: parsed.body.length,
            depth: cli.depth,
          })}\n`
        );
        return 0;
      }

      logger.section("WebView frontmatter probe");
      logger.info(`file: ${parsed.meta.file}`);
      logger.info(`format: ${parsed.meta.format}`);
      logger.info(`page: ${capture.title || capture.url}`);
      if (cli.mirror) {
        logger.info("mirror: globalThis.console (see stdout/stderr above)");
        return 0;
      }
      logger.info(`events: ${capture.events.length}`);
      if (capture.events.length > 0) {
        logger.line(formatWebViewConsoleEvents(capture.events, cli.depth));
      }
      logger.section("Parsed frontmatter (table)");
      logger.line(formatFrontmatterTable(parsed.data, { depth: cli.depth }));
      return 0;
    }

    const capture = await probeWebViewConsole(cli.target, captureOpts);
    if (cli.json) {
      Bun.stdout.write(
        `${webViewConsoleAgentPayload(capture, {
          mode: "open",
          target: cli.target,
          depth: cli.depth,
        })}\n`
      );
      return 0;
    }

    logger.section("WebView console probe");
    logger.info(`target: ${cli.target}`);
    logger.info(`page: ${capture.title || capture.url}`);
    if (cli.mirror) {
      logger.info("mirror: globalThis.console (see stdout/stderr above)");
      return 0;
    }
    logger.info(`events: ${capture.events.length}`);
    if (capture.events.length === 0) {
      logger.warn("No console events captured — try --script or frontmatter mode");
    } else {
      logger.line(formatWebViewConsoleEvents(capture.events, cli.depth));
    }
    return 0;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (cli.json) {
      Bun.stdout.write(
        `${webViewConsoleAgentPayload(
          { events: [], url: "", title: "", mirrored: cli.mirror },
          { error: message, target: cli.target }
        )}\n`
      );
    } else {
      logger.error(message);
    }
    return 1;
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "last";
  const projectDir = await resolveProjectRoot();
  const project = getDirName(projectDir);
  const jsonOnly = command === "webview" && args.includes("--json");

  if (!jsonOnly) {
    logger.banner('Kimi Debug — "What Broke?" Wizard', projectDir);
  }

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
        logger.line(`    ${s.time.slice(0, 19)} — ${truncateTerminal(s.detail, 60)}`);
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
    const commits = parseInt(args[1], 10) || 3;
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
        if (r.docLink) logger.info(`See: ${r.docLink}`);
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
  } else if (command === "cluster") {
    return await printErrorCluster(projectDir);
  } else if (command === "ledger") {
    return await printFailureLedger(args.find((arg, index) => index > 0 && !arg.startsWith("-")));
  } else if (command === "classify") {
    const errorText = args.slice(1).join(" ") || "";
    if (!errorText) {
      logger.error("Usage: kimi-debug classify <error-text>");
      logger.info("Classify error text against taxonomy");
      return 1;
    }
    await analyzeWithTaxonomy(errorText);
  } else if (command === "logs") {
    return await printErrorLogs(projectDir, parseLogsCommandOptions(args.slice(1)));
  } else if (command === "wire") {
    const wirePath = args[1] || findLatestWireLogPath();
    if (!wirePath) {
      logger.error("No wire.jsonl found — specify a path or ensure a Kimi Code session exists.");
      return 1;
    }
    return await parseWireLog(wirePath);
  } else if (command === "webview") {
    return await runWebViewCommand(args.slice(1));
  } else {
    logger.section("Commands");
    logger.line("  last                    Show recent activity + heuristic suggestion");
    logger.line("  diff [N]                Summarize last N commits of changes");
    logger.line("  trace <file>            Show git history + last diff for a file");
    logger.line("  analyze <error-text>    Analyze error message for known patterns");
    logger.line("  classify <error-text>   Classify error text against taxonomy");
    logger.line("  taxonomy                List error taxonomy categories");
    logger.line("  cluster                 Group taxonomy failures with related define constants");
    logger.line("  ledger [path] [--json]  Review failure ledger taxonomy and unknown buckets");
    logger.line(
      "  logs [--json]           List dedicated error/console log paths and read commands"
    );
    logger.line(
      "  logs --id <sink> [--tail N] [--errors] [--classify]  Tail + batch classify a sink"
    );
    logger.line("  logs --path <file> [--tail N] [--errors]  Tail an arbitrary log file");
    logger.line("  wire [path]             Analyze a Kimi Code wire.jsonl for failures");
    logger.line(
      "  webview <url|file>      Capture page console via Bun.WebView (--mirror, --depth, --json)"
    );
    logger.line(
      "  webview frontmatter <f> Preview + capture frontmatter console from markdown file"
    );
    logger.line("  doctor                  Check debug wizard health");
    logger.line("  fix <error-text>        Suggest auto-fixes for error");
  }

  return 0;
}

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
