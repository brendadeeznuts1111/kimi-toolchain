/**
 * health-channel.ts — Cross-process health telemetry via JSONL file.
 *
 * Tools publish lifecycle events, load metrics, and warnings to a shared
 * append-only JSONL file at ~/.kimi-code/var/health-events.jsonl.
 * Other tools (e.g., kimi-resource-governor) poll or tail the file to
 * dynamically adjust parallelism, skip redundant work, or warn about
 * system pressure.
 *
 * This uses the same pattern as tool-failures.jsonl — append-only,
 * line-delimited, no server, no sockets, no file locking beyond atomic
 * appends on local filesystems.
 */

import { bunRevision } from "./bun-utils.ts";
import { appendNdjsonRecord } from "./ndjson.ts";
import { varDir } from "./paths.ts";
import { join } from "path";

// ── File path ────────────────────────────────────────────────────────

let _filePath: string | null = null;

function filePath(): string {
  if (!_filePath) {
    _filePath = join(varDir(), "health-events.jsonl");
  }
  return _filePath;
}

/** Override file path (for testing). */
export function setFilePath(path: string): void {
  _filePath = path;
}

// ── Event types ──────────────────────────────────────────────────────

export type HealthEventKind =
  | "tool:start"
  | "tool:progress"
  | "tool:done"
  | "load"
  | "warning"
  | "result";

export interface HealthToolStart {
  kind: "tool:start";
  tool: string;
  pid: number;
  timestamp: number;
  total?: number;
}

export interface HealthToolProgress {
  kind: "tool:progress";
  tool: string;
  pid: number;
  timestamp: number;
  current: number;
  total?: number;
  message?: string;
}

export interface HealthToolDone {
  kind: "tool:done";
  tool: string;
  pid: number;
  timestamp: number;
  exitCode: number;
  durationMs: number;
  errors?: number;
}

export interface HealthLoad {
  kind: "load";
  tool: string;
  pid: number;
  timestamp: number;
  memoryBytes: number;
  cpuRatio?: number;
}

export interface HealthWarning {
  kind: "warning";
  tool: string;
  pid: number;
  timestamp: number;
  message: string;
  backoffFactor?: number;
}

export interface HealthResult {
  kind: "result";
  tool: string;
  pid: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

export type HealthEvent =
  | HealthToolStart
  | HealthToolProgress
  | HealthToolDone
  | HealthLoad
  | HealthWarning
  | HealthResult;

// ── Guards ────────────────────────────────────────────────────────────

export function isHealthEvent(value: unknown): value is HealthEvent {
  if (typeof value !== "object" || value === null) return false;
  const kinds: readonly HealthEventKind[] = [
    "tool:start",
    "tool:progress",
    "tool:done",
    "load",
    "warning",
    "result",
  ];
  return kinds.includes((value as Record<string, unknown>).kind as HealthEventKind);
}

// ── Publish ───────────────────────────────────────────────────────────

/**
 * Append a health event to the JSONL file.
 * Errors are silently ignored (e.g., permission denied in sandbox).
 */
export async function publish(event: HealthEvent): Promise<void> {
  try {
    await appendNdjsonRecord(filePath(), { ...event, bunRevision: bunRevision() });
  } catch {
    // Degrade gracefully — health channel is advisory, not critical
  }
}

// ── Subscribe (poll-based) ────────────────────────────────────────────

export type HealthHandler = (event: HealthEvent) => void;

export interface SubscribeOptions {
  /** Poll interval in ms (default 200). */
  intervalMs?: number;
  /** Only deliver events newer than this timestamp. */
  since?: number;
}

/**
 * Subscribe by polling the JSONL file. Returns an unsubscribe function.
 * Only events that pass `isHealthEvent` are delivered.
 * Errors in the handler are caught to prevent cascading failures.
 */
export function subscribe(handler: HealthHandler, options: SubscribeOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? 200;
  let lastPos = 0;
  let running = true;

  const poll = async () => {
    if (!running) return;
    try {
      const file = Bun.file(filePath());
      if (!(await file.exists())) return;
      const text = await file.text();
      if (text.length <= lastPos) return;

      const newText = text.slice(lastPos);
      lastPos = text.length;

      for (const line of newText.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (isHealthEvent(parsed)) {
            handler(parsed);
          }
        } catch {
          // Malformed line — skip
        }
      }
    } catch {
      // File may not exist yet — retry next poll
    }
    if (running) setTimeout(poll, intervalMs);
  };

  // Start polling after a tick
  setTimeout(poll, 0);

  return () => {
    running = false;
  };
}

/**
 * Subscribe to a filtered subset of health event kinds.
 */
export function subscribeTo(
  kinds: HealthEventKind[],
  handler: HealthHandler,
  options?: SubscribeOptions
): () => void {
  return subscribe((event) => {
    if (kinds.includes(event.kind)) {
      handler(event);
    }
  }, options);
}

// ── Convenience publishers ────────────────────────────────────────────

let _pid: number | undefined;

function pid(): number {
  if (_pid === undefined) _pid = process.pid;
  return _pid;
}

let _startTimes = new Map<string, number>();

function startTime(tool: string): number {
  const now = Date.now();
  _startTimes.set(tool, now);
  return now;
}

function elapsedMs(tool: string): number {
  const start = _startTimes.get(tool);
  if (!start) return 0;
  _startTimes.delete(tool);
  return Date.now() - start;
}

/** Reset internal state (for testing). */
export function reset(): void {
  _pid = undefined;
  _startTimes = new Map();
}

export async function toolStart(tool: string, total?: number): Promise<void> {
  startTime(tool);
  return publish({
    kind: "tool:start",
    tool,
    pid: pid(),
    timestamp: Date.now(),
    total,
  });
}

export async function toolProgress(
  tool: string,
  current: number,
  total?: number,
  message?: string
): Promise<void> {
  return publish({
    kind: "tool:progress",
    tool,
    pid: pid(),
    timestamp: Date.now(),
    current,
    total,
    message,
  });
}

export async function toolDone(tool: string, exitCode: number, errors?: number): Promise<void> {
  return publish({
    kind: "tool:done",
    tool,
    pid: pid(),
    timestamp: Date.now(),
    exitCode,
    durationMs: elapsedMs(tool),
    errors,
  });
}

export async function loadReport(
  tool: string,
  memoryBytes: number,
  cpuRatio?: number
): Promise<void> {
  return publish({
    kind: "load",
    tool,
    pid: pid(),
    timestamp: Date.now(),
    memoryBytes,
    cpuRatio,
  });
}

export async function healthWarning(
  tool: string,
  message: string,
  backoffFactor?: number
): Promise<void> {
  return publish({
    kind: "warning",
    tool,
    pid: pid(),
    timestamp: Date.now(),
    message,
    backoffFactor,
  });
}

export async function healthResult(tool: string, payload: Record<string, unknown>): Promise<void> {
  return publish({
    kind: "result",
    tool,
    pid: pid(),
    timestamp: Date.now(),
    payload,
  });
}
