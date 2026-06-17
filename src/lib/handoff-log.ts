import {
  appendText,
  listDir,
  makeDir,
  pathExists,
  pathStat,
  readBytes,
  readText,
  writeBytes,
  writeText,
} from "./bun-io.ts";

import { gzipBytes, gunzipText } from "./bun-utils.ts";
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

  const raw = readBytes(logPath);
  writeBytes(archivePath, gzipBytes(raw));
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

    appendText(logPath, `${JSON.stringify(line)}\n`);
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
        const raw = gunzipText(compressed);
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

/** Parse raw JSONL text into entries (shared by live-log and archive readers). */
function readLogLines(raw: string): HandoffLogEntry[] {
  const lines = raw.trim().split("\n").filter(Boolean);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line) as HandoffLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is HandoffLogEntry => e !== null);
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
