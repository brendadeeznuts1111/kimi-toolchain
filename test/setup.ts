/**
 * Test preload — ensures KIMI_TEST_HOME exists for isolated unit tests.
 * Smoke tests keep real HOME; unit tests set Bun.env.HOME = Bun.env.KIMI_TEST_HOME.
 */
import { mkdirSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = join(REPO_ROOT, ".tmp-kimi-test-home");
  mkdirSync(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}
