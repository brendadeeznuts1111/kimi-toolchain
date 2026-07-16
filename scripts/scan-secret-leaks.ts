#!/usr/bin/env bun
/**
 * scan-secret-leaks.ts — Legacy JSON reporter; gate runner is `bun run audit:secrets`.
 *
 * Usage:
 *   bun run scripts/scan-secret-leaks.ts
 *   bun run scripts/scan-secret-leaks.ts --json
 *   bun run audit:secrets        # parallel per-file bun test gate
 */

import { auditSecretLeaks } from "../src/doctor/secret-audit.ts";

const args = process.argv.slice(2);
const JSON_MODE = args.includes("--json");
const DRY_RUN = args.includes("--dry-run");
const ROOT = args.find((a) => !a.startsWith("--")) ?? ".";

async function main(): Promise<number> {
  if (DRY_RUN) {
    const summary = {
      tool: "scan-secret-leaks",
      mode: "dry-run",
      projectRoot: ROOT,
      wouldRun: "auditSecretLeaks scan for raw env access",
    };
    if (JSON_MODE) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`audit:secrets dry-run — would scan ${ROOT} for raw secret-style env access`);
    }
    return 0;
  }

  const { findings, count } = await auditSecretLeaks(ROOT);

  if (JSON_MODE) {
    console.log(JSON.stringify({ findings, count }, null, 2));
  } else {
    if (count === 0) {
      console.log("✓ No raw secret-style env access found");
    } else {
      console.log(`✗ ${count} raw secret-style env access pattern(s) found:\n`);
      for (const f of findings) {
        console.log(`  ${f.file}:${f.line} [${f.type}] ${f.key}`);
        console.log(`    ${f.snippet}`);
      }
      console.log(
        "\nUse the `com.herdr.<service>.<name>` registry convention or add non-secret keys to the allowlist."
      );
    }
  }

  return count;
}

process.exit(await main());
