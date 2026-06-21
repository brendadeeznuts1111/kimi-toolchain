/**
 * logger.ts — Structured logging for kimi-toolchain CLI tools
 *
 * Supports:
 *   - Log levels: debug, info, warn, error
 *   - Agent context suppression (no decorative output when KIMI_AGENT_SESSION is set)
 *   - JSON mode (structured output for programmatic consumption)
 *   - Quiet mode (errors only)
 *   - Step-budget aware (warns when approaching max_steps)
 *   - Health check and taxonomy suggestion emission
 */

import type { HealthCheck, HealthReport } from "./health-check.ts";
import { statusIcon as healthStatusIcon, aggregateChecks } from "./health-check.ts";
import { appendText, makeDir } from "./bun-io.ts";
import { inspectAgent } from "./inspect.ts";
import { isAgentContext } from "./tool-runner.ts";
import { getStepBudgetStatus } from "./step-budget.ts";
import { nowNanos } from "./bun-utils.ts";

function writeJsonLine(value: unknown): void {
  process.stdout.write(`${inspectAgent(value)}\n`);
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export const LOG_SCHEMA_VERSION = 1;

export interface LogEntry {
  schemaVersion: number;
  tool: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  sessionId?: string;
  check?: HealthCheck;
  taxonomyId?: string;
  suggestion?: string;
  autoFix?: string;
  /** Elapsed duration in milliseconds (set by time/timeEnd). */
  durationMs?: number;
  /** Error name (e.g. TypeError, SyntaxError). */
  errorName?: string;
  /** Error stack trace. */
  errorStack?: string;
  /** Arbitrary structured context fields attached to the entry. */
  fields?: Record<string, unknown>;
  /** Causal trace correlation id (links to TraceEvent in trace-ledger). */
  traceId?: string;
  /** Span id for sub-operation correlation within a trace. */
  spanId?: string;
}

export interface LoggerOptions {
  /** Minimum level to emit. Default "info". */
  level?: LogLevel;
  /** Output structured JSON instead of human-readable text. */
  json?: boolean;
  /** Suppress all non-error output. */
  quiet?: boolean;
  /** Tool name prefix for JSON output. */
  tool?: string;
  /** Enable step-budget checks after each log. */
  stepBudget?: boolean;
  /** Session id from env for correlation. */
  sessionId?: string;
  /** When true, route human-readable lines to stderr instead of stdout. */
  humanStderr?: boolean;
  /** Persistent context fields merged into every LogEntry produced by this logger. */
  fields?: Record<string, unknown>;
  /** Causal trace id propagated to every entry (e.g. from an active TraceEvent). */
  traceId?: string;
  /** Span id propagated to every entry. */
  spanId?: string;
}

function resolveSessionId(): string | undefined {
  return Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined;
}

export class Logger {
  private level: LogLevel;
  private json: boolean;
  private quiet: boolean;
  private tool: string;
  private stepBudget: boolean;
  private sessionId: string | undefined;
  private humanStderr: boolean;
  private logs: LogEntry[] = [];
  private fields: Record<string, unknown> | undefined;
  private traceId: string | undefined;
  private spanId: string | undefined;
  /** Active performance timers keyed by label. Stores nowNanos() (Bun.nanoseconds()) start values. */
  private timers = new Map<string, number>();

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.json = options.json ?? false;
    this.quiet = options.quiet ?? false;
    this.tool = options.tool ?? "kimi-toolchain";
    this.stepBudget = options.stepBudget ?? false;
    this.sessionId = options.sessionId ?? resolveSessionId();
    this.humanStderr = options.humanStderr ?? false;
    this.fields = options.fields;
    this.traceId = options.traceId;
    this.spanId = options.spanId;
  }

  /**
   * Return a child logger that inherits this logger's config and merges additional
   * context fields / trace ids. Child logs are buffered independently but share
   * the same output mode.
   */
  child(overrides: Partial<LoggerOptions> & { fields?: Record<string, unknown> }): Logger {
    const { fields: overrideFields, ...rest } = overrides;
    return new Logger({
      level: this.level,
      json: this.json,
      quiet: this.quiet,
      stepBudget: this.stepBudget,
      humanStderr: this.humanStderr,
      tool: this.tool,
      sessionId: this.sessionId,
      traceId: this.traceId,
      spanId: this.spanId,
      ...rest,
      fields: { ...this.fields, ...overrideFields },
    });
  }

  private shouldEmit(level: LogLevel): boolean {
    if (this.quiet && level !== "error") return false;
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private pushEntry(entry: LogEntry): void {
    this.logs.push(entry);
  }

  private emitEntry(entry: LogEntry): void {
    if (!this.shouldEmit(entry.level)) return;
    this.pushEntry(entry);

    if (this.json) {
      writeJsonLine(entry);
      return;
    }

    if (this.humanStderr) {
      if (entry.level === "error") console.error(`  ✗ ${entry.message}`);
      else if (entry.level === "warn") console.warn(`  ⚠ ${entry.message}`);
      return;
    }

    if (isAgentContext()) {
      if (entry.level === "error") console.error(`  ✗ ${entry.message}`);
      else if (entry.level === "warn") console.warn(`  ⚠ ${entry.message}`);
      return;
    }

    const icon =
      entry.level === "error"
        ? "✗"
        : entry.level === "warn"
          ? "⚠"
          : entry.level === "info"
            ? "✓"
            : "◦";
    const prefix = entry.level === "error" ? "  ✗" : `  ${icon}`;
    console.log(`${prefix} ${entry.message}`);

    if (this.stepBudget) this.emitStepBudgetWarning();
  }

  private baseEntry(level: LogLevel, message: string): LogEntry {
    return {
      schemaVersion: LOG_SCHEMA_VERSION,
      tool: this.tool,
      level,
      message,
      timestamp: Date.now(),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.fields && Object.keys(this.fields).length > 0 ? { fields: { ...this.fields } } : {}),
      ...(this.traceId ? { traceId: this.traceId } : {}),
      ...(this.spanId ? { spanId: this.spanId } : {}),
    };
  }

  private emit(level: LogLevel, message: string): void {
    this.emitEntry(this.baseEntry(level, message));
  }

  /** Emit step-budget warning through logger instead of raw console. */
  emitStepBudgetWarning(): boolean {
    const { status, message } = getStepBudgetStatus();
    if (status === "ok") return false;
    const level = status === "critical" ? "error" : "warn";
    this.emitEntry(this.baseEntry(level, message));
    return status === "critical";
  }

  debug(msg: string): void {
    this.emit("debug", msg);
  }
  info(msg: string): void {
    this.emit("info", msg);
  }
  warn(msg: string): void {
    this.emit("warn", msg);
  }
  error(msg: string): void {
    this.emit("error", msg);
  }

  /**
   * Log an Error object at "error" level, capturing name, message, and stack.
   * Extra fields can be merged alongside the entry.
   */
  errorObj(err: unknown, extraFields?: Record<string, unknown>): void {
    let message: string;
    let errorName: string | undefined;
    let errorStack: string | undefined;

    if (err instanceof Error) {
      message = err.message || String(err);
      errorName = err.name;
      errorStack = err.stack;
    } else if (typeof err === "string") {
      message = err;
    } else {
      message = Bun.inspect(err);
    }

    const entry: LogEntry = {
      ...this.baseEntry("error", message),
      ...(errorName ? { errorName } : {}),
      ...(errorStack ? { errorStack } : {}),
      ...(extraFields ? { fields: { ...this.fields, ...extraFields } } : {}),
    };
    this.emitEntry(entry);
  }

  /**
   * Start a named performance timer using nowNanos() (Bun.nanoseconds()).
   * Call timeEnd(label) to emit an entry with sub-millisecond durationMs.
   */
  time(label: string): void {
    this.timers.set(label, nowNanos());
  }

  /**
   * Stop a named performance timer and emit an entry with durationMs.
   * Uses nowNanos() (Bun.nanoseconds()) for sub-millisecond precision (ns / 1_000_000 = ms).
   * Returns the elapsed milliseconds, or -1 if the timer was never started.
   */
  timeEnd(label: string, level: LogLevel = "debug"): number {
    const start = this.timers.get(label);
    if (start === undefined) {
      this.warn(`timeEnd called for unknown timer "${label}"`);
      return -1;
    }
    this.timers.delete(label);
    const durationMs = (nowNanos() - start) / 1_000_000;
    const entry: LogEntry = {
      ...this.baseEntry(level, `${label}: ${durationMs.toFixed(3)}ms`),
      durationMs,
    };
    this.emitEntry(entry);
    return durationMs;
  }

  /** Log a structured health check result. */
  check(result: HealthCheck): void {
    const level = result.status === "error" ? "error" : result.status === "warn" ? "warn" : "info";
    const fixTag = result.fixable ? " [fixable]" : "";
    const message = `${result.name}: ${result.message}${fixTag}`;
    const entry: LogEntry = {
      ...this.baseEntry(level, message),
      check: result,
      ...(result.category ? { taxonomyId: result.category } : {}),
      ...(result.autoFix ? { autoFix: result.autoFix } : {}),
    };

    // Always buffer for telemetry (even when agent context suppresses console output).
    this.pushEntry(entry);

    if (this.json) {
      if (this.shouldEmit(level)) writeJsonLine(entry);
      return;
    }

    if (isAgentContext()) {
      if (result.status === "error" && this.shouldEmit("error")) {
        console.error(`  ✗ ${message}`);
      } else if (result.status === "warn" && this.shouldEmit("warn")) {
        console.warn(`  ⚠ ${message}`);
      }
      return;
    }

    if (!this.shouldEmit(level)) return;

    const icon = healthStatusIcon(result.status);
    console.log(`  ${icon} ${message}`);
  }

  /** Log a taxonomy-linked suggestion with optional autoFix command. */
  suggest(taxonomyId: string, suggestion: string, autoFix?: string): void {
    const entry: LogEntry = {
      ...this.baseEntry("info", suggestion),
      taxonomyId,
      suggestion,
      ...(autoFix ? { autoFix } : {}),
    };
    if (!this.shouldEmit("info")) return;
    this.pushEntry(entry);

    if (this.json) {
      writeJsonLine(entry);
      return;
    }

    if (isAgentContext()) {
      console.log(`  → ${suggestion}${autoFix ? ` (fix: ${autoFix})` : ""}`);
      return;
    }

    console.log(`  💡 ${suggestion}`);
    if (autoFix) console.log(`     autoFix: ${autoFix}`);
  }

  /** Log a structured result from a sub-tool invocation. */
  result(name: string, status: "ok" | "warn" | "error", message: string): void {
    this.check({ name, status, message, fixable: false });
  }

  /** Print a section header (suppressed in agent context). */
  section(title: string): void {
    if (isAgentContext() || this.quiet || this.json) return;
    const width = 60;
    console.log("");
    console.log(`── ${title} ${"─".repeat(Math.max(0, width - title.length))}`);
  }

  /** Raw stdout line (help text, tables). Suppressed in agent/quiet/json modes. */
  line(msg: string): void {
    if (isAgentContext() || this.quiet || this.json) return;
    console.log(msg);
  }

  /** Print a full doctor/health report with section, checks, and summary counts. */
  printHealthReport(report: HealthReport, sectionTitle?: string): void {
    this.section(sectionTitle ?? `${report.tool} Doctor`);
    for (const check of report.checks) {
      this.check(check);
    }
    this.info(
      `${report.errorCount} error(s), ${report.warnCount} warning(s), ${report.fixableCount} fixable`
    );
  }

  /**
   * Aggregate checks, print the health report, and return exit code (1 if errors).
   * Convenience wrapper over aggregateChecks + printHealthReport used by every tool's doctor command.
   */
  runDoctor(tool: string, checks: HealthCheck[], sectionTitle?: string, fixHint?: string): number {
    const report = aggregateChecks(tool, checks);
    this.printHealthReport(report, sectionTitle);
    if (checks.some((c) => c.fixable)) {
      this.info(fixHint ?? `Run '${tool} fix' to repair`);
    }
    return report.errorCount > 0 ? 1 : 0;
  }

  /** Print a project banner with optional project name and subtitle. */
  projectBanner(title: string, project?: string, subtitle?: string): void {
    this.banner(title, subtitle);
    if (project) this.info(`Project: ${project}`);
    this.line("");
  }

  /** Print a banner (suppressed in agent context). */
  banner(title: string, subtitle?: string): void {
    if (isAgentContext() || this.quiet || this.json) return;
    const innerWidth = 62;
    const pad = Math.max(0, innerWidth - title.length);
    const left = Math.floor(pad / 2);
    const right = pad - left;
    const bar = "═".repeat(innerWidth + 2);
    console.log(`╔${bar}╗`);
    console.log(`║ ${" ".repeat(left)}${title}${" ".repeat(right)} ║`);
    if (subtitle) {
      const subPad = Math.max(0, innerWidth - subtitle.length);
      const subLeft = Math.floor(subPad / 2);
      const subRight = subPad - subLeft;
      console.log(`║ ${" ".repeat(subLeft)}${subtitle}${" ".repeat(subRight)} ║`);
    }
    console.log(`╚${bar}╝`);
  }

  /** Get all logged entries for testing/telemetry. */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /** Append logs as JSONL for persistent telemetry (matches tool-failures.jsonl semantics). */
  async flushToFile(path: string): Promise<void> {
    if (this.logs.length === 0) return;
    const { dirname } = await import("path");
    makeDir(dirname(path), { recursive: true });
    const lines = this.logs.map((l) => inspectAgent(l)).join("\n") + "\n";
    appendText(path, lines);
  }
}

/** Create a logger instance from CLI argv flags. */
export function createLogger(argv: string[], toolName?: string): Logger {
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet");
  const debug = argv.includes("--debug");
  const stepBudget = argv.includes("--step-budget");
  return new Logger({
    level: debug ? "debug" : "info",
    json,
    quiet,
    tool: toolName,
    stepBudget,
    sessionId: resolveSessionId(),
  });
}

/** Global convenience logger (default config). */
export const logger = new Logger();

/** Re-export for backward compatibility. */
export function log(level: "info" | "warn" | "error", msg: string): void {
  logger[level](msg);
}

export function statusIcon(status: "ok" | "warn" | "error"): string {
  return healthStatusIcon(status);
}
