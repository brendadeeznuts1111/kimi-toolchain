#!/usr/bin/env bun
/**
 * Generate or verify the desktop sync manifest.
 *
 * Usage:
 *   bun run scripts/sync-manifest.ts
 *   bun run scripts/sync-manifest.ts --verify
 *   bun run scripts/sync-manifest.ts --verify --json
 */

import { join } from "path";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import { writeSyncManifest, verifySyncManifest } from "../src/lib/sync-manifest.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function emitJson(value: unknown): void {
  writeStdoutJsonSync(value, 2);
}

async function main(): Promise<number> {
  const verify = Bun.argv.includes("--verify");
  const json = Bun.argv.includes("--json");

  if (verify) {
    const report = await verifySyncManifest(REPO_ROOT);
    if (json) {
      emitJson(report);
      return report.ok ? 0 : 1;
    }
    if (report.ok) {
      console.log("✓ Sync manifest hashes match repo and desktop runtime");
      return 0;
    }
    console.error("✗ Sync manifest verification failed");
    if (!report.manifestPresent) console.error("  - manifest missing; run bun run sync");
    if (!report.manifestFresh) {
      console.error(
        `  - stale manifest hashes: ${report.changedHashes.length} changed, ${report.missingHashes.length} missing, ${report.extraHashes.length} extra`
      );
    }
    if (!report.desktopSynced) {
      console.error(
        `  - desktop drift: ${report.drift.drifted.length} drifted, ${report.drift.missing.length} missing`
      );
    }
    console.error("  Run: bun run sync");
    return 1;
  }

  const manifest = await writeSyncManifest(REPO_ROOT);
  if (json) emitJson(manifest);
  else {
    const count = Object.keys(manifest.fileHashes ?? {}).length;
    console.log(`✓ Sync manifest generated with ${count} file hash(es)`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("sync-manifest failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
