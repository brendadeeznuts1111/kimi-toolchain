import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────

export interface HandoffLogEntry {
  timestamp: string;
  rule: number;
  action: "handoff" | "spawn" | "spawn-fallback" | "error" | "dry-run" | "skip";
  fromAgent?: string;
  fromWorkspace?: string;
  fromHost?: string;
  toAgent?: string;
  toWorkspace?: string;
  toHost?: string;
  condition?: string;
  detail: string;
  ok: boolean;
}

// ── Paths ────────────────────────────────────────────────────────────────

const DEFAULT_LOG_DIR = join(homedir(), ".herdr", "orchestrator");
const DEFAULT_LOG_PATH = join(DEFAULT_LOG_DIR, "handoff-log.jsonl");

let logPath = DEFAULT_LOG_PATH;
let enabled = true;

export function configureHandoffLog(options: { path?: string; enabled?: boolean }) {
  if (options.path) logPath = options.path;
  if (options.enabled !== undefined) enabled = options.enabled;
}

function ensureLogDir() {
  const dir = join(logPath, "..");
  mkdirSync(dir, { recursive: true });
}

// ── Write ────────────────────────────────────────────────────────────────

export function logHandoff(entry: HandoffLogEntry) {
  if (!enabled) return;
  try {
    ensureLogDir();
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Silent failure — logging is best-effort
  }
}

// ── Read ────────────────────────────────────────────────────────────────

export function getHandoffHistory(limit = 20): HandoffLogEntry[] {
  if (!existsSync(logPath)) return [];
  try {
    const raw = readFileSync(logPath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as HandoffLogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is HandoffLogEntry => e !== null);
    // Most recent first
    entries.reverse();
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}

export function getHandoffLogPath(): string {
  return logPath;
}
