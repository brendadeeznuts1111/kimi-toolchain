/**
 * Test preload — ensures KIMI_TEST_HOME exists for isolated unit tests.
 * Smoke tests keep real HOME; unit tests set Bun.env.HOME = Bun.env.KIMI_TEST_HOME.
 */
import { mkdirSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { readText } from "../src/lib/bun-io.ts";
import { parseBunfigDefines } from "../src/lib/build-constants-registry.ts";

const REPO_ROOT = join(import.meta.dir, "..");

// https://bun.com/docs/test/runtime-behavior#node_env — wrappers may inherit NODE_ENV from parent shell
Bun.env.NODE_ENV = "test";
if (!Bun.env.TZ) Bun.env.TZ = "Etc/UTC";

if (!Bun.env.KIMI_TEST_HOME) {
  const dir = artifactPath(REPO_ROOT, "test-home");
  mkdirSync(dir, { recursive: true });
  Bun.env.KIMI_TEST_HOME = dir;
}

/** bun test may not inject bunfig `[define]` into test files — mirror SSOT when missing. */
function installBuildConstantGlobals(): void {
  const probe = globalThis as { KIMI_TUNING_SET_VERSION?: string };
  if (probe.KIMI_TUNING_SET_VERSION !== undefined) return;
  const bunfigPath = join(REPO_ROOT, "bunfig.toml");
  let text: string;
  try {
    text = readText(bunfigPath);
  } catch {
    return;
  }
  if (!text.includes("[define]")) return;
  for (const entry of parseBunfigDefines(text)) {
    (globalThis as Record<string, unknown>)[entry.key] = entry.value;
  }
}

installBuildConstantGlobals();
