/**
 * effect/cli-runtime.ts — Unified CLI exit handling via Effect.
 */

import { Effect, Exit } from "effect";
import { join } from "path";
import { createLogger, type Logger } from "../logger.ts";
import { CliError } from "./errors.ts";
import { varDir } from "../paths.ts";
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
    const telemetryPath = join(varDir(), "cli-telemetry.jsonl");
    yield* Effect.tryPromise({
      try: () => logger.flushToFile(telemetryPath),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.catchAll(() => Effect.void));
  });
}

/** Run an Effect program as a CLI main, mapping failures to exit codes. */
export async function runCli<A>(
  program: Effect.Effect<A, CliError | unknown>,
  options: RunCliOptions
): Promise<number> {
  const logger = resolveLogger(options);

  try {
    const exit = await Effect.runPromiseExit(program);

    if (Exit.isSuccess(exit)) {
      return 0;
    }

    const failure = exit.cause;
    if (failure._tag === "Fail") {
      const error = failure.error;
      if (error instanceof CliError) {
        logger.error(error.message);
        return error.exitCode ?? 1;
      }
      logger.error(error instanceof Error ? error.message : String(error));
    } else {
      logger.error("Unexpected CLI failure");
    }
    return 1;
  } finally {
    await Effect.runPromise(flushTelemetry(logger));
  }
}

/** Run a CLI whose success value is the process exit code (non-zero is not an error). */
export async function runCliExit(
  program: Effect.Effect<number, CliError | unknown>,
  options: RunCliOptions
): Promise<number> {
  const logger = resolveLogger(options);

  try {
    const exit = await Effect.runPromiseExit(program);

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    const failure = exit.cause;
    if (failure._tag === "Fail") {
      const error = failure.error;
      if (error instanceof CliError) {
        logger.error(error.message);
        return error.exitCode ?? 1;
      }
      logger.error(error instanceof Error ? error.message : String(error));
    } else {
      logger.error("Unexpected CLI failure");
    }
    return 1;
  } finally {
    await Effect.runPromise(flushTelemetry(logger));
  }
}
