#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { resolveAgentArgv } from "../lib/herdr-agents.ts";

const agent = process.argv[2];
if (!agent) {
  process.stderr.write("usage: herdr-spawn <agent> [args...]\n");
  process.exit(1);
}

const argv = resolveAgentArgv(agent);
const extra = process.argv.slice(3);
execFileSync(argv[0], [...argv.slice(1), ...extra], { stdio: "inherit" });
