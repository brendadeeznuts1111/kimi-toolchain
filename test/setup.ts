/**
 * Shared test setup — runs before every test file (via root test-setup.ts).
 *
 * Responsibilities:
 * - Ensure KIMI_TEST_HOME exists for isolated unit tests.
 * - Provide a deterministic seed for randomization when seed is not already set.
 * - Keep real HOME intact by default; tests opt-in to isolation via helpers.
 */

import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import { REPO_ROOT } from "./helpers.ts";

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = join(REPO_ROOT, ".tmp-kimi-test-home");
  makeDir(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}

// Reproducible randomness when Bun does not already pin a seed.
if (!Bun.env.BUN_TEST_SEED) {
  Bun.env.BUN_TEST_SEED = "42";
}
