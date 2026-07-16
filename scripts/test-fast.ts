#!/usr/bin/env bun
/**
 * Unit tier — see src/lib/test-runtime.ts
 *
 * Usage:
 *   bun run test:fast
 *   bun run test:fast -- --dots
 *   bun run test:group:bun
 *   bun run test:group -- doctor herdr
 *   bun run test:path -- 'test/lib.unit.test.ts' 'test/tool-*.unit.test.ts' --dots
 */
import { runBunTest, runTestTier } from "../src/lib/test-runtime.ts";
import { listTestGroups, resolveTestGroupFiles } from "../src/lib/test-gates.ts";
import {
  gateSpawnEnv,
  scrubEphemeralBunNodeDirs,
  scrubProcessBunInstallCacheEnv,
} from "../src/lib/root-hygiene.ts";

scrubEphemeralBunNodeDirs();
scrubProcessBunInstallCacheEnv();
Object.assign(Bun.env, gateSpawnEnv(Bun.env));

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const argv = Bun.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`test-fast.ts — unit-tier runner with domain groups

Usage:
  bun run test:fast [-- <bun-test-flags>]
  bun run test:group -- <group> [<group>...] [-- <bun-test-flags>]
  bun run test:path  -- <glob> [<glob>...]  [-- <bun-test-flags>]

Domain groups (mutually exclusive):
  ${listTestGroups().join("  ")}

Examples:
  bun run test:group -- bun core --dots
  bun run test:path  -- 'test/lib.unit.test.ts' --quiet
`);
  process.exit(0);
}

function splitList(value: string): string[] {
  return value
    .split(/[\n, ]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const groups: string[] = [];
const paths: string[] = [];
const forwarded: string[] = [];
let expectValueFor: "group" | "path" | null = null;

for (const arg of argv) {
  if (expectValueFor) {
    if (arg.startsWith("--")) {
      console.error(`Error: --${expectValueFor} requires a value`);
      process.exit(2);
    }
    if (expectValueFor === "group") groups.push(...splitList(arg));
    else paths.push(...splitList(arg));
    expectValueFor = null;
    continue;
  }
  if (arg === "--group") {
    expectValueFor = "group";
    continue;
  }
  if (arg.startsWith("--group=")) {
    groups.push(...splitList(arg.slice("--group=".length)));
    continue;
  }
  if (arg === "--path") {
    expectValueFor = "path";
    continue;
  }
  if (arg.startsWith("--path=")) {
    paths.push(...splitList(arg.slice("--path=".length)));
    continue;
  }
  forwarded.push(arg);
}

if (expectValueFor) {
  console.error(`Error: --${expectValueFor} requires a value`);
  process.exit(2);
}

const unknownGroups = groups.filter((g) => !listTestGroups().includes(g));
if (unknownGroups.length > 0) {
  console.error(`Error: unknown test group(s): ${unknownGroups.join(", ")}`);
  console.error(`Known groups: ${listTestGroups().join(", ")}`);
  process.exit(2);
}

const resolvedFiles: string[] = [];
if (groups.length > 0) {
  resolvedFiles.push(...resolveTestGroupFiles(REPO_ROOT, groups));
}
if (paths.length > 0) {
  resolvedFiles.push(...resolveTestGroupFiles(REPO_ROOT, paths, { existingOnly: false }));
}

if (resolvedFiles.length > 0) {
  const deduped = [...new Set(resolvedFiles)].sort();
  const quiet = argv.includes("--quiet");
  const args = ["test", "--isolate", "--timeout", "30000", ...forwarded, ...deduped];
  process.exit(await runBunTest(REPO_ROOT, args, { quiet, source: "test-fast" }));
}

process.exit(await runTestTier(REPO_ROOT, "unit", { retry: 2, forwarded }));
