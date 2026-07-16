import { artifactPath } from "../src/lib/artifacts.ts";
import { installBuildConstantGlobals, warnIfNodeEnvNotTest } from "../src/lib/test-runtime.ts";
import { scrubProcessBunInstallCacheEnv } from "../src/lib/root-hygiene.ts";
import { REPO_ROOT, makeDir } from "./helpers.ts";

warnIfNodeEnvNotTest("test/setup.ts");
scrubProcessBunInstallCacheEnv();

// Bun.env is an alias of process.env. This repo prefers Bun.env for reads and
// writes; see https://bun.com/docs/runtime/environment-variables.
Bun.env.NODE_ENV = "test";
if (!Bun.env.TZ) Bun.env.TZ = "Etc/UTC";

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = artifactPath(REPO_ROOT, "test-home");
  makeDir(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}

installBuildConstantGlobals(REPO_ROOT);
