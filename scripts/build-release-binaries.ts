#!/usr/bin/env bun
/**
 * Compile all registered CLI bins to standalone executables with build-time metadata.
 *
 * Injects KIMI_BUILD_VERSION, KIMI_BUILD_TIME, KIMI_GIT_COMMIT, and
 * KIMI_BUILD_CHANNEL (overriding KIMI_RUNTIME_CLI_BUILD_CHANNEL in binaries).
 *
 * Output: .kimi-artifacts/bin/
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { compileBinary } from "../src/lib/compile-target.ts";
import { readText } from "../src/lib/bun-io.ts";

const ROOT = resolve(import.meta.dir, "..");
const OUTDIR = join(ROOT, ".kimi-artifacts", "bin");

async function gitCommit(): Promise<string | null> {
  const result = await $`git rev-parse HEAD`.quiet().nothrow();
  return result.stdout?.toString().trim() || null;
}

function jsonLiteral(value: string): string {
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readText(pkgPath)) as { version?: string; bin?: Record<string, string> };
  const version = pkg.version ?? "0.0.0";
  const commit = (await gitCommit()) ?? "unknown";
  const buildTime = new Date().toISOString();

  const define: Record<string, string> = {
    KIMI_BUILD_VERSION: jsonLiteral(version),
    KIMI_BUILD_TIME: jsonLiteral(buildTime),
    KIMI_GIT_COMMIT: jsonLiteral(commit),
    KIMI_BUILD_CHANNEL: jsonLiteral("release"),
    KIMI_RUNTIME_CLI_BUILD_CHANNEL: jsonLiteral("release"),
  };

  const bins = pkg.bin ?? {};
  const entries = Object.entries(bins);
  if (entries.length === 0) {
    console.error("No bins found in package.json");
    process.exit(1);
  }

  await mkdir(OUTDIR, { recursive: true });

  let failures = 0;
  for (const [name, relPath] of entries) {
    const entryPoint = join(ROOT, relPath);
    const outfile = join(OUTDIR, name);
    const result = await compileBinary({
      entryPoint,
      outfile,
      define,
      cwd: ROOT,
    });

    if (result.ok) {
      const mb = (result.sizeBytes / (1024 * 1024)).toFixed(1);
      console.log(`✓ ${name} (${mb} MB, ${result.durationMs}ms)`);
    } else {
      failures++;
      console.error(`✗ ${name}: ${result.error}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures}/${entries.length} builds failed`);
    process.exit(1);
  }

  console.log(`\nBuilt ${entries.length} binaries in ${OUTDIR}`);
}

if (import.meta.main) {
  await main();
}
