#!/usr/bin/env bun
/**
 * kimi-secrets — Bun.secrets policy CLI
 *
 * Usage:
 *   kimi-secrets check|list|storage|gate|doctor|rotate <service> <name> [--value <secret>] [--json]
 */

import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { createLogger } from "../lib/logger.ts";
import { parseCliFlags } from "../lib/cli-contract.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  cmdSecretsDoctor,
  cmdSecretsGate,
  cmdSecretsStorage,
  printSecretsHelp,
  secretsCheckProgram,
  secretsListProgram,
  secretsRotateProgram,
} from "../lib/secrets-cli.ts";

const logger = createLogger(Bun.argv, "kimi-secrets");

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

function secretsCliProgram(): Effect.Effect<number, CliError> {
  return Effect.gen(function* () {
    const { json } = parseCliFlags(Bun.argv, "kimi-secrets");
    const argv = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
    const command = argv[0];

    if (!command || command === "help" || command === "-h") {
      printSecretsHelp(logger);
      return command ? 0 : 1;
    }

    const projectRoot = yield* Effect.tryPromise({
      try: () => resolveProjectRoot(Bun.cwd),
      catch: (cause) =>
        new CliError({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    const opts = { projectRoot, json, logger };

    switch (command) {
      case "check":
        return yield* secretsCheckProgram(opts).pipe(
          Effect.mapError(
            (cause) =>
              new CliError({
                message: cause instanceof Error ? cause.message : String(cause),
              })
          )
        );
      case "list":
        return yield* secretsListProgram(opts);
      case "storage":
        return yield* Effect.tryPromise({
          try: () => cmdSecretsStorage(opts),
          catch: (cause) =>
            new CliError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      case "gate":
        return yield* Effect.tryPromise({
          try: () => cmdSecretsGate(opts),
          catch: (cause) =>
            new CliError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      case "doctor":
        return yield* Effect.tryPromise({
          try: () => cmdSecretsDoctor(opts),
          catch: (cause) =>
            new CliError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      case "rotate": {
        const service = argv[1];
        const name = argv[2];
        if (!service || !name) {
          return yield* Effect.fail(
            new CliError({
              message: "Usage: kimi-secrets rotate <service> <name> [--value <secret>]",
            })
          );
        }
        return yield* secretsRotateProgram(opts, service, name, argValue("--value"));
      }
      default:
        logger.error(`Unknown command: ${command}`);
        printSecretsHelp(logger);
        return 1;
    }
  });
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(secretsCliProgram(), { toolName: "kimi-secrets", logger });
  process.exit(exitCode);
}
