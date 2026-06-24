#!/usr/bin/env bun
/** Unit tier — see src/lib/test-runtime.ts */
import { join } from "path";
import { runTestTier } from "../src/lib/test-runtime.ts";
import {
  gateSpawnEnv,
  scrubEphemeralBunNodeDirs,
  scrubProcessBunInstallCacheEnv,
} from "../src/lib/root-hygiene.ts";

scrubEphemeralBunNodeDirs();
scrubProcessBunInstallCacheEnv();
Object.assign(Bun.env, gateSpawnEnv(Bun.env));

const REPO_ROOT = join(import.meta.dir, "..");
process.exit(await runTestTier(REPO_ROOT, "unit", { retry: 2 }));
