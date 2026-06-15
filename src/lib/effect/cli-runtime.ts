/**
 * effect/cli-runtime.ts — Unified CLI exit handling via Effect.
 */

import { Effect, Exit } from "effect";
import { join } from "path";
import { createLogger, type Logger } from "../logger.ts";
import { CliError } from "./errors.ts";
import { homeDir } from "../paths.ts";

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
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
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

  const exit = await Effect.runPromiseExit(runWithTelemetry(program, logger));

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
}

/** Run a CLI whose success value is the process exit code (non-zero is not an error). */
export async function runCliExit(
  program: Effect.Effect<number, CliError | unknown>,
  options: RunCliOptions
): Promise<number> {
  const logger = resolveLogger(options);

  const exit = await Effect.runPromiseExit(runWithTelemetry(program, logger));

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
}

/** Wrap a sync/async main function in Effect for runCli. */
export function cliMain(
  fn: (logger: Logger) => Promise<number> | number
): Effect.Effect<number, CliError> {
  return Effect.gen(function* () {
    const logger = createLogger(Bun.argv);
    const code = yield* Effect.tryPromise({
      try: () => Promise.resolve(fn(logger)),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    });
    if (code !== 0) {
      return yield* Effect.fail(new CliError({ message: "Command failed", exitCode: code }));
    }
    return code;
  });
}
