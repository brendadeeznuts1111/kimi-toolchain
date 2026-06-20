#!/usr/bin/env bun
/**
 * Run a finish-work gate with stdout/stderr captured to a log file via Bun.spawn.
 *
 *   bun scripts/finish-work-gate-run.ts --log .kimi/finish-work-gate-heal-audit.log --command "kimi-heal effect audit"
 */

import { isAbsolute, resolve } from "path";
import { spawnGateCommandToLog } from "../src/lib/finish-work-herdr.ts";

function parseCli(argv: string[]): { logPath: string; command: string } {
  let logPath = "";
  let command = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--log") {
      const next = argv[++i];
      if (!next) throw new Error("--log requires a path");
      logPath = isAbsolute(next) ? next : resolve(process.cwd(), next);
      continue;
    }
    if (arg.startsWith("--log=")) {
      const value = arg.slice("--log=".length);
      logPath = isAbsolute(value) ? value : resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--command") {
      const next = argv[++i];
      if (!next) throw new Error("--command requires a value");
      command = next;
      continue;
    }
    if (arg.startsWith("--command=")) {
      command = arg.slice("--command=".length);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }
  if (!logPath) throw new Error("missing --log <path>");
  if (!command) throw new Error("missing --command <shell-command>");
  return { logPath, command };
}

const { logPath, command } = parseCli(Bun.argv.slice(2));
const exitCode = await spawnGateCommandToLog(command, logPath);
process.exit(exitCode);
