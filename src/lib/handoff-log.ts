import {
  listDir,
  makeDir,
  pathExists,
  pathStat,
  readBytes,
  readText,
  writeBytes,
  writeText,
} from "./bun-io.ts";
import { appendNdjsonRecordSync, parseNdjsonText } from "./ndjson.ts";


import { homeDir } from "./paths.ts";
import { join } from "path";
// ── Types ────────────────────────────────────────────────────────────────

export interface HandoffLogEntry {
  timestamp: string;
  seq: number;
  workspace: string;
  agent: string;
  rule: number;
  trigger: "react" | "manual" | "daemon-tick" | "watch-events";
  action: "handoff" | "spawn" | "spawn-fallback" | "error" | "dry-run" | "skip" | "noop";
  fromAgent?: string;
  fromWorkspace?: string;
  fromHost?: string;
  toAgent?: string;
  toWorkspace?: string;
  toHost?: string;
  condition?: string;
  context?: Record<string, unknown>;
  detail: string;
  durationMs?: number;
  ok: boolean;
  checksum: string;
}

// ── Paths ────────────────────────────────────────────────────────────────

const DEFAULT_LOG_DIR = join(homeDir(), ".herdr", "orchestrator");
const DEFAULT_LOG_PATH = join(DEFAULT_LOG_DIR, "handoff-log.jsonl");
const DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024; // 50MB

let logPath = DEFAULT_LOG_PATH;
let enabled = true;
let seq = 0;
let maxLogBytes = DEFAULT_MAX_LOG_BYTES;

export function configureHandoffLog(options: {
  path?: string;
  enabled?: boolean;
  maxBytes?: number;
}) {
  if (options.path) logPath = options.path;
  if (options.enabled !== undefined) enabled = options.enabled;
  if (options.maxBytes !== undefined) maxLogBytes = options.maxBytes;
}

/** Attach remote-host metadata for thin-client SSH orchestration events. */
export function remoteHandoffContext(
  remoteHost: string,
  context?: Record<string, unknown>
): Record<string, unknown> {
  return { ...context, remote_host: remoteHost, via_ssh: true };
}

function ensureLogDir() {
  makeDir(join(logPath, ".."), { recursive: true });
}

// ── Checksums ────────────────────────────────────────────────────────────

function sha256(data: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

// ── Rotation ─────────────────────────────────────────────────────────────

function rotateIfNeeded() {
  if (!pathExists(logPath)) return;
  const stat = pathStat(logPath);
  if (stat.size < maxLogBytes) return;

  const iso = new Date().toISOString();
  const date = iso.slice(0, 10); // YYYY-MM-DD
  const time = iso.slice(11, 23).replace(/:/g, ""); // HHMMSS.sss
  const archiveName = `handoff-history.${date}.${time}.jsonl.gz`;
  const archivePath = join(join(logPath, ".."), archiveName);

  const raw = new Uint8Array(readBytes(logPath)) as Uint8Array<ArrayBuffer>;
  writeBytes(archivePath, Bun.gzipSync(raw));
  writeText(logPath, "");
}

// ── Write ────────────────────────────────────────────────────────────────

export function logHandoff(entry: Omit<HandoffLogEntry, "timestamp" | "seq" | "checksum">) {
  if (!enabled) return;
  try {
    ensureLogDir();
    rotateIfNeeded();

    seq++;
    const line: HandoffLogEntry = {
      timestamp: new Date().toISOString(),
      seq,
      ...entry,
      checksum: "",
    };
    // Compute checksum over the JSON body (excluding checksum field itself)
    const body = JSON.stringify({
      timestamp: line.timestamp,
      seq: line.seq,
      workspace: line.workspace,
      agent: line.agent,
      rule: line.rule,
      trigger: line.trigger,
      action: line.action,
      fromAgent: line.fromAgent,
      fromWorkspace: line.fromWorkspace,
      fromHost: line.fromHost,
      toAgent: line.toAgent,
      toWorkspace: line.toWorkspace,
      toHost: line.toHost,
      condition: line.condition,
      context: line.context,
      detail: line.detail,
      durationMs: line.durationMs,
      ok: line.ok,
    });
    line.checksum = sha256(body);

    appendNdjsonRecordSync(logPath, line);
  } catch {
    // Silent failure — logging is best-effort
  }
}

/** Reset the global sequence counter (useful for testing). */
export function resetHandoffSeq(value = 0) {
  seq = value;
}

// ── Read ────────────────────────────────────────────────────────────────

export function getHandoffHistory(limit = 20): HandoffLogEntry[] {
  const allEntries = readLogFile(logPath);

  // Also check archives for older entries
  const logDir = join(logPath, "..");
  try {
    const files = listDir(logDir);
    const archivePattern = /^handoff-history\.\d{4}-\d{2}-\d{2}\..+\.jsonl\.gz$/;
    for (const file of files) {
      if (!archivePattern.test(file)) continue;
      try {
        const archivePath = join(logDir, file);
        const compressed = readBytes(archivePath);
        const raw = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(compressed)));
        allEntries.push(...readLogLines(raw));
      } catch {
        // Skip unreadable archives
      }
    }
  } catch {
    // Directory listing failed — skip archives
  }

  // Sort by timestamp descending, return limited
  allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return allEntries.slice(0, limit);
}

