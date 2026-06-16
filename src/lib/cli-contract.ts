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

const TAXONOMY_ID_CLI_INVALID_FLAG = "cli_invalid_flag";

/** Error thrown when the CLI contract is violated (unknown flag, invalid value). */
export class CliContractError extends Error {
  readonly toolName: string;
  readonly taxonomyId: string;
  readonly unknownFlag?: string;
  readonly suggestions?: string[];

  constructor(options: {
    toolName: string;
    message: string;
    taxonomyId: string;
    unknownFlag?: string;
    suggestions?: string[];
  }) {
    super(options.message);
    this.name = "CliContractError";
    this.toolName = options.toolName;
    this.taxonomyId = options.taxonomyId;
    this.unknownFlag = options.unknownFlag;
    this.suggestions = options.suggestions;
  }
}

/** Machine-readable output schema version. Bump only on breaking envelope changes. */
export const CLI_OUTPUT_SCHEMA_VERSION = 1;

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

/** Compute a fuzzy flag suggestion using Levenshtein distance. */
function suggestFlag(unknown: string, candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;

  function distance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(unknown, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const threshold = Math.max(1, Math.floor(unknown.length / 2));
  return bestScore <= threshold ? best : undefined;
}

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
  let timeoutProvided = false;
  const timeoutIndex = argv.indexOf("--timeout");
  if (timeoutIndex >= 0) {
    const raw = argv[timeoutIndex + 1];
    if (raw && !raw.startsWith("--")) {
      timeoutProvided = true;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        timeout = n;
      } else {
        process.stderr.write(
          `[${toolName}] Invalid --timeout value "${raw}"; expected a positive number.\n`
        );
      }
    }
  }
  if (timeout === undefined && !timeoutProvided) {
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
      const candidates = [...COMMON_FLAGS, ...allowed];
      const suggestion = suggestFlag(arg, candidates);
      const message = suggestion
        ? `Unknown flag ${arg} for ${toolName}. Did you mean ${suggestion}?`
        : `Unknown flag ${arg} for ${toolName}. Valid flags: ${candidates.join(", ")}`;
      throw new CliContractError({
        toolName,
        message,
        taxonomyId: TAXONOMY_ID_CLI_INVALID_FLAG,
        unknownFlag: arg,
        suggestions: suggestion ? [suggestion] : undefined,
      });
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
  /**
   * Emit a single JSON object on stdout with an explicit schema name.
   * The schema name is included in the output envelope alongside schemaVersion and tool.
   */
  writeJsonSchema(schemaName: string, payload: unknown): void;
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

/** Options for createMachineWriter. */
export interface CreateMachineWriterOptions {
  /** Force human-readable output to stderr even when not in JSON mode. */
  humanStderr?: boolean;
}

/** Create a writer that respects --json, --quiet, --debug, and agent context. */
export function createMachineWriter(
  flags: CliFlags,
  toolName?: string,
  options?: CreateMachineWriterOptions
): MachineWriter {
  const resolvedTool = toolName ?? "kimi-toolchain";
  const logger = new Logger({
    level: flags.debug ? "debug" : "info",
    json: false,
    quiet: flags.quiet,
    tool: toolName,
    stepBudget: flags.stepBudget,
    // Route errors to stderr only in JSON mode so stdout stays clean;
    // normal mode preserves the existing stdout contract for backward compatibility.
    humanStderr: options?.humanStderr ?? flags.json,
  });

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function buildEnvelope(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { schemaVersion: CLI_OUTPUT_SCHEMA_VERSION, tool: resolvedTool, ...extra };
  }

  function wrapJson(data: unknown, extra: Record<string, unknown> = {}): unknown {
    const meta = buildEnvelope(extra);
    if (isPlainObject(data)) {
      // Contract fields are authoritative: they overwrite any caller-provided duplicates.
      return { ...data, ...meta };
    }
    return { ...meta, data };
  }

  function writeJson(data: unknown): void {
    process.stdout.write(`${JSON.stringify(wrapJson(data))}\n`);
  }

  function writeJsonl(entries: unknown[]): void {
    for (const entry of entries) {
      writeJson(entry);
    }
  }

  function writeJsonSchema(schemaName: string, payload: unknown): void {
    writeJson({ schemaName, payload });
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
    writeJsonSchema,
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
export function createCli(
  argv: string[],
  toolName: string,
  options?: CreateMachineWriterOptions
): MachineWriter {
  const flags = parseCliFlags(argv, toolName);
  return createMachineWriter(flags, toolName, options);
}
