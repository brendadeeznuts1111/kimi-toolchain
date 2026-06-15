/**
 * logger.ts — Structured logging for kimi-toolchain CLI tools
 *
 * Supports:
 *   - Log levels: debug, info, warn, error
 *   - Agent context suppression (no decorative output when KIMI_AGENT_SESSION is set)
 *   - JSON mode (structured output for programmatic consumption)
 *   - Quiet mode (errors only)
 *   - Step-budget aware (warns when approaching max_steps)
 */

import { isAgentContext } from "./tool-runner.ts";
import { checkStepBudget } from "./step-budget.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

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
}

export class Logger {
  private level: LogLevel;
  private json: boolean;
  private quiet: boolean;
  private tool: string;
  private stepBudget: boolean;
  private logs: Array<{ level: LogLevel; message: string; timestamp: number }> = [];

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.json = options.json ?? false;
    this.quiet = options.quiet ?? false;
    this.tool = options.tool ?? "kimi-toolchain";
    this.stepBudget = options.stepBudget ?? false;
  }

  private shouldEmit(level: LogLevel): boolean {
    if (this.quiet && level !== "error") return false;
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private emit(level: LogLevel, message: string): void {
    if (!this.shouldEmit(level)) return;

    const entry = { level, message, timestamp: Date.now() };
    this.logs.push(entry);

    if (this.json) {
      console.log(JSON.stringify({ tool: this.tool, ...entry }));
      return;
    }

    // Agent context: minimal output, no decorative prefixes
    if (isAgentContext()) {
      if (level === "error") console.error(`  ✗ ${message}`);
      else if (level === "warn") console.warn(`  ⚠ ${message}`);
      // Suppress info/debug in agent context unless error/warn
      return;
    }

    // Human-readable output with icons
    const icon = level === "error" ? "✗" : level === "warn" ? "⚠" : level === "info" ? "✓" : "◦";
    const prefix = level === "error" ? "  ✗" : `  ${icon}`;
    console.log(`${prefix} ${message}`);

    if (this.stepBudget) checkStepBudget();
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

  /** Log a structured result from a sub-tool invocation. */
  result(name: string, status: "ok" | "warn" | "error", message: string): void {
    const level = status === "error" ? "error" : status === "warn" ? "warn" : "info";
    const icon = status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
    if (isAgentContext()) {
      if (status !== "ok") this.emit(level, `${name}: ${message}`);
      return;
    }
    console.log(`  ${icon} ${name}: ${message}`);
  }

  /** Print a section header (suppressed in agent context). */
  section(title: string): void {
    if (isAgentContext() || this.quiet || this.json) return;
    const width = 60;
    console.log("");
    console.log(`── ${title} ${"─".repeat(Math.max(0, width - title.length))}`);
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
  getLogs(): Array<{ level: LogLevel; message: string; timestamp: number }> {
    return [...this.logs];
  }

  /** Flush logs to a file for persistent telemetry. */
  async flushToFile(path: string): Promise<void> {
    const lines = this.logs.map((l) => JSON.stringify(l)).join("\n");
    await Bun.write(path, lines + "\n");
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
  });
}

/** Global convenience logger (default config). */
export const logger = new Logger();

/** Re-export for backward compatibility. */
export function log(level: "info" | "warn" | "error", msg: string): void {
  logger[level](msg);
}

export function statusIcon(status: "ok" | "warn" | "error"): string {
  return status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
}
