/**
 * effect/cli-runtime.ts — Unified CLI exit handling via Effect.
 */

import { Effect, Exit } from "effect";
import { join } from "path";
import { createLogger, type Logger } from "../logger.ts";
import { CliError } from "./errors.ts";
import { homeDir } from "../paths.ts";
import { ensureProcessTrace } from "./trace-context.ts";
import { buildTraceEvent, recordTraceEvent } from "../trace-ledger.ts";

export interface RunCliOptions {
  toolName: string;
  argv?: string[];
  /** Logger instance to use for errors and telemetry flush (must match module logger). */
  logger?: Logger;
}

function resolveLogger(options: RunCliOptions): Logger {
  const argv = options.argv ?? Bun.argv;
  return options.logger ?? createLogger(argv, options.toolName);
}

function telemetryEnabled(): boolean {
  return Bun.env.KIMI_TOOLCHAIN_TELEMETRY === "true";
}

/** Append structured logs to cli-telemetry.jsonl when KIMI_TOOLCHAIN_TELEMETRY=true. */
function flushTelemetry(logger: Logger): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!telemetryEnabled()) return;
    if (logger.getLogs().length === 0) return;
    const telemetryPath = join(homeDir(), ".kimi-code", "var", "cli-telemetry.jsonl");
    yield* Effect.tryPromise({
      try: () => logger.flushToFile(telemetryPath),
      catch: (cause) => (cause instanceof Error ? cause : new Error(Bun.inspect(cause))),
    }).pipe(Effect.catchAll(() => Effect.void));
  });
}

function runWithTelemetry<A, E>(program: Effect.Effect<A, E>, logger: Logger): Effect.Effect<A, E> {
  return program.pipe(Effect.ensuring(flushTelemetry(logger)));
}

/** Run an Effect program as a CLI main, mapping failures to exit codes. */
export async function runCli<A>(
  program: Effect.Effect<A, CliError | unknown>,
  options: RunCliOptions
): Promise<number> {
  const logger = resolveLogger(options);
  const trace = ensureProcessTrace();
  const started = Date.now();

  const exit = await Effect.runPromiseExit(runWithTelemetry(program, logger));

  if (Exit.isSuccess(exit)) {
    await recordCliTrace(options.toolName, trace, started, 0);
    return 0;
  }

  const failure = exit.cause;
  if (failure._tag === "Fail") {
    const error = failure.error;
    if (error instanceof CliError) {
      logger.error(error.message);
      const exitCode = error.exitCode ?? 1;
      await recordCliTrace(options.toolName, trace, started, exitCode, error.message);
      return exitCode;
    }
    logger.error(error instanceof Error ? error.message : Bun.inspect(error));
    await recordCliTrace(options.toolName, trace, started, 1, String(error));
  } else {
    logger.error("Unexpected CLI failure");
    await recordCliTrace(options.toolName, trace, started, 1, "Unexpected CLI failure");
  }
  return 1;
}

/** Run a CLI whose success value is the process exit code (non-zero is not an error). */
export async function runCliExit(
  program: Effect.Effect<number, CliError | unknown>,
  options: RunCliOptions
): Promise<number> {
  const logger = resolveLogger(options);
  const trace = ensureProcessTrace();
  const started = Date.now();

  const exit = await Effect.runPromiseExit(runWithTelemetry(program, logger));

  if (Exit.isSuccess(exit)) {
    await recordCliTrace(options.toolName, trace, started, exit.value);
    return exit.value;
  }

  const failure = exit.cause;
  if (failure._tag === "Fail") {
    const error = failure.error;
    if (error instanceof CliError) {
      logger.error(error.message);
      const exitCode = error.exitCode ?? 1;
      await recordCliTrace(options.toolName, trace, started, exitCode, error.message);
      return exitCode;
    }
    logger.error(error instanceof Error ? error.message : Bun.inspect(error));
    await recordCliTrace(options.toolName, trace, started, 1, String(error));
  } else {
    logger.error("Unexpected CLI failure");
    await recordCliTrace(options.toolName, trace, started, 1, "Unexpected CLI failure");
  }
  return 1;
}

async function recordCliTrace(
  toolName: string,
  trace: ReturnType<typeof ensureProcessTrace>,
  started: number,
  exitCode: number,
  error?: string
): Promise<void> {
  const ended = Date.now();
  try {
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        parentTraceId: trace.parentTraceId,
        eventType: "cli",
        tool: toolName,
        command: Bun.argv.slice(1),
        cwd: Bun.cwd,
        status: exitCode === 0 ? "ok" : "error",
        startedAt: trace.startedAt,
        endedAt: new Date(ended).toISOString(),
        durationMs: ended - started,
        ...(error ? { error } : {}),
      })
    );
  } catch {
    // Tracing must never change CLI exit behavior.
  }
}
