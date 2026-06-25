#!/usr/bin/env bun
/**
 * Generate constants-manifest.json from bunfig.toml + build-constants.d.ts.
 *
 * Usage:
 *   bun run scripts/generate-constants-manifest.ts          # write manifest
 *   bun run scripts/generate-constants-manifest.ts --check  # fail if stale
 *   bun run scripts/generate-constants-manifest.ts --json   # stdout only
 */

import { join } from "path";
import {
  generateConstantsManifest,
  manifestNeedsRefresh,
  readConstantsManifest,
  stableStringify,
} from "../src/lib/build-constants-registry.ts";

const ROOT = join(import.meta.dir, "..");
const MANIFEST_PATH = join(ROOT, "constants-manifest.json");

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");
  const jsonOnly = Bun.argv.includes("--json");
  const generated = await generateConstantsManifest(ROOT);

  if (jsonOnly) {
    process.stdout.write(stableStringify(generated));
    return;
  }

  if (check) {
    const existing = await readConstantsManifest(ROOT);
    if (manifestNeedsRefresh(generated, existing)) {
      console.error("constants-manifest.json is stale — run: bun run manifest:generate");
      process.exit(1);
    }
    console.log("constants-manifest.json OK");
    return;
  }

  await Bun.write(MANIFEST_PATH, stableStringify(generated));
  const domainCount = Object.keys(generated.domains).length;
  const constantCount = Object.values(generated.domains).reduce(
    (sum, group) => sum + Object.keys(group).length,
    0
  );
  console.log(`wrote constants-manifest.json (${domainCount} domains, ${constantCount} constants)`);
}

main().catch((err: Error) => {
  console.error("generate-constants-manifest failed:", err.message);
  process.exit(1);
});
