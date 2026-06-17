#!/usr/bin/env bun
import { resolveAgentArgv } from "../lib/herdr-agents.ts";
import { spawnInherit } from "../lib/bun-native-shim.ts";

const agent = Bun.argv[2];
if (!agent) {
  process.stderr.write("usage: herdr-spawn <agent> [args...]\n");
  process.exit(1);
}

const argv = resolveAgentArgv(agent);
const extra = Bun.argv.slice(3);
spawnInherit([argv[0], ...argv.slice(1), ...extra]);
