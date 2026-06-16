/**
 * cli-contract.ts — Shared CLI argument parsing and output contract for kimi-* tools.
 *
 * Design goals (inspired by Bun v1.3.13's machine-readable test output):
 *   - Common flags are parsed once and consistently across tools.
 *   - Every common flag has a KIMI_* environment-variable fallback.
 *   - In --json mode stdout is exclusively structured JSON/JSONL.
 *   - Human-readable status lines go to stderr so agents can pipe stdout safely.
 *   - Existing createLogger-based tools remain backward-compatible.
 */

import { Logger, type LogLevel } from "./logger.ts";
import { isQuietMode } from "./quiet-mode.ts";

/** Common flags supported by every kimi-* tool. */
export interface CliFlags {
  /** Emit structured JSON/JSONL on stdout. */
  json: boolean;
  /** Suppress non-error human output. */
  quiet: boolean;
  /** Enable debug-level logging. */
  debug: boolean;
  /** Millisecond timeout for long-running operations. */
  timeout?: number;
  /** Stop on first error. */
  bail: boolean;
  /** Enable step-budget warnings. */
  stepBudget: boolean;
  /** Tool-specific positional arguments (everything after flags). */
  positional: string[];
}

/** Options for parseCliFlags. */
export interface ParseCliFlagsOptions {
  /** Reject unknown --flags when true. */
  strict?: boolean;
  /** Additional tool-specific flags allowed when strict is true. */
  allowedFlags?: string[];
}

const COMMON_FLAGS = new Set([
  "--json",
  "--quiet",
  "--debug",
  "--timeout",
  "--bail",
  "--step-budget",
]);

/** Read a boolean-ish environment variable. */
function envBool(name: string): boolean {
  const value = Bun.env[name];
  return value === "1" || value === "true";
}

/** Parse a positive integer env var, returning undefined if missing/invalid. */
function envMs(name: string): number | undefined {
  const value = Bun.env[name];
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse common CLI flags from argv with KIMI_* environment fallbacks.
 *
 * Returns the parsed flags plus any positional arguments. Tool-specific flags
 * can still be handled from `positional` or by passing `allowedFlags`.
 */
export function parseCliFlags(
  argv: string[],
  toolName: string,
  options: ParseCliFlagsOptions = {}
): CliFlags {
  const allowed = new Set(options.allowedFlags ?? []);

  let json = argv.includes("--json") || envBool("KIMI_JSON");
  let quiet = argv.includes("--quiet") || envBool("KIMI_QUIET") || isQuietMode();
  let debug = argv.includes("--debug") || envBool("KIMI_DEBUG");
  let bail = argv.includes("--bail") || envBool("KIMI_BAIL");
  let stepBudget = argv.includes("--step-budget") || envBool("KIMI_STEP_BUDGET");

  let timeout: number | undefined;
  const timeoutIndex = argv.indexOf("--timeout");
  if (timeoutIndex >= 0) {
    const raw = argv[timeoutIndex + 1];
    if (raw && !raw.startsWith("--")) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) timeout = n;
    }
  }
  if (timeout === undefined) {
    timeout = envMs("KIMI_TIMEOUT_MS");
  }

  if (json && !quiet) {
    // JSON mode implies quiet for human status lines; errors still surface on stderr.
    quiet = true;
  }

  const positional: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    if (COMMON_FLAGS.has(arg)) {
      if (arg === "--timeout") i++;
      continue;
    }

    if (options.strict && !allowed.has(arg)) {
      throw new Error(`Unknown flag ${arg} for ${toolName}`);
    }

    // Allow tool-specific flags to pass through to positional so callers can
    // re-parse them. Skip their values if the next token is not another flag.
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      positional.push(arg, next);
      i++;
    } else {
      positional.push(arg);
    }
  }

  return { json, quiet, debug, timeout, bail, stepBudget, positional };
}

/** Writer that separates machine output (stdout) from human output (stderr). */
export interface MachineWriter {
  /** Emit a single JSON object on stdout. */
  writeJson(data: unknown): void;
  /** Emit multiple JSON objects as JSONL on stdout. */
  writeJsonl(entries: unknown[]): void;
  /** Emit a human-readable line on stderr (suppressed in json/quiet/agent modes). */
  writeHuman(level: LogLevel, message: string): void;
  /** Convenience wrappers. */
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  /** Backing logger for telemetry and backward compatibility. */
  logger: Logger;
  /** Parsed flags. */
  flags: Readonly<CliFlags>;
}

/** Create a writer that respects --json, --quiet, --debug, and agent context. */
export function createMachineWriter(flags: CliFlags, toolName?: string): MachineWriter {
  const logger = new Logger({
    level: flags.debug ? "debug" : "info",
    json: false,
    quiet: flags.quiet,
    tool: toolName,
    stepBudget: flags.stepBudget,
    // Route errors to stderr only in JSON mode so stdout stays clean;
    // normal mode preserves the existing stdout contract for backward compatibility.
    humanStderr: flags.json,
  });

  function writeJson(data: unknown): void {
    process.stdout.write(`${JSON.stringify(data)}\n`);
  }

  function writeJsonl(entries: unknown[]): void {
    for (const entry of entries) {
      writeJson(entry);
    }
  }

  function writeHuman(level: LogLevel, message: string): void {
    // Delegate to the shared logger, which routes human output to stderr and
    // buffers every entry for telemetry. JSON-mode suppression is handled by
    // the logger's quiet flag.
    logger[level](message);
  }

  return {
    writeJson,
    writeJsonl,
    writeHuman,
    info: (message) => writeHuman("info", message),
    warn: (message) => writeHuman("warn", message),
    error: (message) => writeHuman("error", message),
    debug: (message) => writeHuman("debug", message),
    logger,
    flags,
  };
}

/** Convenience: parse argv and create writer in one call. */
export function createCli(argv: string[], toolName: string): MachineWriter {
  const flags = parseCliFlags(argv, toolName);
  return createMachineWriter(flags, toolName);
}
