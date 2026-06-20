#!/usr/bin/env bun
/**
 * Grouped full test run — unit → integration → smoke (NODE_ENV=test per tier).
 *
 * Usage:
 *   bun run scripts/test-run.ts
 *   bun run scripts/test-run.ts --tier unit
 */
import { join } from "path";
import {
  TEST_TIER_ORDER,
  type TestTier,
  runAllTestTiers,
  runTestTier,
} from "../src/lib/test-runtime.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseTier(): TestTier | "all" {
  const idx = Bun.argv.indexOf("--tier");
  const value = idx >= 0 ? Bun.argv[idx + 1] : "all";
  if (value === "all" || !value) return "all";
  if ((TEST_TIER_ORDER as readonly string[]).includes(value)) return value as TestTier;
  console.error(`Unknown tier ${value}; expected unit|integration|smoke|all`);
  process.exit(1);
}

const tier = parseTier();
const code =
  tier === "all" ? await runAllTestTiers(REPO_ROOT) : await runTestTier(REPO_ROOT, tier);
process.exit(code);