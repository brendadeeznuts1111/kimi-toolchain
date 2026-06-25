#!/usr/bin/env bun
/**
 * Herdr test-agent tab — runs kimi-toolchain gates with Herdr state reporting.
 *
 *   bun run scripts/test-agent.ts --once    # single fast test run
 *   bun run scripts/test-agent.ts --check   # check:fast (format, lint, typecheck, test:fast)
 *   bun run scripts/test-agent.ts --ci      # ci:local --job quality
 */

import { herdrCliRun } from "../src/lib/herdr-project-cli.ts";
import {
  parseTestAgentMode,
  testAgentCommand,
  type HerdrAgentState,
} from "../src/lib/herdr-test-agent.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const paneId = Bun.env.HERDR_PANE_ID;

function report(status: HerdrAgentState, customStatus: string) {
  if (Bun.env.HERDR_ENV !== "1" || !paneId) return;
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

async function runCommand(label: string, cmd: string[]): Promise<boolean> {
  report("working", label);
  const proc = Bun.spawn(cmd, { cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code === 0) {
    report("idle", "passed");
    return true;
  }
  report("blocked", "failed");
  return false;
}

async function main() {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--watch")) {
    console.error("test-agent watch mode removed: Bun.watch is unavailable in this runtime");
    process.exit(1);
  }

  const mode = parseTestAgentMode(argv);
  const { label, cmd } = testAgentCommand(mode);
  const run = () => runCommand(label, cmd);

  process.exit((await run()) ? 0 : 1);
}

main().catch((err) => {
  report("blocked", "error");
  console.error("test-agent:", err);
  process.exit(1);
});
