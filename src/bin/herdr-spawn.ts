#!/usr/bin/env bun
import { isDirectRun } from "../lib/bun-utils.ts";
import { resolveAgentArgv } from "../lib/herdr-agents.ts";
import { handoffInheritedSpawn } from "../lib/execve-handoff.ts";

if (isDirectRun(import.meta.path)) {
  const agent = Bun.argv[2];
  if (!agent) {
    process.stderr.write("usage: herdr-spawn <agent> [args...]\n");
    process.exit(1);
  }

  const cmd = resolveAgentArgv(agent);
  const executable = cmd[0];
  if (!executable) {
    process.stderr.write(`unable to resolve agent: ${agent}\n`);
    process.exit(1);
  }
  const extra = Bun.argv.slice(3);
  const code = await handoffInheritedSpawn([executable, ...cmd.slice(1), ...extra]);
  process.exit(code);
}
