#!/usr/bin/env bun
/**
 * Herdr test-agent tab — runs kimi-toolchain gates with Herdr state reporting.
 *
 *   bun run scripts/test-agent.ts --watch   # fast unit tests on src/test/scripts change (tab default)
 *   bun run scripts/test-agent.ts --once    # single fast test run
 *   bun run scripts/test-agent.ts --check   # check:fast (format, lint, typecheck, test:fast)
 *   bun run scripts/test-agent.ts --ci      # ci:local --job quality
 */

import { watch } from "node:fs";
import { join } from "node:path";
import { herdrCliRun } from "../src/lib/herdr-project-cli.ts";
import {
  parseTestAgentMode,
  TEST_AGENT_DEBOUNCE_MS,
  testAgentCommand,
  watchPaths,
  type HerdrAgentState,
} from "../src/lib/herdr-test-agent.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const paneId = process.env.HERDR_PANE_ID;

function report(status: HerdrAgentState, customStatus: string) {
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

async function runCommand(label: string, cmd: string[]): Promise<boolean> {
  report("working", label);
  const proc = Bun.spawn(cmd, { cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code === 0) {
    report("done", "passed");
    return true;
  }
  report("blocked", "failed");
  return false;
}

function startWatch(run: () => Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void (async () => {
        if (running) return;
        running = true;
        try {
          await run();
        } finally {
          running = false;
        }
      })();
    }, TEST_AGENT_DEBOUNCE_MS);
  };

  void run();
  for (const path of watchPaths(REPO_ROOT)) {
    watch(path, { recursive: true }, schedule);
  }
  console.log(
    `test-agent: watching ${watchPaths(REPO_ROOT).join(", ")} (debounce ${TEST_AGENT_DEBOUNCE_MS}ms); Ctrl+C to stop`
  );
}

async function main() {
  const mode = parseTestAgentMode(Bun.argv.slice(2));
  const { label, cmd } = testAgentCommand(mode);
  const run = () => runCommand(label, cmd);

  if (mode === "watch") {
    startWatch(run);
    return;
  }

  process.exit((await run()) ? 0 : 1);
}

main().catch((err) => {
  report("blocked", "error");
  console.error("test-agent:", err);
  process.exit(1);
});
