#!/usr/bin/env bun
/**
 * kimi-why — compatibility alias for `kimi-decision why`.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { runDecisionCli } from "./kimi-decision.ts";

const logger = createLogger(Bun.argv, "kimi-why");

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => runDecisionCli(Bun.argv.slice(2)),
      catch: (e) =>
        e instanceof CliError
          ? e
          : new CliError({ message: e instanceof Error ? e.message : String(e) }),
    }),
    { toolName: "kimi-why", logger }
  );
  process.exit(exitCode);
}
