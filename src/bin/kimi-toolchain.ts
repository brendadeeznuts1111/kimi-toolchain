#!/usr/bin/env bun
/**
 * kimi-toolchain — Meta-binary router for all toolchain tools.
 * Usage: kimi-toolchain <tool> [args...]
 *        kimi-toolchain workspace verify|audit|fix|cleanup
 */

import { join, resolve } from "path";
import {
  META_BIN,
  DIRECT_BIN,
  TOOL_SHORT_NAMES,
  resolveRepoToolScript,
  resolveToolScript,
  printToolHelp,
} from "../lib/tool-registry.ts";
import { runWorkspaceCommand, printWorkspaceHelp } from "../lib/workspace-commands.ts";

const REPO_BIN = resolve(join(import.meta.dir));
const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");

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
    console.error(`✗ Unknown tool: ${shortName}`);
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

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printToolHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const tool = args[0];
  const rest = args.slice(1);

  if (tool === DIRECT_BIN) {
    const script =
      resolveRepoToolScript(DIRECT_BIN, REPO_BIN) ?? resolveToolScript(DIRECT_BIN, TOOLS_DIR);
    if (!script) {
      console.error(`✗ ${DIRECT_BIN} not found`);
      process.exit(1);
    }
    const proc = Bun.spawn(["bun", "run", script, ...rest], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    process.exit(await proc.exited);
  }

  const known = TOOL_SHORT_NAMES as readonly string[];
  if (!known.includes(tool)) {
    console.error(`✗ Unknown tool: ${tool}`);
    printToolHelp();
    process.exit(1);
  }

  process.exit(await dispatchTool(tool, rest));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`${META_BIN} failed:`, err.message);
    process.exit(1);
  });
}
