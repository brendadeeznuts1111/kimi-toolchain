/**
 * effect/cli-runtime.ts — Unified CLI exit handling via Effect.
 */

import { Effect, Exit } from "effect";
import { createLogger, type Logger } from "../logger.ts";
import { CliError } from "./errors.ts";
import { telemetryEnabled, ToolchainConfigLive } from "./config.ts";
import { join } from "path";

export interface RunCliOptions {
  toolName: string;
  argv?: string[];
}

/** Run an Effect program as a CLI main, mapping failures to exit codes. */
export async function runCli<A>(
  program: Effect.Effect<A, CliError | unknown>,
  options: RunCliOptions
): Promise<number> {
  const argv = options.argv ?? Bun.argv;
  const logger = createLogger(argv, options.toolName);

  const exit = await Effect.runPromiseExit(
    program.pipe(
      Effect.tap(() =>
        Effect.gen(function* () {
          const telemetry = yield* telemetryEnabled;
          if (!telemetry) return;
          const config = yield* ToolchainConfigLive;
          const telemetryPath = join(config.home, ".kimi-code", "var", "cli-telemetry.jsonl");
          yield* Effect.tryPromise({
            try: () => logger.flushToFile(telemetryPath),
            catch: () => undefined,
          });
        })
      )
    )
  );

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
