#!/usr/bin/env bun
/**
 * audit-images.ts — Image asset security scan for doctor gates.
 *
 * Usage:
 *   bun run audit:images
 *   bun run audit:images --dry-run
 */

import { join } from "path";
import { auditImageAssets } from "../src/lib/image-audit.ts";
import { scanImageFilesSync } from "../src/lib/globs.ts";

const ROOT = join(import.meta.dir, "..");
const JSON_MODE = process.argv.includes("--json");
const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<number> {
  const files = scanImageFilesSync(ROOT);

  if (DRY_RUN) {
    const summary = {
      tool: "audit-images",
      mode: "dry-run",
      projectRoot: ROOT,
      imageFiles: files.length,
    };
    if (JSON_MODE) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`audit:images dry-run — would scan ${files.length} image(s) under ${ROOT}`);
    }
    return 0;
  }

  const result = await auditImageAssets({
    projectRoot: ROOT,
    files,
    entropyCheck: true,
  });

  if (JSON_MODE) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `audit:images — ${result.findings.length} finding(s) across ${result.filesScanned} image(s)`
    );
    for (const finding of result.findings) {
      console.log(`  ${finding.file} [${finding.taxonomyId}] ${finding.message}`);
    }
  }

  return result.findings.length;
}

process.exit(await main());
