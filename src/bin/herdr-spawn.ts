#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { resolveAgentArgv } from "../lib/herdr-agents.ts";

const agent = process.argv[2];
if (!agent) {
  console.error("usage: herdr-spawn <agent> [args...]");
  process.exit(1);
}

const argv = resolveAgentArgv(agent);
const extra = process.argv.slice(3);
execFileSync(argv[0], [...argv.slice(1), ...extra], { stdio: "inherit" });