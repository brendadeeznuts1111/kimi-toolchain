#!/usr/bin/env bun
/** Unit tier — see src/lib/test-runtime.ts */
import { join } from "path";
import { runTestTier } from "../src/lib/test-runtime.ts";

const REPO_ROOT = join(import.meta.dir, "..");
process.exit(await runTestTier(REPO_ROOT, "unit"));