/**
 * Test preload — ensures KIMI_TEST_HOME exists for isolated unit tests.
 * @see https://bun.com/docs/test/runtime-behavior#tz-timezone
 * @see https://bun.com/docs/test/runtime-behavior#module-loading
 * @see https://bun.com/docs/test/runtime-behavior#test-isolation
 * Smoke tests keep real HOME; unit tests set Bun.env.HOME = Bun.env.KIMI_TEST_HOME.
 */
import { mkdirSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import {
  installBuildConstantGlobals,
  warnIfNodeEnvNotTest,
} from "../src/lib/test-runtime.ts";

const REPO_ROOT = join(import.meta.dir, "..");

warnIfNodeEnvNotTest("test/setup.ts");
Bun.env.NODE_ENV = "test";
if (!Bun.env.TZ) Bun.env.TZ = "Etc/UTC";

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = artifactPath(REPO_ROOT, "test-home");
  mkdirSync(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}

installBuildConstantGlobals(REPO_ROOT);
