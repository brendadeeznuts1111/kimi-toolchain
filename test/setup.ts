/**
 * Shared test setup — runs before every test file (via bunfig.toml [test] preload).
 *
 * Responsibilities:
 * - Ensure KIMI_TEST_HOME exists for isolated unit tests.
 * - Provide a deterministic seed for randomization when seed is not already set.
 * - Keep real HOME intact by default; tests opt-in to isolation via helpers.
 */

import { join } from "path";
import { tmpdir } from "os";
import { makeDir } from "../src/lib/bun-io.ts";
import { REPO_ROOT } from "./helpers.ts";

const SANDBOX_MODE = Bun.env.KIMI_SANDBOX_MODE === "1";

// Stash the real HOME before any override. Tests that genuinely need the
// real home directory (e.g. path-utility ~ expansion) can read this or
// use withEnv({ HOME: Bun.env.KIMI_REAL_HOME }, …).
if (SANDBOX_MODE && Bun.env.HOME) {
  Bun.env.KIMI_REAL_HOME = Bun.env.HOME;
}

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = SANDBOX_MODE
    ? join(tmpdir(), `kimi-sandbox-home-${Bun.randomUUIDv7()}`)
    : join(REPO_ROOT, ".tmp-kimi-test-home");
  makeDir(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}

// In sandbox mode, force HOME to the isolated temp home so no test
// accidentally writes to the real ~/.kimi-code/ or ~/.config/.
// Tests that genuinely need the real HOME can read KIMI_REAL_HOME
// or use withEnv({ HOME: Bun.env.KIMI_REAL_HOME }, …).
if (SANDBOX_MODE && Bun.env.KIMI_TEST_HOME) {
  Bun.env.HOME = Bun.env.KIMI_TEST_HOME;
}

// Reproducible randomness when Bun does not already pin a seed.
if (!Bun.env.BUN_TEST_SEED) {
  Bun.env.BUN_TEST_SEED = "42";
}
