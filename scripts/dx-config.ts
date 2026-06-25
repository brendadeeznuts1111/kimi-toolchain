#!/usr/bin/env bun
/**
 * dx:config — Resolve and inspect global + project DX config.
 *
 * Usage:
 *   bun run dx:config
 *   bun run dx:config --project .
 *   bun run dx:config --global
 *   bun run dx:config --agent-context
 *   bun run dx:config --format json
 */

import { Effect } from "effect";
import { pathExists } from "../src/lib/bun-io.ts";
import { readTomlDocument } from "../src/lib/dx-config-parse.ts";
import { runCliExit } from "../src/lib/effect/cli-runtime.ts";
import { DxConfig, DxConfigLive } from "../src/lib/effect/dx-config.ts";
import { CliError } from "../src/lib/effect/errors.ts";
import { createLogger } from "../src/lib/logger.ts";
import { globalDxConfigPath } from "../src/lib/paths.ts";
import { TOOLCHAIN_VERSION } from "../src/lib/version.ts";

const TOOL = "dx:config";
const logger = createLogger(Bun.argv, TOOL);

interface ParsedArgs {
  projectRoot: string;
  globalOnly: boolean;
  agentContext: boolean;
  format: "json" | "table";
}

function parseArgs(argv: string[]): ParsedArgs | { help: true } | { version: true } {
  let projectRoot = process.cwd();
  let globalOnly = false;
  let agentContext = false;
  let format: "json" | "table" = "json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project") {
      projectRoot = argv[++i] ?? projectRoot;
    } else if (arg === "--global") {
      globalOnly = true;
    } else if (arg === "--agent-context") {
      agentContext = true;
    } else if (arg === "--format") {
      const value = argv[++i];
      if (value === "json" || value === "table") {
        format = value;
      }
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg === "--version" || arg === "-v") {
      return { version: true };
    }
  }

  return { projectRoot, globalOnly, agentContext, format };
}

function printHelp(): void {
  logger.info("dx:config — Resolve global + project DX config");
  logger.info("");
  logger.info("Usage: bun run dx:config [options]");
  logger.info("");
  logger.info("Options:");
  logger.info("  --project PATH     Project root (default: cwd)");
  logger.info("  --global           Show only global config");
  logger.info("  --agent-context    Emit agent context (agents.*)");
  logger.info("  --format json      JSON output (default)");
  logger.info("  --format table     Bun.inspect.table output");
  logger.info("  --help, -h         Show this help");
  logger.info("  --version, -v      Show version");
  logger.info("");
  logger.info("Global config: ~/.config/dx/global-config.toml");
  logger.info("Project config: <projectRoot>/dx.config.toml");
}

function printVersion(): void {
  console.log(`dx:config v${TOOLCHAIN_VERSION}`);
}

const program = Effect.gen(function* () {
  const argv = Bun.argv.slice(2);
  const rawArgs = parseArgs(argv);

  if ("help" in rawArgs) {
    printHelp();
    return 0;
  }
  if ("version" in rawArgs) {
    printVersion();
    return 0;
  }

  const args = rawArgs;
  if (args.globalOnly && args.agentContext) {
    return yield* Effect.fail(
      new CliError({ message: "--global and --agent-context cannot be used together" })
    );
  }

  const dx = yield* DxConfig;

  const data = yield* args.globalOnly
    ? Effect.gen(function* () {
        const globalPath = globalDxConfigPath();
        const global = pathExists(globalPath)
          ? yield* Effect.tryPromise({
              try: () => readTomlDocument(globalPath),
              catch: (cause) =>
                new CliError({
                  message: cause instanceof Error ? cause.message : Bun.inspect(cause),
                }),
            })
          : {};
        return { raw: global, global, project: {} as Record<string, unknown> };
      })
    : args.agentContext
      ? dx.getAgentContext(args.projectRoot)
      : dx.getMergedConfig(args.projectRoot);

  const output = args.format === "table" ? Bun.inspect.table(data) : JSON.stringify(data, null, 2);

  yield* Effect.sync(() => {
    process.stdout.write(`${output}\n`);
  });

  return 0;
});

const provided = Effect.provide(program, DxConfigLive());

if (import.meta.main) {
  const exitCode = await runCliExit(provided, { toolName: TOOL, logger });
  process.exit(exitCode);
}
