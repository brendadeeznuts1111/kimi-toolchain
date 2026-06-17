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

import { appendText, makeDir } from "./bun-io.ts";

import type { HealthCheck, HealthReport } from "./health-check.ts";
import { statusIcon as healthStatusIcon, aggregateChecks } from "./health-check.ts";
import { isAgentContext } from "./tool-runner.ts";
import { ensureQuietEnv, isQuietMode } from "./quiet-mode.ts";
import { getStepBudgetStatus } from "./step-budget.ts";
import { inspectAgent } from "./inspect.ts";

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
  /**
   * Buffer entries without writing to console.
   * Useful when another writer (e.g. cli-contract) owns stdout/stderr.
   */
  bufferOnly?: boolean;
  /**
   * Route human-readable output to stderr instead of stdout.
   * JSON output still goes to stdout when json is true.
   */
  humanStderr?: boolean;
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
  private bufferOnly: boolean;
  private humanStderr: boolean;
  private logs: LogEntry[] = [];

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.json = options.json ?? false;
    this.quiet = options.quiet ?? false;
    this.tool = options.tool ?? "kimi-toolchain";
    this.stepBudget = options.stepBudget ?? false;
    this.sessionId = options.sessionId ?? resolveSessionId();
    this.bufferOnly = options.bufferOnly ?? false;
    this.humanStderr = options.humanStderr ?? false;
  }

  private shouldEmit(level: LogLevel): boolean {
    if (this.quiet && level !== "error") return false;
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private pushEntry(entry: LogEntry): void {
    this.logs.push(entry);
  }

  private emitEntry(entry: LogEntry): void {
    // Buffer for telemetry even when quiet mode suppresses console output.
    if (LEVEL_PRIORITY[entry.level] >= LEVEL_PRIORITY[this.level]) {
      this.pushEntry(entry);
    }
    if (!this.shouldEmit(entry.level)) return;

    if (this.bufferOnly) return;

    if (this.json) {
      console.log(inspectAgent(entry));
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
    const line = `${prefix} ${entry.message}`;

    if (this.humanStderr) {
      if (entry.level === "warn") console.warn(line);
      else console.error(line);
    } else {
      console.log(line);
    }

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
    };
  }

  private emit(level: LogLevel, message: string): void {
    this.emitEntry(this.baseEntry(level, message));
  }

  /** Emit a human-only line to stdout or stderr depending on configuration. */
  private out(line: string): void {
    if (this.humanStderr) console.error(line);
    else console.log(line);
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
      if (this.shouldEmit(level)) console.log(inspectAgent(entry));
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
    this.out(`  ${icon} ${message}`);
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
      console.log(inspectAgent(entry));
      return;
    }

    if (isAgentContext()) {
      console.log(`  → ${suggestion}${autoFix ? ` (fix: ${autoFix})` : ""}`);
      return;
    }

    this.out(`  💡 ${suggestion}`);
    if (autoFix) this.out(`     autoFix: ${autoFix}`);
  }

  /** Log a structured result from a sub-tool invocation. */
  result(name: string, status: "ok" | "warn" | "error", message: string): void {
    this.check({ name, status, message, fixable: false });
  }

  /** Print a section header (suppressed in agent context). */
  section(title: string): void {
    if (isAgentContext() || this.quiet || this.json) return;
    const width = 60;
    this.out("");
    this.out(`── ${title} ${"─".repeat(Math.max(0, width - title.length))}`);
  }

  /** Raw stdout line (help text, tables). Suppressed in agent/quiet/json modes. */
  line(msg: string): void {
    if (isAgentContext() || this.quiet || this.json) return;
    this.out(msg);
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
    this.out(`╔${bar}╗`);
    this.out(`║ ${" ".repeat(left)}${title}${" ".repeat(right)} ║`);
    if (subtitle) {
      const subPad = Math.max(0, innerWidth - subtitle.length);
      const subLeft = Math.floor(subPad / 2);
      const subRight = subPad - subLeft;
      this.out(`║ ${" ".repeat(subLeft)}${subtitle}${" ".repeat(subRight)} ║`);
    }
    this.out(`╚${bar}╝`);
  }

  /** Get all logged entries for testing/telemetry. */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /** Append logs as JSONL for persistent telemetry (matches tool-failures.jsonl semantics). */
  async flushToFile(path: string): Promise<void> {
    if (this.logs.length === 0) return;
    const { dirname } = await import("path");
    const dir = dirname(path);
    makeDir(dir, { recursive: true });
    const lines = this.logs.map((l) => JSON.stringify(l)).join("\n") + "\n";
    appendText(path, lines);
  }
}

/** Create a logger instance from CLI argv flags. */
export function createLogger(argv: string[], toolName?: string): Logger {
  ensureQuietEnv();
  const json = argv.includes("--json");
  const debug = argv.includes("--debug");
  const quiet = (argv.includes("--quiet") || isQuietMode()) && !debug;
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
