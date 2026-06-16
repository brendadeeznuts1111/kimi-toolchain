#!/usr/bin/env bun
/**
 * Test watcher for grok --role test-agent tab (scaffold v2 live validation).
 *   bun run scripts/test-agent.ts --watch
 */

import { herdrCliRun } from "../src/lib/herdr-project-cli.ts";

const watch = Bun.argv.includes("--watch");
const paneId = process.env.HERDR_PANE_ID;

function report(status: string, customStatus: string) {
  if (process.env.HERDR_ENV !== "1" || !paneId) return;
  herdrCliRun("", [
    "pane",
    "report-agent",
    paneId,
    "--source",
    "kimi-toolchain:test-agent",
    "--agent",
    "test-agent",
    "--state",
    status,
    "--custom-status",
    customStatus,
  ]);
}

report("working", "watching tests");

if (!watch) {
  console.log("test-agent: pass --watch to run watcher loop");
  report("idle", "ready");
  process.exit(0);
}

console.log("test-agent: watch mode (live validation stub)");
let tick = 0;
const interval = setInterval(() => {
  tick++;
  report("working", `watching (${tick})`);
  console.log(`[test-agent] tick ${tick}`);
  if (tick >= 3) {
    clearInterval(interval);
    report("idle", "ready");
    console.log("[test-agent] validation stub complete");
    process.exit(0);
  }
}, 2000);
