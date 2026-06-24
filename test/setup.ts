/**
 * Test preload — ensures KIMI_TEST_HOME exists for isolated unit tests.
 * TZ: bun test defaults to UTC unless overridden. Either pass TZ on the CLI
 * (`TZ=America/Los_Angeles bun test`) or set process.env.TZ at runtime in a test
 * (see test/bun-tz-runtime.unit.test.ts — multiple changes per run, unlike Jest).
 * Wall clock: setSystemTime(date) from bun:test (see test/bun-set-system-time.unit.test.ts).
 * When TZ is unset, setup pins Etc/UTC for Bun.cron (UTC schedules).
 * @see https://bun.sh/docs/test/dates-times#set-the-time-zone
 * @see https://bun.com/docs/test/runtime-behavior#tz-timezone
 * @see https://bun.com/docs/test/runtime-behavior#module-loading
 * @see https://bun.com/docs/test/runtime-behavior#test-isolation
 * Smoke tests keep real HOME; unit tests set Bun.env.HOME = Bun.env.KIMI_TEST_HOME.
 */
import { mkdirSync } from "fs";
import { artifactPath } from "../src/lib/artifacts.ts";
import { installBuildConstantGlobals, warnIfNodeEnvNotTest } from "../src/lib/test-runtime.ts";
import { scrubProcessBunInstallCacheEnv } from "../src/lib/root-hygiene.ts";
import { REPO_ROOT } from "./helpers.ts";

warnIfNodeEnvNotTest("test/setup.ts");
scrubProcessBunInstallCacheEnv();

// Bun.env is an alias of process.env. This repo prefers Bun.env for reads and
// writes; see https://bun.com/docs/runtime/environment-variables.
Bun.env.NODE_ENV = "test";
if (!Bun.env.TZ) Bun.env.TZ = "Etc/UTC";

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = artifactPath(REPO_ROOT, "test-home");
  mkdirSync(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}

installBuildConstantGlobals(REPO_ROOT);
