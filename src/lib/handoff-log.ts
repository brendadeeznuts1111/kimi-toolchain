import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gzipSync } from "node:zlib";

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

const DEFAULT_LOG_DIR = join(homedir(), ".herdr", "orchestrator");
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
  mkdirSync(join(logPath, ".."), { recursive: true });
}

// ── Checksums ────────────────────────────────────────────────────────────

function sha256(data: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

// ── Rotation ─────────────────────────────────────────────────────────────

function rotateIfNeeded() {
  if (!existsSync(logPath)) return;
  const stat = statSync(logPath);
  if (stat.size < maxLogBytes) return;

  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const archiveName = `handoff-history.${now}.jsonl.gz`;
  const archivePath = join(join(logPath, ".."), archiveName);

  const raw = readFileSync(logPath);
  writeFileSync(archivePath, gzipSync(raw));
  writeFileSync(logPath, "", "utf8");
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

    appendFileSync(logPath, JSON.stringify(line) + "\n", "utf8");
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
  // Also check archives for older entries
  const allEntries = readLogFile(logPath);

  // Sort by timestamp descending, return limited
  allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return allEntries.slice(0, limit);
}

function readLogFile(path: string): HandoffLogEntry[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
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