function isHandoffLogEntry(value: unknown): value is HandoffLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HandoffLogEntry).timestamp === "string" &&
    typeof (value as HandoffLogEntry).seq === "number"
  );
}

/** Parse raw JSONL text into entries (Bun.JSONL when available). */
function readLogLines(raw: string): HandoffLogEntry[] {
  return parseNdjsonText<HandoffLogEntry>(raw, isHandoffLogEntry);
}

// Update readLogFile to delegate to readLogLines
function readLogFile(path: string): HandoffLogEntry[] {
  if (!pathExists(path)) return [];
  try {
    const raw = readText(path);
    return readLogLines(raw);
  } catch {
    return [];
  }
}

/** Verify checksums on all entries in the live log. Returns failing entries. */
export function verifyHandoffLog(): Array<{ seq: number; expected: string; actual: string }> {
  const entries = readLogFile(logPath);
  const failures: Array<{ seq: number; expected: string; actual: string }> = [];
  for (const entry of entries) {
    const body = JSON.stringify({
      timestamp: entry.timestamp,
      seq: entry.seq,
      workspace: entry.workspace,
      agent: entry.agent,
      rule: entry.rule,
      trigger: entry.trigger,
      action: entry.action,
      fromAgent: entry.fromAgent,
      fromWorkspace: entry.fromWorkspace,
      fromHost: entry.fromHost,
      toAgent: entry.toAgent,
      toWorkspace: entry.toWorkspace,
      toHost: entry.toHost,
      condition: entry.condition,
      context: entry.context,
      detail: entry.detail,
      durationMs: entry.durationMs,
      ok: entry.ok,
    });
    const computed = sha256(body);
    if (computed !== entry.checksum) {
      failures.push({ seq: entry.seq, expected: computed, actual: entry.checksum });
    }
  }
  return failures;
}

export function getHandoffLogPath(): string {
  return logPath;
}

export interface HandoffHistoryQuery {
  limit?: number;
  workspace?: string;
  agent?: string;
  trigger?: HandoffLogEntry["trigger"];
  action?: HandoffLogEntry["action"];
  ok?: boolean;
  /** ISO-8601 — return entries at or after this timestamp */
  since?: string;
}

export function entryMatchesHandoffQuery(
  entry: HandoffLogEntry,
  query: HandoffHistoryQuery
): boolean {
  if (
    query.workspace &&
    entry.workspace !== query.workspace &&
    entry.fromWorkspace !== query.workspace
  ) {
    return false;
  }
  if (
    query.agent &&
    entry.agent !== query.agent &&
    entry.fromAgent !== query.agent &&
    entry.toAgent !== query.agent
  ) {
    return false;
  }
  if (query.trigger && entry.trigger !== query.trigger) return false;
  if (query.action && entry.action !== query.action) return false;
  if (query.ok !== undefined && entry.ok !== query.ok) return false;
  if (query.since && entry.timestamp < query.since) return false;
  return true;
}

/** Filter and limit handoff history (live log + rotation archives). */
export function queryHandoffHistory(query: HandoffHistoryQuery = {}): HandoffLogEntry[] {
  const limit = query.limit ?? 20;
  const entries = getHandoffHistory(Number.MAX_SAFE_INTEGER).filter((entry) =>
    entryMatchesHandoffQuery(entry, query)
  );
  return entries.slice(0, limit);
}

export function inferHandoffLogAction(
  detail: string,
  ok: boolean,
  dryRun: boolean
): HandoffLogEntry["action"] {
  if (dryRun) return "dry-run";
  if (!ok) {
    if (
      detail.includes("not satisfied") ||
      detail.includes("not found") ||
      detail.includes(" is ") ||
      detail.includes("no prior")
    ) {
      return "skip";
    }
    return "error";
  }
  if (detail.includes("spawn-fallback")) return "spawn-fallback";
  if (detail.includes("spawned")) return "spawn";
  return "handoff";
}

export function recordHandoffRuleEvaluation(options: {
  rule: {
    fromWorkspace: string;
    fromAgent: string;
    toWorkspace: string;
    toAgent: string;
    condition: string;
    fromSession?: string;
    toSession?: string;
  };
  ruleIndex: number;
  detail: string;
  ok: boolean;
  trigger: HandoffLogEntry["trigger"];
  fromSession?: string;
  toSession?: string;
  dryRun?: boolean;
  context?: Record<string, unknown>;
  durationMs?: number;
}) {
  const fromSess = options.fromSession || options.rule.fromSession || "default";
  const toSess = options.toSession || options.rule.toSession || fromSess;
  logHandoff({
    workspace: options.rule.fromWorkspace,
    agent: options.rule.fromAgent,
    rule: options.ruleIndex,
    trigger: options.trigger,
    action: inferHandoffLogAction(options.detail, options.ok, options.dryRun ?? false),
    fromAgent: options.rule.fromAgent,
    fromWorkspace: options.rule.fromWorkspace,
    fromHost: fromSess,
    toAgent: options.rule.toAgent,
    toWorkspace: options.rule.toWorkspace,
    toHost: toSess,
    condition: options.rule.condition,
    detail: options.detail,
    ok: options.ok,
    context: options.context,
    durationMs: options.durationMs,
  });
}
