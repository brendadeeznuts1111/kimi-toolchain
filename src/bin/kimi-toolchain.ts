#!/usr/bin/env bun
/**
 * kimi-toolchain — Meta-binary router for all toolchain tools.
 * Usage: kimi-toolchain <tool> [args...]
 *        kimi-toolchain workspace verify|audit|fix|cleanup
 */

import { Effect } from "effect";
import { join, resolve } from "path";
import {
  DIRECT_BIN,
  TOOL_SHORT_NAMES,
  resolveRepoToolScript,
  resolveToolScript,
  printToolHelp,
} from "../lib/tool-registry.ts";
import { runWorkspaceCommand, printWorkspaceHelp } from "../lib/workspace-commands.ts";
import { toolsDir } from "../lib/paths.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { createLogger } from "../lib/logger.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-toolchain");
const REPO_BIN = resolve(join(import.meta.dir));
const TOOLS_DIR = toolsDir();

async function dispatchTool(shortName: string, args: string[]): Promise<number> {
  if (shortName === "workspace") {
    const sub = args[0];
    if (!sub || sub === "--help" || sub === "-h") {
      printWorkspaceHelp();
      return sub ? 0 : 1;
    }
    return runWorkspaceCommand(sub, args.slice(1));
  }

  const repoScript = resolveRepoToolScript(shortName, REPO_BIN);
  const desktopScript = resolveToolScript(shortName, TOOLS_DIR);
  const script = repoScript ?? desktopScript;

  if (!script) {
    logger.error(`Unknown tool: ${shortName}`);
    printToolHelp();
    return 1;
  }

  const proc = Bun.spawn(["bun", "run", script, ...args], {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printToolHelp();
    return args.length === 0 ? 1 : 0;
  }

  const tool = args[0];
  const rest = args.slice(1);

  if (tool === DIRECT_BIN) {
    const script =
      resolveRepoToolScript(DIRECT_BIN, REPO_BIN) ?? resolveToolScript(DIRECT_BIN, TOOLS_DIR);
    if (!script) {
      logger.error(`${DIRECT_BIN} not found`);
      return 1;
    }
    const proc = Bun.spawn(["bun", "run", script, ...rest], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    return await proc.exited;
  }

  const known = TOOL_SHORT_NAMES as readonly string[];
  if (!known.includes(tool)) {
    logger.error(`Unknown tool: ${tool}`);
    printToolHelp();
    return 1;
  }

  return dispatchTool(tool, rest);
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-toolchain", logger }
  );
  process.exit(exitCode);
}
