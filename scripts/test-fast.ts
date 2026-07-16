#!/usr/bin/env bun
/** Unit tier — see src/lib/test-runtime.ts */
import { join } from "path";
import { runBunTest, runTestTier } from "../src/lib/test-runtime.ts";
import { resolveTestGroupFiles } from "../src/lib/test-gates.ts";
import {
  gateSpawnEnv,
  scrubEphemeralBunNodeDirs,
  scrubProcessBunInstallCacheEnv,
} from "../src/lib/root-hygiene.ts";

scrubEphemeralBunNodeDirs();
scrubProcessBunInstallCacheEnv();
Object.assign(Bun.env, gateSpawnEnv(Bun.env));

const REPO_ROOT = join(import.meta.dir, "..");
const argv = Bun.argv.slice(2);

function splitList(value: string): string[] {
  return value
    .split(/[\n, ]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const groups: string[] = [];
const paths: string[] = [];
const forwarded: string[] = [];
let captureGroup: "group" | "path" | null = null;

for (const arg of argv) {
  if (arg === "--group") {
    captureGroup = "group";
    continue;
  }
  if (arg.startsWith("--group=")) {
    groups.push(...splitList(arg.slice("--group=".length)));
    continue;
  }
  if (arg === "--path") {
    captureGroup = "path";
    continue;
  }
  if (arg.startsWith("--path=")) {
    paths.push(...splitList(arg.slice("--path=".length)));
    continue;
  }
  if (captureGroup === "group") {
    groups.push(...splitList(arg));
    captureGroup = null;
    continue;
  }
  if (captureGroup === "path") {
    paths.push(...splitList(arg));
    captureGroup = null;
    continue;
  }
  forwarded.push(arg);
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
