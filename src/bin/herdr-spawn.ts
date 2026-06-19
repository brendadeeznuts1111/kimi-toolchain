#!/usr/bin/env bun
import { resolveAgentArgv } from "../lib/herdr-agents.ts";
import { handoffInheritedSpawn } from "../lib/execve-handoff.ts";

const agent = Bun.argv[2];
if (!agent) {
  process.stderr.write("usage: herdr-spawn <agent> [args...]\n");
  process.exit(1);
}

const cmd = resolveAgentArgv(agent);
const extra = Bun.argv.slice(3);
const code = await handoffInheritedSpawn([cmd[0], ...cmd.slice(1), ...extra]);
process.exit(code);
